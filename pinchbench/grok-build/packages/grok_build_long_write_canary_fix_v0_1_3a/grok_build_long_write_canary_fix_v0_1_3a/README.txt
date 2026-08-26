Grok Build Long-Write Canary Fix v0.1.3a
================================================

The v0.1.3 adapter core is unchanged.

The original canary contained this PowerShell interpolation bug:

    $PayloadEND_PAYLOAD

PowerShell interpreted it as one undefined variable named
PayloadEND_PAYLOAD. The generated prompt therefore ended at BEGIN_PAYLOAD,
and the Agent correctly concluded that the requested payload was empty.

The fixed canary constructs the prompt by string concatenation and performs
local checks for:
- BEGIN_PAYLOAD and END_PAYLOAD;
- first and final payload lines;
- prompt and payload byte lengths;
- expected output SHA-256.

No Adapter restart is required after installing this canary-only fix.
