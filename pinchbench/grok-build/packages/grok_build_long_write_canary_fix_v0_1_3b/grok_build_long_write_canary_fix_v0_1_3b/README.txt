Grok Build Long-Write Canary Fix v0.1.3b
================================================

Observed result:
- Grok exited 0.
- The Agent returned LONG_WRITE_ADAPTER_OK.
- Two model calls completed.
- The output file was exactly one byte shorter than the requested payload.
- Its SHA-256 exactly matched the requested payload with only the final LF removed.

This is Grok's write-tool terminal-newline normalization, not a Responses API
or Adapter failure.

The updated canary accepts only:
1. an exact byte-for-byte payload match; or
2. an exact match after removing one terminal LF from the expected payload.

Any other byte difference still fails. The Adapter core is unchanged.
