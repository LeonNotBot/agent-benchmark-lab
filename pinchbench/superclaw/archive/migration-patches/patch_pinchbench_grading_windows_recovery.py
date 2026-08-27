from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
scripts = root / "skill" / "scripts"
grading = scripts / "lib_grading.py"
agent = scripts / "lib_agent.py"

for p in (grading, agent):
    if not p.exists():
        raise SystemExit(f"NOT FOUND: {p}")

# ---- lib_grading.py ----
s = grading.read_text(encoding="utf-8")
bak = grading.with_suffix(grading.suffix + ".before_windows_recovery_fix.bak")
if not bak.exists():
    shutil.copy2(grading, bak)

if "\nimport shutil\n" not in s:
    marker = "import re\n"
    if marker not in s:
        raise SystemExit("lib_grading.py import patch point not found")
    s = s.replace(marker, marker + "import shutil\n", 1)

old = '''def _parse_judge_text(raw_text: str) -> Dict[str, Any]:
    """Parse judge response from raw text (direct API call, no OpenClaw transcript)."""
    raw_text = raw_text.strip()
'''
new = '''def _parse_judge_text(raw_text: Any) -> Dict[str, Any]:
    """Parse judge response from raw text (direct API call, no OpenClaw transcript)."""
    if raw_text is None:
        return {}
    if not isinstance(raw_text, str):
        raw_text = str(raw_text)
    raw_text = raw_text.strip()
'''
if old in s:
    s = s.replace(old, new, 1)
elif "if raw_text is None:" not in s:
    raise SystemExit("lib_grading.py judge parser patch point not found")

helper_anchor = "def _grade_automated(\n"
helper = '''def _resolve_windows_bash() -> str:
    """Return Git for Windows bash.exe for POSIX automated graders."""
    if os.name != "nt":
        return "/bin/bash"

    candidates = []
    for env_name, suffix in (
        ("ProgramFiles", r"Git\\bin\\bash.exe"),
        ("ProgramFiles", r"Git\\usr\\bin\\bash.exe"),
        ("ProgramFiles(x86)", r"Git\\bin\\bash.exe"),
        ("LOCALAPPDATA", r"Programs\\Git\\bin\\bash.exe"),
    ):
        base = os.environ.get(env_name)
        if base:
            candidates.append(Path(base) / suffix)

    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    for name in ("bash.exe", "bash"):
        found = shutil.which(name)
        if found and "system32" not in found.lower():
            return found
    return ""


'''
if "def _resolve_windows_bash()" not in s:
    if helper_anchor not in s:
        raise SystemExit("lib_grading.py automated grader helper patch point not found")
    s = s.replace(helper_anchor, helper + helper_anchor, 1)

old2 = '''    namespace = _build_automated_namespace(skill_dir)
    exec(grading_code, namespace)
'''
new2 = '''    if os.name == "nt" and 'executable="/bin/bash"' in grading_code:
        bash_executable = _resolve_windows_bash()
        if not bash_executable:
            raise RuntimeError(
                "Automated grader requires /bin/bash semantics, but Git Bash "
                "was not found on Windows. Install Git for Windows or expose bash.exe."
            )
        grading_code = grading_code.replace(
            'executable="/bin/bash"',
            f"executable={bash_executable!r}",
        )

    namespace = _build_automated_namespace(skill_dir)
    exec(grading_code, namespace)
'''
if old2 in s:
    s = s.replace(old2, new2, 1)
elif "Automated grader requires /bin/bash semantics" not in s:
    raise SystemExit("lib_grading.py automated grader patch point not found")

grading.write_text(s, encoding="utf-8", newline="\n")

# ---- lib_agent.py ----
a = agent.read_text(encoding="utf-8")
abak = agent.with_suffix(agent.suffix + ".before_empty_judge_fix.bak")
if not abak.exists():
    shutil.copy2(agent, abak)

old3 = '''    text = choices[0].get("message", {}).get("content", "")
    return {"status": "success", "text": text}
'''
new3 = '''    text = choices[0].get("message", {}).get("content", "")
    if not isinstance(text, str) or not text.strip():
        return {
            "status": "error",
            "text": "",
            "error": "Judge returned empty/non-text message content",
        }
    return {"status": "success", "text": text}
'''
if old3 in a:
    a = a.replace(old3, new3, 1)
elif "Judge returned empty/non-text message content" not in a:
    raise SystemExit("lib_agent.py judge response patch point not found")

agent.write_text(a, encoding="utf-8", newline="\n")

print("PATCHED:", grading)
print("PATCHED:", agent)
print("BACKUP :", bak)
print("BACKUP :", abak)
print("FIXES  : Judge None/empty response retry + Windows Git Bash automated grading")
