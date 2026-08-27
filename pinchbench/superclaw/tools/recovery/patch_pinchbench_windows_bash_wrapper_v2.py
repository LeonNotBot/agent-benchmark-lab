from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
grading = root / "skill" / "scripts" / "lib_grading.py"
if not grading.exists():
    raise SystemExit(f"NOT FOUND: {grading}")

s = grading.read_text(encoding="utf-8")
bak = grading.with_suffix(grading.suffix + ".before_bash_wrapper_v2.bak")
if not bak.exists():
    shutil.copy2(grading, bak)

if "\nimport subprocess\n" not in s:
    marker = "import shutil\n" if "\nimport shutil\n" in s else "import re\n"
    s = s.replace(marker, marker + "import subprocess\n", 1)

old_block = '''    if os.name == "nt" and 'executable="/bin/bash"' in grading_code:
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
new_block = '''    namespace = _build_automated_namespace(skill_dir)

    # Windows compatibility for task graders authored for POSIX /bin/bash.
    # Do NOT pass Git Bash as subprocess(shell=True, executable=...), because
    # Windows subprocess supplies cmd.exe-style shell arguments. Instead,
    # explicitly invoke: bash.exe -c <command>.
    if os.name == "nt" and 'executable="/bin/bash"' in grading_code:
        bash_executable = _resolve_windows_bash()
        if not bash_executable:
            raise RuntimeError(
                "Automated grader requires /bin/bash semantics, but Git Bash "
                "was not found on Windows."
            )

        def _pinchbench_subprocess_run(*popenargs: Any, **kwargs: Any):
            executable = kwargs.get("executable")
            shell = bool(kwargs.get("shell"))
            if executable == "/bin/bash" and shell:
                if popenargs:
                    command = popenargs[0]
                    rest = popenargs[1:]
                else:
                    command = kwargs.pop("args")
                    rest = ()

                kwargs.pop("executable", None)
                kwargs["shell"] = False

                if isinstance(command, (list, tuple)):
                    command = subprocess.list2cmdline([str(x) for x in command])
                else:
                    command = str(command)

                translated = [bash_executable, "-c", command]
                if popenargs:
                    return subprocess.run(translated, *rest, **kwargs)
                return subprocess.run(translated, **kwargs)

            return subprocess.run(*popenargs, **kwargs)

        namespace["_pinchbench_subprocess_run"] = _pinchbench_subprocess_run
        grading_code = grading_code.replace(
            "subprocess.run(",
            "_pinchbench_subprocess_run(",
        )

    exec(grading_code, namespace)
'''

if old_block in s:
    s = s.replace(old_block, new_block, 1)
elif "Do NOT pass Git Bash as subprocess" not in s:
    old = '''    namespace = _build_automated_namespace(skill_dir)
    exec(grading_code, namespace)
'''
    if old not in s:
        raise SystemExit("Could not find automated grading patch point")
    s = s.replace(old, new_block, 1)

grading.write_text(s, encoding="utf-8", newline="\n")
print("PATCHED:", grading)
print("BACKUP :", bak)
print("FIX    : /bin/bash graders now use explicit Git Bash: bash.exe -c <command>")
