# ADR 0002: Strict JSON and external local state

Status: accepted for v0.1.

Use `.sasqn/config.json` rather than YAML: comments are sacrificed for a standard parser and no alias/tag semantics. Reject unknown keys and versions. Project settings cannot weaken owner approval policy.

Keep task data outside target repositories in OS-specific user directories. JSON records with locks and atomic replacement are sufficient for this single-process planning slice; SQLite is deferred until transactional multi-record workflows justify it.

State is private local metadata, not authenticated evidence. Same-user tampering and filesystem races are outside the enforced trust boundary. Future independent-review acceptance needs separate enforced storage permissions, not just a differently named JSON file.
