PinchBench Qwen Code Windows Runner v2 session fix

Fix:
- First executable turn of every multi-session task always starts a fresh Qwen session.
- Later turns resume the previous session unless metadata explicitly sets new_session: true.
- Session-error validation applies only after turn 1.

Validated:
- Python syntax compilation passed.
- Simulated iterative task turn flags: [fresh, resume, resume].

Install to C:\pinchbench-qwen-code\runner and overwrite the previous runner.
