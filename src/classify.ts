export function classify(task: string) {
  const high =
    /\b(auth|authentication|secret|security|database|schema|migration|deploy|delete|payment|permission)\b/i.test(
      task,
    );
  const kind = /\b(test|tests)\b/i.test(task)
    ? "test"
    : /\b(doc|docs|documentation)\b/i.test(task)
      ? "docs"
      : /\b(fix|bug)\b/i.test(task)
        ? "fix"
        : "general";
  return {
    kind,
    risk: high ? "high" : "unknown",
    reasons: [
      high
        ? "Sensitive operation keyword detected"
        : "Task text alone cannot establish low risk",
    ],
    requiresOwnerApproval: true,
  } as const;
}
