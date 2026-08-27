from pathlib import Path
import sys, shutil, hashlib

if len(sys.argv) != 2:
    raise SystemExit('Usage: python patch_pinchbench_judge_parse_retry.py <pinchbench-root>')
root = Path(sys.argv[1]).expanduser().resolve()
p = root / 'skill' / 'scripts' / 'lib_grading.py'
if not p.exists():
    raise SystemExit(f'NOT FOUND: {p}')

old = '''        break  # Parsed response; exit loop after success or after the final failed attempt\n'''
new = '''        if raw_parsed:\n            break  # Parsed successfully; exit the retry loop.\n\n        logger.warning(\n            "Judge response was unparseable (attempt %d/%d)",\n            attempt + 1,\n            max_judge_attempts,\n        )\n        if attempt < max_judge_attempts - 1:\n            time.sleep(2**attempt)\n            continue\n'''

s = p.read_text(encoding='utf-8')
if new in s:
    print(f'ALREADY PATCHED: {p}')
    raise SystemExit(0)
count = s.count(old)
if count != 1:
    raise SystemExit(f'ABORT: expected exactly 1 target, found {count}; file left unchanged')
backup = p.with_name(p.name + '.before_judge_parse_retry_fix.bak')
if not backup.exists():
    shutil.copy2(p, backup)
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8', newline='\n')
print(f'PATCHED: {p}')
print(f'BACKUP : {backup}')
print('FIX    : unparseable Judge responses now consume the intended second attempt instead of breaking immediately')
print('SHA256 :', hashlib.sha256(p.read_bytes()).hexdigest())
