from pathlib import Path
import shutil
import sys

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
agent = root / "skill" / "scripts" / "lib_agent.py"
if not agent.exists():
    raise SystemExit(f"NOT FOUND: {agent}")

s = agent.read_text(encoding="utf-8")
bak = agent.with_suffix(agent.suffix + ".before_judge_budget_8192.bak")
if not bak.exists():
    shutil.copy2(agent, bak)

old_budget = '"max_completion_tokens": 2048,'
new_budget = '"max_completion_tokens": 8192,'
if old_budget in s:
    s = s.replace(old_budget, new_budget, 1)
elif new_budget not in s:
    raise SystemExit("Could not find max_completion_tokens patch point")

old_return = '''    choices = data.get("choices", [])
    if not choices:
        return {"status": "error", "text": "", "error": "No choices in response"}
    text = choices[0].get("message", {}).get("content", "")
    if not isinstance(text, str) or not text.strip():
        return {
            "status": "error",
            "text": "",
            "error": "Judge returned empty/non-text message content",
        }
    return {"status": "success", "text": text}
'''
new_return = '''    choices = data.get("choices", [])
    if not choices:
        return {"status": "error", "text": "", "error": "No choices in response"}

    choice = choices[0] or {}
    message = choice.get("message") or {}
    text = message.get("content", "")
    finish_reason = str(choice.get("finish_reason") or "").lower()

    # Never accept a truncated Judge JSON payload as a valid score.
    if finish_reason in {"length", "max_tokens"}:
        return {
            "status": "error",
            "text": text if isinstance(text, str) else "",
            "error": f"Judge response truncated (finish_reason={finish_reason})",
        }

    if not isinstance(text, str) or not text.strip():
        return {
            "status": "error",
            "text": "",
            "error": "Judge returned empty/non-text message content",
        }

    return {"status": "success", "text": text}
'''
if old_return in s:
    s = s.replace(old_return, new_return, 1)
elif "Judge response truncated (finish_reason=" not in s:
    # Handle a version already patched for empty/non-text but without finish_reason guard.
    anchor = '''    text = choices[0].get("message", {}).get("content", "")
    if not isinstance(text, str) or not text.strip():
'''
    replacement = '''    choice = choices[0] or {}
    message = choice.get("message") or {}
    text = message.get("content", "")
    finish_reason = str(choice.get("finish_reason") or "").lower()
    if finish_reason in {"length", "max_tokens"}:
        return {
            "status": "error",
            "text": text if isinstance(text, str) else "",
            "error": f"Judge response truncated (finish_reason={finish_reason})",
        }
    if not isinstance(text, str) or not text.strip():
'''
    if anchor not in s:
        raise SystemExit("Could not find Judge response patch point")
    s = s.replace(anchor, replacement, 1)

agent.write_text(s, encoding="utf-8", newline="\n")
print("PATCHED:", agent)
print("BACKUP :", bak)
print("FIX    : Judge max_completion_tokens=8192 + reject finish_reason=length/max_tokens")
