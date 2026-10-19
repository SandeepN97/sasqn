#!/usr/bin/env node
import { join } from "node:path";
import { open } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import {
  defaultConfig,
  globalConfig,
  privateDirectory,
  projectConfig,
  safePath,
} from "./config.js";
import { hash, identity } from "./git.js";
import { classify } from "./classify.js";
import { listTasks, loadTask, saveTask, taskSchema } from "./state.js";
import { doctor } from "./adapters.js";
const help = `SASQN 0.1.0 — local-first orchestration foundations
Usage: sasqn <command>
  init                      Create .sasqn/config.json (never overwrite)
  doctor                    Inspect runtime and CLI installations
  status                    Show project configuration and task metadata
  run "task" --dry-run      Save a planning checkpoint; no agent execution
  resume <task-id>          Validate and reload a planning checkpoint
  --help                    Show help
  --version                 Show version
Review, config editing, agent execution and release automation are planned.
Dry-run writes local task metadata outside the project. No inference is performed.`;
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
async function main(args: string[]) {
  const [command, ...rest] = args;
  if (!command || command === "--help") {
    console.log(help);
    return;
  }
  if (command === "--version" && !rest.length) {
    console.log("0.1.0");
    return;
  }
  if (command === "doctor" && !rest.length) {
    print(await doctor());
    return;
  }
  if (!["init", "status", "run", "resume"].includes(command))
    throw new Error("Unknown command. Use --help.");
  if (["init", "status"].includes(command) && rest.length)
    throw new Error("Unexpected arguments");
  if (
    command === "run" &&
    (rest.length !== 2 || rest[1] !== "--dry-run" || !rest[0]?.trim())
  )
    throw new Error('Use: sasqn run "task" --dry-run');
  if (command === "resume" && rest.length !== 1)
    throw new Error("Use: sasqn resume <task-id>");
  const repository = await identity(process.cwd());
  if (command === "init") {
    const dir = await privateDirectory(join(repository.root, ".sasqn"));
    const path = await safePath(join(dir, "config.json"));
    const file = await open(path, "wx", 0o600);
    try {
      await file.writeFile(JSON.stringify(defaultConfig, null, 2) + "\n");
      await file.sync();
    } finally {
      await file.close();
    }
    console.log(
      `Created ${path}. Review and commit it yourself before creating a task.`,
    );
    return;
  }
  const config = await projectConfig(repository.root);
  const global = await globalConfig();
  const configHash = hash(JSON.stringify({ config, global }));
  if (command === "status") {
    print({
      repository,
      config,
      tasks: await listTasks(repository.repositoryId),
    });
    return;
  }
  if (!repository.clean)
    throw new Error(
      "A clean working tree is required; staged, unstaged and untracked changes must be resolved by the owner.",
    );
  if (command === "run") {
    const timestamp = new Date().toISOString();
    const task = taskSchema.parse({
      schemaVersion: 1,
      id: randomUUID(),
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
      task: rest[0],
      repository,
      configHash,
      state: "planned",
      classification: classify(rest[0]!),
      suggestedAgent: config.preferredAgent ?? global.preferredAgent ?? null,
      sessions: [],
      review: "pending",
    });
    await saveTask(task, null);
    print(task);
    return;
  }
  const task = await loadTask(repository.repositoryId, rest[0]!);
  if (
    JSON.stringify(task.repository) !== JSON.stringify(repository) ||
    task.configHash !== configHash
  )
    throw new Error(
      "Checkpoint is stale: repository, branch, revision or configuration changed",
    );
  print({ ...task, resumed: "metadata only; no agent invoked" });
}
main(process.argv.slice(2)).catch((error) => {
  console.error(
    `sasqn: ${error instanceof Error ? error.message : "Operation failed"}`,
  );
  process.exitCode = 1;
});
