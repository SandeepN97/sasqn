# ADR 0003: Metadata-only execution and conservative resume

Status: accepted for v0.1.

`run --dry-run` persists a plan and `resume` validates and reloads it. Neither invokes an agent. Require a clean Git tree and exact identity/configuration/revision match instead of implementing a partial working-tree snapshot system.

This limits usefulness on active dirty repositories but makes recovery semantics explicit. Future execution requires broader content inventories, context isolation, supported permission controls and session attribution. A model's response is never an accepted-review decision.
