import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { classify } from "../dist/classify.js";
import { projectSchema } from "../dist/config.js";
import { loadTask, saveTask } from "../dist/state.js";
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
test("classification is conservative and config cannot weaken policy", () => {
  assert.equal(classify("fix authentication bug").risk, "high");
  assert.equal(classify("update readme").risk, "unknown");
  assert.throws(() =>
    projectSchema.parse({ schemaVersion: 1, riskPolicy: "auto" }),
  );
  assert.throws(() =>
    projectSchema.parse({ schemaVersion: 1, command: "evil" }),
  );
});
test("CLI lifecycle, persistence conflicts, corruption and isolation", async () => {
  const root = await mkdtemp(join(tmpdir(), "sasqn-test-"));
  const data = await mkdtemp(join(tmpdir(), "sasqn-data-"));
  const config = await mkdtemp(join(tmpdir(), "sasqn-config-"));
  // Canonical paths avoid macOS /var and /tmp aliases in managed storage.
  const { realpath } = await import("node:fs/promises");
  process.env.SASQN_DATA_HOME = await realpath(data);
  process.env.SASQN_CONFIG_HOME = await realpath(config);
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      encoding: "utf8",
      env: process.env,
    });
  assert.equal(run("--version").stdout.trim(), "0.1.0");
  assert.match(run("--help").stdout, /metadata/);
  assert.equal(run("nonsense").status, 1);
  git("init");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Test");
  assert.equal(run("init").status, 0);
  const original = await readFile(join(root, ".sasqn/config.json"), "utf8");
  assert.equal(run("init").status, 1);
  assert.equal(
    await readFile(join(root, ".sasqn/config.json"), "utf8"),
    original,
  );
  assert.equal(run("run", "fix bug", "--dry-run").status, 1);
  git("add", ".sasqn/config.json");
  git("commit", "-m", "fixture");
  const result = run("run", "fix authentication bug", "--dry-run");
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(result.stdout);
  assert.equal(run("resume", task.id).status, 0);
  assert.equal(JSON.parse(run("status").stdout).tasks.length, 1);
  await assert.rejects(saveTask(task, null), /conflict/);
  const updated = { ...task, revision: 1 };
  const races = await Promise.allSettled([
    saveTask(updated, 0),
    saveTask(updated, 0),
  ]);
  assert.equal(races.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    (await loadTask(task.repository.repositoryId, task.id)).revision,
    1,
  );
  await assert.rejects(loadTask("a".repeat(64), task.id));
  await assert.rejects(loadTask(task.repository.repositoryId, "../escape"));
  await writeFile(join(root, "new.txt"), "untracked");
  assert.equal(run("resume", task.id).status, 1);
  git("add", "new.txt");
  git("commit", "-m", "changed");
  assert.match(run("resume", task.id).stderr, /stale/);
  const path = join(
    process.env.SASQN_DATA_HOME,
    "tasks",
    task.repository.repositoryId,
    `${task.id}.json`,
  );
  await writeFile(path, "{broken");
  assert.equal(run("status").status, 1);
  await assert.rejects(saveTask(updated, 0));
  assert.equal(await readFile(path, "utf8"), "{broken");
});
test("init rejects symlink configuration directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "sasqn-link-"));
  const target = await mkdtemp(join(tmpdir(), "sasqn-target-"));
  execFileSync("git", ["init"], { cwd: root, stdio: "pipe" });
  await symlink(target, join(root, ".sasqn"));
  const result = spawnSync(process.execPath, [cli, "init"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Symlink rejected/);
});
