import { z } from "zod";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { open, rename, unlink, readdir } from "node:fs/promises";
import { locations, privateDirectory, readJson, safePath } from "./config.js";
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const taskSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  revision: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  task: z.string().min(1).max(16000),
  repository: z.strictObject({
    root: z.string(),
    gitDir: z.string(),
    repositoryId: digest,
    head: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .nullable(),
    branch: z.string(),
    clean: z.boolean(),
  }),
  configHash: digest,
  state: z.literal("planned"),
  classification: z.strictObject({
    kind: z.enum(["test", "docs", "fix", "general"]),
    risk: z.enum(["high", "unknown"]),
    reasons: z.array(z.string()),
    requiresOwnerApproval: z.literal(true),
  }),
  suggestedAgent: z.enum(["claude", "codex"]).nullable(),
  sessions: z.array(z.never()).length(0),
  review: z.literal("pending"),
});
export type Task = z.infer<typeof taskSchema>;
function directory(repositoryId: string) {
  return join(locations().data, "tasks", digest.parse(repositoryId));
}
export async function loadTask(repositoryId: string, id: string) {
  const task = taskSchema.parse(
    await readJson(join(directory(repositoryId), `${z.uuid().parse(id)}.json`)),
  );
  if (task.id !== id || task.repository.repositoryId !== repositoryId)
    throw new Error("Checkpoint identity mismatch");
  return task;
}
export async function saveTask(input: Task, expectedRevision: number | null) {
  const task = taskSchema.parse(input);
  const dir = await privateDirectory(directory(task.repository.repositoryId));
  const path = join(dir, `${task.id}.json`);
  const lockPath = `${path}.lock`;
  await safePath(lockPath);
  const lock = await open(lockPath, "wx", 0o600);
  const temporary = join(dir, `.${task.id}.${randomUUID()}.tmp`);
  try {
    let existing: Task | undefined;
    try {
      existing = await loadTask(task.repository.repositoryId, task.id);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (
      (existing?.revision ?? null) !== expectedRevision ||
      task.revision !== (expectedRevision === null ? 0 : expectedRevision + 1)
    )
      throw new Error("Checkpoint revision conflict");
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(task, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    await safePath(path);
    await rename(temporary, path);
    // Directory fsync is unavailable on Windows; rename remains atomic on supported local filesystems.
    if (process.platform !== "win32") {
      const folder = await open(dir, "r");
      try {
        await folder.sync();
      } finally {
        await folder.close();
      }
    }
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await lock.close();
    await unlink(lockPath);
  }
}
export async function listTasks(repositoryId: string) {
  const dir = directory(repositoryId);
  await safePath(dir);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return Promise.all(
    files
      .filter((name) => name.endsWith(".json"))
      .map((name) => loadTask(repositoryId, name.slice(0, -5))),
  );
}
