import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "sasqn-security-")));
  const home = join(base, "home");
  mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    SASQN_CONFIG_HOME: join(base, "config"),
    SASQN_DATA_HOME: join(base, "state"),
    GIT_CONFIG_GLOBAL: join(home, "absent"),
    GIT_CONFIG_NOSYSTEM: "1",
  };
  function git(root, ...args) {
    const result = spawnSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
      { cwd: root, env, encoding: "utf8", timeout: 10000 },
    );
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  }
  function repo(name) {
    const root = join(base, name);
    mkdirSync(root, { recursive: true });
    git(root, "init");
    git(root, "config", "user.name", "Fixture");
    git(root, "config", "user.email", "fixture@example.invalid");
    return root;
  }
  const run = (root, ...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 10000,
    });
  function initialized(name) {
    const root = repo(name);
    const result = run(root, "init");
    assert.equal(result.status, 0, result.stderr);
    writeFileSync(join(root, "payload"), "aaaa\n");
    git(root, "add", ".");
    git(root, "commit", "-m", "fixture");
    return root;
  }
  function helper(name, processFilter = false) {
    const marker = join(base, `${name}.marker`),
      script = join(base, `${name}.cjs`);
    writeFileSync(
      script,
      `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(marker)},'executed');${processFilter ? "process.exit(1);" : "process.stdout.write(fs.readFileSync(0));"}`,
    );
    return { marker, command: `${quote(process.execPath)} ${quote(script)}` };
  }
  return { base, env, git, repo, run, initialized, helper };
}
for (const kind of ["clean", "process"]) {
  test(`${kind} filters cannot execute through init/status/run/resume (including config includes)`, () => {
    const f = fixture(),
      root = f.initialized("repo");
    writeFileSync(join(root, ".gitattributes"), "payload filter=probe\n");
    f.git(root, "add", ".");
    f.git(root, "commit", "-m", "attributes");
    const checkpoint = f.run(root, "run", "fix bug", "--dry-run");
    assert.equal(checkpoint.status, 0, checkpoint.stderr);
    const id = JSON.parse(checkpoint.stdout).id;
    const h = f.helper(kind, kind === "process");
    const include = join(f.base, "included.config");
    f.git(root, "config", "--file", include, `filter.probe.${kind}`, h.command);
    f.git(root, "config", "include.path", include);
    writeFileSync(join(root, "payload"), "bbbb\n");
    // Positive control: the fixture really triggers Git's external conversion.
    spawnSync("git", ["status", "--porcelain"], {
      cwd: root,
      env: f.env,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(existsSync(h.marker), true);
    unlinkSync(h.marker);
    // Remove config only to make this a genuine init attempt.
    unlinkSync(join(root, ".sasqn/config.json"));
    for (const args of [
      ["init"],
      ["status"],
      ["run", "fix bug", "--dry-run"],
      ["resume", id],
    ]) {
      const result = f.run(root, ...args);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /Unsupported Git configuration: filters/);
      assert.equal(existsSync(h.marker), false);
    }
    assert.equal(existsSync(join(root, ".sasqn/config.json")), false);
  });
}
test("conditional and worktree filter configuration is rejected", () => {
  const f = fixture(),
    root = f.initialized("repo"),
    h = f.helper("conditional");
  const include = join(f.base, "conditional.config");
  f.git(root, "config", "--file", include, "filter.probe.clean", h.command);
  f.git(root, "config", `includeIf.gitdir:${root}/.git.path`, include);
  assert.match(
    f.run(root, "status").stderr,
    /Unsupported Git configuration: filters/,
  );
  f.git(root, "config", "--unset", `includeIf.gitdir:${root}/.git.path`);
  f.git(root, "config", "extensions.worktreeConfig", "true");
  f.git(root, "config", "--worktree", "filter.probe.process", h.command);
  assert.match(
    f.run(root, "status").stderr,
    /Unsupported Git configuration: filters/,
  );
  assert.equal(existsSync(h.marker), false);
});
for (const flag of ["skip-worktree", "assume-unchanged"]) {
  test(`${flag} hidden modifications reject both task creation and resume`, () => {
    const f = fixture(),
      root = f.initialized("repo");
    const initial = f.run(root, "run", "fix bug", "--dry-run");
    assert.equal(initial.status, 0, initial.stderr);
    const id = JSON.parse(initial.stdout).id;
    f.git(root, "update-index", `--${flag}`, "payload");
    writeFileSync(join(root, "payload"), "bbbb\n");
    assert.equal(f.git(root, "status", "--porcelain"), "");
    for (const args of [
      ["run", "fix bug", "--dry-run"],
      ["resume", id],
    ]) {
      const result = f.run(root, ...args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(flag));
    }
  });
}
test("distinct whitespace siblings keep their root and Git directory identity", () => {
  const f = fixture();
  const sibling = f.repo("project"),
    root = f.repo("project ");
  const result = f.run(root, "init");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(join(sibling, ".sasqn")), false);
  assert.equal(existsSync(join(root, ".sasqn/config.json")), true);
  f.git(root, "add", ".");
  f.git(root, "commit", "-m", "fixture");
  const nested = join(root, "nested");
  mkdirSync(nested);
  const planned = f.run(nested, "run", "fix bug", "--dry-run");
  assert.equal(planned.status, 0, planned.stderr);
  const task = JSON.parse(planned.stdout);
  assert.equal(task.repository.root, root);
  assert.equal(task.repository.gitDir, join(root, ".git"));
  assert.equal(f.run(root, "resume", task.id).status, 0);
  const unusual = f.repo(" leading\tline\n ");
  assert.equal(f.run(unusual, "init").status, 0);
  assert.equal(existsSync(join(unusual, ".sasqn/config.json")), true);
});
test("hooks, fsmonitor and external diff configuration do not execute during inspection", () => {
  const f = fixture(),
    root = f.initialized("repo"),
    h = f.helper("monitor", true);
  f.git(root, "config", "core.fsmonitor", h.command);
  f.git(root, "config", "diff.external", h.command);
  f.git(root, "config", "diff.probe.command", h.command);
  f.git(root, "config", "diff.probe.textconv", h.command);
  const hooks = join(f.base, "hooks");
  mkdirSync(hooks);
  for (const name of ["post-index-change", "pre-commit", "post-checkout"])
    writeFileSync(join(hooks, name), `#!/bin/sh\n${h.command}\n`, {
      mode: 0o700,
    });
  f.git(root, "config", "core.hooksPath", hooks);
  writeFileSync(join(root, "payload"), "bbbb\n");
  assert.equal(f.run(root, "status").status, 0);
  assert.equal(f.run(root, "run", "fix bug", "--dry-run").status, 1);
  assert.equal(existsSync(h.marker), false);
});
test("submodules are rejected before inspecting their configured filters", () => {
  const f = fixture(),
    root = f.initialized("repo"),
    child = join(root, "child");
  mkdirSync(child);
  f.git(child, "init");
  f.git(child, "config", "user.name", "Fixture");
  f.git(child, "config", "user.email", "fixture@example.invalid");
  writeFileSync(join(child, "payload"), "aaaa\n");
  writeFileSync(join(child, ".gitattributes"), "payload filter=probe\n");
  f.git(child, "add", ".");
  f.git(child, "commit", "-m", "child");
  const h = f.helper("child");
  f.git(child, "config", "filter.probe.clean", h.command);
  writeFileSync(join(child, "payload"), "bbbb\n");
  const head = f.git(child, "rev-parse", "HEAD").slice(0, -1);
  f.git(root, "update-index", "--add", "--cacheinfo", `160000,${head},child`);
  f.git(root, "config", "submodule.recurse", "true");
  f.git(root, "config", "status.submoduleSummary", "true");
  const result = f.run(root, "status");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported Git index: submodules/);
  assert.equal(existsSync(h.marker), false);
});
test("partial clones, corrupt indexes and redirected worktree identity fail closed", () => {
  const f = fixture(),
    root = f.initialized("repo");
  f.git(root, "config", "remote.origin.promisor", "true");
  assert.match(f.run(root, "status").stderr, /partial clones/);
  f.git(root, "config", "--unset", "remote.origin.promisor");
  const index = join(root, ".git/index"),
    saved = readFileSync(index);
  writeFileSync(index, "broken");
  assert.equal(f.run(root, "run", "fix bug", "--dry-run").status, 1);
  writeFileSync(index, saved);
  const other = f.repo("other");
  f.git(root, "config", "core.worktree", other);
  assert.match(f.run(root, "init").stderr, /identity mismatch/);
  assert.equal(existsSync(join(other, ".sasqn")), false);
});
test("sparse-checkout entries are explicitly unsupported", () => {
  const f = fixture(),
    root = f.initialized("repo");
  for (const dir of ["kept", "excluded"]) {
    mkdirSync(join(root, dir));
    writeFileSync(join(root, dir, "file"), "content");
  }
  f.git(root, "add", ".");
  f.git(root, "commit", "-m", "directories");
  f.git(root, "sparse-checkout", "init", "--cone", "--sparse-index");
  f.git(root, "sparse-checkout", "set", "kept");
  const result = f.run(root, "run", "fix bug", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /skip-worktree\/sparse-checkout/);
});
test("separate Git directories and linked worktrees retain whitespace identity", () => {
  const f = fixture(),
    root = f.initialized("repo"),
    gitDir = join(f.base, "metadata ");
  f.git(root, "init", "--separate-git-dir", gitDir);
  const result = f.run(root, "run", "fix bug", "--dry-run");
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(result.stdout);
  assert.equal(task.repository.gitDir, gitDir);
  assert.equal(f.run(root, "resume", task.id).status, 0);
  const linked = join(f.base, "linked ");
  f.git(root, "worktree", "add", "-b", "fixture-linked", linked);
  const linkedResult = f.run(linked, "run", "fix bug", "--dry-run");
  assert.equal(linkedResult.status, 0, linkedResult.stderr);
  const linkedTask = JSON.parse(linkedResult.stdout);
  assert.equal(linkedTask.repository.root, linked);
  assert.notEqual(
    linkedTask.repository.repositoryId,
    task.repository.repositoryId,
  );
  assert.equal(f.run(linked, "resume", task.id).status, 1);
});

test("old Git is rejected before any repository inspection", () => {
  const f = fixture(),
    root = f.repo("repo"),
    bin = join(f.base, "bin");
  mkdirSync(bin);
  const marker = join(f.base, "unexpected-inspection");
  writeFileSync(
    join(bin, "git"),
    `#!${process.execPath}\nif(process.argv.at(-1)==="--version") console.log("git version 2.35.1"); else require("node:fs").writeFileSync(${JSON.stringify(marker)},"executed");`,
    { mode: 0o700 },
  );
  f.env.PATH = bin + delimiter + f.env.PATH;
  const result = f.run(root, "init");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires Git 2.36/);
  assert.equal(existsSync(marker), false);
});

for (const change of ["deletion", "replacement"]) {
  test(`committed submodule staged ${change} is rejected from the HEAD tree`, () => {
    const f = fixture(),
      root = f.initialized("repo");
    const plan = f.run(root, "run", "test", "--dry-run");
    assert.equal(plan.status, 0, plan.stderr);
    const id = JSON.parse(plan.stdout).id;
    const head = f.git(root, "rev-parse", "HEAD").slice(0, -1);
    f.git(root, "update-index", "--add", "--cacheinfo", `160000,${head},child`);
    f.git(root, "commit", "-m", "committed gitlink");
    f.git(root, "update-index", "--force-remove", "child");
    if (change === "replacement") {
      writeFileSync(join(root, "child"), "ordinary file\n");
      f.git(root, "add", "child");
    } else {
      assert.equal(f.git(root, "status", "--porcelain"), "D  child\n");
      assert.equal(
        f.git(root, "status", "--porcelain", "--ignore-submodules=all"),
        "",
      );
    }
    assert.doesNotMatch(f.git(root, "ls-files", "--stage"), /^160000/m);
    for (const args of [
      ["run", "test", "--dry-run"],
      ["status"],
      ["resume", id],
      ["init"],
    ]) {
      const result = f.run(root, ...args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Unsupported Git HEAD tree: submodules/);
    }
  });
}

test("nested committed gitlinks are rejected without reading a submodule", () => {
  const f = fixture(),
    root = f.initialized("repo");
  // No submodule checkout or commit object exists: ls-tree must treat the gitlink as a leaf.
  const path = "nested/child\twith\nspace ";
  f.git(
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${"a".repeat(40)},${path}`,
  );
  f.git(root, "commit", "-m", "nested gitlink");
  f.git(root, "update-index", "--force-remove", path);
  const result = f.run(root, "run", "test", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unsupported Git HEAD tree: submodules/);
});

test("unborn branches initialize and detached HEAD can plan and resume", () => {
  const f = fixture(),
    root = f.repo("unborn");
  assert.equal(f.run(root, "init").status, 0);
  const status = f.run(root, "status");
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).repository.head, null);
  f.git(root, "add", ".");
  f.git(root, "commit", "-m", "fixture");
  f.git(root, "checkout", "--detach");
  const planned = f.run(root, "run", "test", "--dry-run");
  assert.equal(planned.status, 0, planned.stderr);
  const task = JSON.parse(planned.stdout);
  assert.equal(task.repository.branch, "HEAD");
  assert.equal(f.run(root, "resume", task.id).status, 0);
});

test("staged submodule additions reject task creation and resume", () => {
  const f = fixture(),
    root = f.initialized("repo");
  const planned = f.run(root, "run", "test", "--dry-run");
  assert.equal(planned.status, 0, planned.stderr);
  const task = JSON.parse(planned.stdout);
  f.git(
    root,
    "update-index",
    "--add",
    "--cacheinfo",
    `160000,${task.repository.head},child`,
  );
  for (const args of [
    ["run", "test", "--dry-run"],
    ["resume", task.id],
  ]) {
    const result = f.run(root, ...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unsupported Git index: submodules/);
  }
});

test("fileMode=false rejects executable-bit changes hidden by Git status", () => {
  const f = fixture(),
    root = f.initialized("repo");
  const plan = f.run(root, "run", "test", "--dry-run");
  assert.equal(plan.status, 0, plan.stderr);
  const id = JSON.parse(plan.stdout).id;
  f.git(root, "config", "core.fileMode", "false");
  chmodSync(join(root, "payload"), 0o755);
  assert.equal(f.git(root, "status", "--porcelain"), "");
  assert.match(
    f.git(root, "-c", "core.fileMode=true", "status", "--porcelain"),
    /payload/,
  );
  for (const args of [
    ["run", "test", "--dry-run"],
    ["resume", id],
    ["status"],
    ["init"],
  ]) {
    const result = f.run(root, ...args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core\.fileMode=false/);
  }
});

for (const source of [
  "global",
  "system",
  "include",
  "conditional",
  "worktree",
]) {
  test(`effective fileMode=false from ${source} configuration is rejected`, () => {
    const f = fixture(),
      root = f.initialized("repo");
    f.git(root, "config", "--unset", "core.fileMode");
    const config = join(f.base, "filemode.config");
    writeFileSync(config, "[core]\nfileMode = false\n");
    if (source === "global") f.env.GIT_CONFIG_GLOBAL = config;
    if (source === "system") {
      f.env.GIT_CONFIG_SYSTEM = config;
      f.env.GIT_CONFIG_NOSYSTEM = "0";
    }
    if (source === "include") f.git(root, "config", "include.path", config);
    if (source === "conditional")
      f.git(root, "config", `includeIf.gitdir:${root}/.git.path`, config);
    if (source === "worktree") {
      f.git(root, "config", "extensions.worktreeConfig", "true");
      f.git(root, "config", "--worktree", "core.fileMode", "false");
    }
    const result = f.run(root, "run", "test", "--dry-run");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core\.fileMode=false/);
  });
}

test("fileMode uses Git Boolean parsing, defaults and effective precedence", () => {
  const f = fixture(),
    root = f.initialized("repo");
  for (const value of ["false", "no", "off", "0", ""]) {
    f.git(root, "config", "core.fileMode", value);
    const result = f.run(root, "status");
    assert.equal(result.status, 1);
    assert.match(result.stderr, /core\.fileMode=false/);
  }
  f.git(root, "config", "core.fileMode", "invalid-boolean");
  assert.equal(f.run(root, "status").status, 1);
  f.git(root, "config", "--unset", "core.fileMode");
  assert.equal(f.run(root, "status").status, 0); // Git defaults to true.
  writeFileSync(f.env.GIT_CONFIG_GLOBAL, "[core]\nfileMode = false\n");
  f.git(root, "config", "core.fileMode", "yes");
  assert.equal(f.run(root, "status").status, 0); // Local true overrides global false.
});

test("environment config injection cannot bypass the fileMode check or hide mode changes", () => {
  const f = fixture(),
    root = f.initialized("repo");
  f.git(root, "config", "core.fileMode", "false");
  f.env.GIT_CONFIG_COUNT = "1";
  f.env.GIT_CONFIG_KEY_0 = "core.fileMode";
  f.env.GIT_CONFIG_VALUE_0 = "true";
  f.env.GIT_CONFIG_PARAMETERS = "'core.fileMode'='true'";
  assert.match(f.run(root, "status").stderr, /core\.fileMode=false/);
  // The existing wrapper removes inline config overrides for every inspection command.
  delete f.env.GIT_CONFIG_COUNT;
  delete f.env.GIT_CONFIG_KEY_0;
  delete f.env.GIT_CONFIG_VALUE_0;
  delete f.env.GIT_CONFIG_PARAMETERS;
  f.git(root, "config", "core.fileMode", "true");
  f.env.GIT_CONFIG_COUNT = "1";
  f.env.GIT_CONFIG_KEY_0 = "core.fileMode";
  f.env.GIT_CONFIG_VALUE_0 = "false";
  f.env.GIT_CONFIG_PARAMETERS = "'core.fileMode'='false'";
  chmodSync(join(root, "payload"), 0o755);
  const result = f.run(root, "run", "test", "--dry-run");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /clean working tree is required/);
});
