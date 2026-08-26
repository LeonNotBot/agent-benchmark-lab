Grok Build Full Runner Adapter Gate Repair v0.1.3d
=======================================================

Why v0.1.3 installation reported a traceback
----------------------------------------------
The prior installer had already written the gate changes, then attempted to
validate them by executing the entire Runner module through
importlib.util.exec_module(). The Runner is not designed to be loaded that way,
so the validation step raised a traceback.

This does not imply that the file replacement failed.

What this repair does
---------------------
- Accepts either the old state or the already-patched state.
- Patches only any remaining active 0.1.2 gates.
- Preserves deepseek/deepseek-v4-pro.
- Compiles the Python Runner.
- Uses Python AST to read the three constants without executing the Runner.
- Executes the real PowerShell Adapter health gate.
- Creates a backup/manifest directory.
- Does not touch progress, results, workspaces, transcripts or Judge data.

Do not run the three-task cleanup script again. It already completed.
After this repair passes, resume the existing run directly.
