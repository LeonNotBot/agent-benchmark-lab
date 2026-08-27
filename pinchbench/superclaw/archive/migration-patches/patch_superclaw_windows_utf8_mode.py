from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
runner = root / "runner" / "run_pinchbench_superclaw_windows.py"

if not runner.exists():
    raise SystemExit(f"NOT FOUND: {runner}")

text = runner.read_text(encoding="utf-8")

marker = 'os.environ.setdefault("PYTHONUTF8", "1")'
fix_marker = "PINCHBENCH_UTF8_REEXEC"

if fix_marker in text:
    print("ALREADY PATCHED:", runner)
    raise SystemExit(0)

if marker not in text:
    raise SystemExit("Patch point not found; file left unchanged")

backup = runner.with_suffix(runner.suffix + ".before_utf8_mode_fix.bak")
if not backup.exists():
    shutil.copy2(runner, backup)

replacement = '''os.environ.setdefault("PYTHONUTF8", "1")

# PINCHBENCH_UTF8_REEXEC
# Setting PYTHONUTF8 after Python has already started does not change the
# current process' default text encoding on Windows. Re-exec once in UTF-8
# mode before importing the base runner / grading engine so embedded
# automated graders using Path.read_text() without an explicit encoding
# read UTF-8 workspace files correctly.
if os.name == "nt" and not sys.flags.utf8_mode:
    os.execv(sys.executable, [sys.executable, "-X", "utf8", *sys.argv])
'''

text = text.replace(marker, replacement, 1)
runner.write_text(text, encoding="utf-8", newline="\n")

print("PATCHED:", runner)
print("BACKUP :", backup)
print("FIX    : Windows runner now re-execs once with Python UTF-8 mode before grading")
