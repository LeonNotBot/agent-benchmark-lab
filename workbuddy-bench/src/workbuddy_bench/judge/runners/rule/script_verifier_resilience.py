"""Rewrite single-try script verifiers for independent checks and a fixed denominator.

``script_verifier`` tasks run ``tests/verifier.py``. This module rewrites a
script that records every check in one ``try`` and scores in
``finally: write_reward()``:

1. **Independent execution** (:func:`transform_script`). Each check's setup is
   wrapped so an exception is recorded as a failure and later checks still run.

2. **Fixed denominator** (:func:`transform_script` and
   :func:`reconcile_reward_payload`). ``write_reward`` uses the number of checks
   the verifier declares; checks that never ran are recorded as failures.
"""

from __future__ import annotations

import ast
from pathlib import Path
from typing import Optional

_CHECK_CALL_NAMES = frozenset({"safe_record", "record"})
_GUARD_HELPER_NAME = "_wb_setup_crash"
_DECLARED_CONST = "_wb_declared_checks"
_FLAG_CONST = "_wb_setup_failed"

_HELPER_SNIPPET = f"""
{_FLAG_CONST} = False

def {_GUARD_HELPER_NAME}(stage, exc):
    import sys as _sys
    global {_FLAG_CONST}
    {_FLAG_CONST} = True
    print(
        f"[wb-verifier] {{stage}} raised {{type(exc).__name__}}: {{exc}}; "
        "marking the next check as failed and continuing",
        file=_sys.stderr,
    )
""".strip()


def is_check_call(node: ast.AST) -> bool:
    """Return True when ``node`` is a call to ``safe_record``/``record``."""
    return (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id in _CHECK_CALL_NAMES
    )


def _main_try(tree: ast.Module) -> Optional[ast.Try]:
    """Return the module-level try whose finally invokes ``write_reward``."""
    for node in tree.body:
        if isinstance(node, ast.Try) and node.finalbody:
            if _calls_write_reward(node.finalbody):
                return node
    return None


def _calls_write_reward(statements: list[ast.stmt]) -> bool:
    for stmt in statements:
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            fn = stmt.value.func
            if isinstance(fn, ast.Name) and fn.id == "write_reward":
                return True
    return False


def is_vulnerable_script_verifier(source: str) -> bool:
    """Detect the single-try + safe_record + unguarded-setup pattern.

    Returns True when the script has a main ``try/finally: write_reward()``
    block that records checks via ``safe_record``/``record`` **and** contains
    unguarded statements that call the submission directly (the statements that
    can abort the block).
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    main_try = _main_try(tree)
    if main_try is None:
        return False
    body = main_try.body
    scope = _module_scope(tree)
    return _has_check_call(body, scope) and _has_naked_statement(body)


def _has_check_call(body: list[ast.stmt], scope: dict[str, ast.AST]) -> bool:
    return _count_checks(body, scope) > 0


def _has_naked_statement(body: list[ast.stmt]) -> bool:
    """True when a try-body statement could raise without a check wrapper."""
    for stmt in body:
        if isinstance(stmt, ast.Expr) and is_check_call(stmt.value):
            continue
        if isinstance(
            stmt,
            (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom),
        ):
            continue
        return True
    return False


def declared_check_count(source: str) -> int:
    """Exact, never-overcounting count of the checks a verifier declares.

    Counts ``safe_record``/``record`` calls in the main try block. Check sites
    inside ``if/else``, ``try/except/else`` and literal-list ``for`` loops are
    counted exactly so the returned value equals the number of checks a full run
    records — it must never exceed the real count, otherwise a
    correctly-executing verifier would be penalized.
    """
    tree = ast.parse(source)
    main_try = _main_try(tree)
    if main_try is None:
        return 0
    return _count_checks(main_try.body, _module_scope(tree))


def _module_scope(tree: ast.Module) -> dict[str, ast.AST]:
    """Map module-level names to their assignment values.

    Used to resolve literal-list iterables of ``for`` loops (e.g. the
    ``MUTATIONS`` list in the ``testing-*`` mutation verifiers) so the declared
    check count is exact.
    """
    scope: dict[str, ast.AST] = {}
    for stmt in tree.body:
        if isinstance(stmt, ast.Assign):
            for target in stmt.targets:
                if isinstance(target, ast.Name):
                    scope[target.id] = stmt.value
    return scope


def _literal_list_len(node: ast.AST | None, scope: dict[str, ast.AST]) -> int | None:
    if isinstance(node, (ast.List, ast.Tuple)):
        return len(node.elts)
    if isinstance(node, ast.Name):
        value = scope.get(node.id)
        if value is not None:
            return _literal_list_len(value, scope)
    return None


def _block_has_escape(statements: list[ast.stmt]) -> bool:
    return any(isinstance(stmt, (ast.Continue, ast.Break)) for stmt in statements)


def _block_up_to_escape(statements: list[ast.stmt]) -> list[ast.stmt]:
    for index, stmt in enumerate(statements):
        if isinstance(stmt, (ast.Continue, ast.Break)):
            return statements[: index + 1]
    return statements


def _max_path_checks(statements: list[ast.stmt], scope: dict[str, ast.AST]) -> int:
    """Maximum number of check calls on a single path through ``statements``.

    ``if`` branches that end the iteration (``continue``/``break``) are mutually
    exclusive with the statements that follow them, so only the larger path is
    counted. This keeps the declared total exact for loop-based verifiers (e.g.
    the ``testing-*`` mutation checks) without ever overcounting.
    """
    total = 0
    index = 0
    while index < len(statements):
        stmt = statements[index]
        if isinstance(stmt, ast.If):
            if_ends = _block_has_escape(stmt.body)
            else_ends = _block_has_escape(stmt.orelse)
            if if_ends or else_ends:
                if_path = _max_path_checks(_block_up_to_escape(stmt.body), scope)
                else_path = _max_path_checks(_block_up_to_escape(stmt.orelse), scope)
                remaining = _max_path_checks(statements[index + 1 :], scope)
                if if_ends and else_ends:
                    return total + max(if_path, else_path)
                if if_ends:
                    return total + max(if_path, else_path + remaining)
                return total + max(if_path + remaining, else_path)
        total += _count_checks(stmt, scope)
        index += 1
    return total


def _count_checks(node: ast.AST | list[ast.AST], scope: dict[str, ast.AST]) -> int:
    if isinstance(node, list):
        return sum(_count_checks(stmt, scope) for stmt in node)
    if isinstance(
        node,
        (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom),
    ):
        return 0
    if isinstance(node, ast.Expr) and is_check_call(node.value):
        return 1
    if isinstance(node, ast.If):
        # At most one branch runs.
        return max(
            _count_checks(node.body, scope),
            _count_checks(node.orelse, scope) if node.orelse else 0,
        )
    if isinstance(node, ast.For):
        # Resolve literal-list loops exactly (e.g. the testing-* mutation list);
        # otherwise stay conservative and count nothing to never overcount.
        iterations = _literal_list_len(node.iter, scope)
        if iterations and iterations > 0:
            return iterations * _max_path_checks(node.body, scope)
        return 0
    if isinstance(node, ast.While):
        # Iteration count is not statically bounded; count nothing to stay safe.
        return 0
    if isinstance(node, ast.With):
        return _count_checks(node.body, scope)
    if isinstance(node, (ast.Try, ast.TryStar)):
        except_count = max(
            (_count_checks(handler.body, scope) for handler in node.handlers),
            default=0,
        )
        else_count = _count_checks(node.orelse, scope) if node.orelse else 0
        finally_count = _count_checks(node.finalbody, scope) if node.finalbody else 0
        # The try body runs; except/else are mutually exclusive.
        return _count_checks(node.body, scope) + max(except_count, else_count) + finally_count
    return sum(_count_checks(child, scope) for child in ast.iter_child_nodes(node))


def transform_script(source: str) -> Optional[str]:
    """Return a resilient variant of a vulnerable verifier script.

    Applies two rewrites to the *main* try block:

    * every non-check statement is wrapped so an exception is swallowed and
      execution continues to the following checks (independent execution);
    * ``write_reward`` uses a fixed denominator equal to the declared check
      count, filling any never-run checks as failures (fixed denominator).

    Returns ``None`` when ``source`` is not a vulnerable single-try verifier, in
    which case the script is left untouched.
    """
    if not is_vulnerable_script_verifier(source):
        return None
    tree = ast.parse(source)
    main_try = _main_try(tree)
    assert main_try is not None

    declared = declared_check_count(source)
    _inject_helper(tree)
    if declared > 0:
        _rewrite_write_reward(tree, declared)
    _wrap_try_body(main_try)

    ast.fix_missing_locations(tree)
    return ast.unparse(tree)


def _inject_helper(tree: ast.Module) -> None:
    helper = ast.parse(_HELPER_SNIPPET)
    tree.body[0:0] = helper.body


def _rewrite_write_reward(tree: ast.Module, declared: int) -> None:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "write_reward":
            node.body = _fixed_denominator_body(declared)
            return


def _fixed_denominator_body(declared: int) -> list[ast.stmt]:
    template = f"""\
results = list(RESULTS)
{_DECLARED_CONST} = {declared}
for _wb_i in range(len(results), {_DECLARED_CONST}):
    results.append({{"name": f"check-{{_wb_i + 1}} (not executed)", "passed": False, "detail": "verifier aborted before this check ran"}})
passed = sum(1 for item in results if item["passed"])
total = len(results) or 1
reward = {{
    "overall": passed / total,
    "test_pass_rate": passed / total,
    "tests_passed": passed,
    "tests_total": total,
    "test_status": "pass" if passed == total else "no_pass",
    "tests": results,
}}
(LOG_DIR / "reward.json").write_text(json.dumps(reward, indent=2, ensure_ascii=False))
(LOG_DIR / "reward.txt").write_text(str(reward["overall"]))
print(json.dumps(reward, indent=2, ensure_ascii=False))
"""
    return ast.parse(template).body


def _wrap_try_body(try_node: ast.Try) -> None:
    wrapped: list[ast.stmt] = []
    for stmt in try_node.body:
        wrapped.extend(_guard_statement(stmt))
    try_node.body = wrapped


def _guard_statement(stmt: ast.stmt) -> list[ast.stmt]:
    """Wrap ``stmt`` so an exception cannot abort the remaining checks.

    Check-recording calls get a guard that records a failure when the check
    itself raised a base exception; every other statement gets a guard that
    swallows the exception and lets the next check run. Compound statements are
    descended into so a crash inside a loop/with/if body does not skip the rest
    of that block. Returns a list so a check call can be preceded by a small
    length-capture statement.
    """
    if isinstance(stmt, ast.Expr) and is_check_call(stmt.value):
        return _wrap_check_call(stmt)
    if isinstance(
        stmt,
        (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Import, ast.ImportFrom),
    ):
        return [stmt]
    if isinstance(stmt, ast.Raise):
        # A raise is often intentional (a verifier tests that the submission
        # releases a resource on exception). Guarding it would swallow the very
        # exception the enclosing except clause is meant to observe.
        return [stmt]
    if isinstance(stmt, (ast.Try, ast.TryStar)):
        if stmt.handlers:
            # Nested try with explicit handlers: leave its bodies untouched so
            # intentional raise/except flow is preserved; only catch what the
            # handlers themselves did not.
            return [_wrap_setup(stmt)]
        # try/finally without handlers: descend so a crash in the body cannot
        # abort the remaining checks.
        for field in ("body", "orelse", "finalbody"):
            body = getattr(stmt, field, None)
            if body:
                setattr(stmt, field, _guard_statements(body))
        return [_wrap_setup(stmt)]
    if isinstance(stmt, (ast.If, ast.For, ast.While, ast.With)):
        for field in ("body", "orelse"):
            body = getattr(stmt, field, None)
            if body:
                setattr(stmt, field, _guard_statements(body))
        return [_wrap_setup(stmt)]
    return [_wrap_setup(stmt)]


def _guard_statements(body: list[ast.stmt]) -> list[ast.stmt]:
    wrapped: list[ast.stmt] = []
    for stmt in body:
        wrapped.extend(_guard_statement(stmt))
    return wrapped


def _wrap_setup(stmt: ast.stmt) -> ast.stmt:
    label = f"{type(stmt).__name__}@line {getattr(stmt, 'lineno', '?')}"
    return ast.Try(
        body=[stmt],
        handlers=[
            ast.ExceptHandler(
                type=ast.Name(id="BaseException", ctx=ast.Load()),
                name="_wb_exc",
                body=[
                    ast.Expr(
                        ast.Call(
                            func=ast.Name(id=_GUARD_HELPER_NAME, ctx=ast.Load()),
                            args=[
                                ast.Constant(value=label),
                                ast.Name(id="_wb_exc", ctx=ast.Load()),
                            ],
                            keywords=[],
                        )
                    )
                ],
            )
        ],
        orelse=[],
        finalbody=[],
    )


def _wrap_check_call(stmt: ast.Expr) -> list[ast.stmt]:
    """Guard a ``safe_record``/``record`` call against a broken setup.

    Two failure paths are covered:

    * a preceding setup statement crashed (``_wb_setup_failed`` is set) — the
      check did not get a valid environment to run in, so it is recorded as a
      failure without executing it;
    * the check itself raised a base exception (``safe_record`` already catches
      ordinary ``Exception``) — recorded as a failure when nothing was recorded.
    """
    name = _check_name(stmt)
    before = ast.Assign(
        targets=[ast.Name(id="_wb_before", ctx=ast.Store())],
        value=ast.Call(
            func=ast.Name(id="len", ctx=ast.Load()),
            args=[ast.Name(id="RESULTS", ctx=ast.Load())],
            keywords=[],
        ),
    )
    flagged_fail = ast.Expr(
        ast.Call(
            func=ast.Name(id="record", ctx=ast.Load()),
            args=[
                ast.Constant(value=name),
                ast.Constant(value=False),
                ast.Constant(value="setup crashed before this check ran"),
            ],
            keywords=[],
        )
    )
    clear_flag = ast.Assign(
        targets=[ast.Name(id=_FLAG_CONST, ctx=ast.Store())],
        value=ast.Constant(value=False),
    )
    else_body = [
        ast.Try(
            body=[stmt],
            handlers=[
                ast.ExceptHandler(
                    type=ast.Name(id="BaseException", ctx=ast.Load()),
                    name="_wb_exc",
                    body=[
                        ast.If(
                            test=ast.Compare(
                                left=ast.Call(
                                    func=ast.Name(id="len", ctx=ast.Load()),
                                    args=[ast.Name(id="RESULTS", ctx=ast.Load())],
                                    keywords=[],
                                ),
                                ops=[ast.Eq()],
                                comparators=[ast.Name(id="_wb_before", ctx=ast.Load())],
                            ),
                            body=[
                                ast.Expr(
                                    ast.Call(
                                        func=ast.Name(id="record", ctx=ast.Load()),
                                        args=[
                                            ast.Constant(value=name),
                                            ast.Constant(value=False),
                                            ast.JoinedStr(
                                                values=[
                                                    ast.FormattedValue(
                                                        value=ast.Name(
                                                            id="_wb_exc", ctx=ast.Load()
                                                        ),
                                                        conversion=-1,
                                                        format_spec=None,
                                                    )
                                                ]
                                            ),
                                        ],
                                        keywords=[],
                                    )
                                )
                            ],
                            orelse=[],
                        )
                    ],
                )
            ],
            orelse=[],
            finalbody=[],
        )
    ]
    dispatch = ast.If(
        test=ast.Name(id=_FLAG_CONST, ctx=ast.Load()),
        body=[clear_flag, flagged_fail],
        orelse=else_body,
    )
    return [before, dispatch]


def _check_name(stmt: ast.Expr) -> str:
    call = stmt.value
    if isinstance(call, ast.Call) and call.args:
        first = call.args[0]
        if isinstance(first, ast.Constant) and isinstance(first.value, str):
            return first.value
    return "check"


def transform_verifier_file(path: Path) -> Optional[str]:
    """Read ``verifier.py`` at ``path`` and return its resilient variant.

    Returns ``None`` when the file is missing or is not a vulnerable single-try
    script verifier (in which case it is left untouched).
    """
    try:
        source = path.read_text(encoding="utf-8")
    except OSError:
        return None
    return transform_script(source)


def reconcile_reward_payload(payload: dict, declared: int) -> dict:
    """Enforce a fixed denominator on a script verifier reward payload.

    When a script reports fewer recorded checks than the verifier declares
    (an early abort), the missing checks are filled in as failures so the
    denominator cannot shrink. Returns a new payload; ``payload`` is untouched
    when ``declared`` is not positive or no truncation is detected.
    """
    if not declared:
        return dict(payload)
    tests = payload.get("tests")
    recorded_total = 0
    if isinstance(tests, list):
        recorded_total = len([entry for entry in tests if isinstance(entry, dict)])
    else:
        try:
            recorded_total = int(payload.get("tests_total") or 0)
        except (TypeError, ValueError):
            return dict(payload)
    if recorded_total >= declared:
        return dict(payload)

    merged = dict(payload)
    results = [dict(entry) for entry in tests] if isinstance(tests, list) else []
    for index in range(len(results), declared):
        results.append(
            {
                "name": f"check-{index + 1} (not executed)",
                "passed": False,
                "detail": "verifier aborted before this check ran",
            }
        )
    passed = sum(1 for entry in results if entry.get("passed"))
    total = len(results) or 1
    overall = passed / total
    merged["tests"] = results
    merged["tests_passed"] = passed
    merged["tests_total"] = total
    merged["overall"] = overall
    merged["test_pass_rate"] = overall
    merged["test_status"] = "pass" if passed == total else "no_pass"
    return merged
