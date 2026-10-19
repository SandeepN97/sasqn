import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { devNull } from "node:os";
import { relative, isAbsolute, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { executable } from "./adapters.js";
const exec = promisify(execFile);
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
async function git(cwd: string, args: string[]) {
  const env = {
    ...process.env,
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
  };
  // Do not let inherited Git routing redirect inspection into another repository.
  for (const key of Object.keys(env))
    if (
      key.startsWith("GIT_") &&
      ![
        "GIT_OPTIONAL_LOCKS",
        "GIT_TERMINAL_PROMPT",
        "GIT_CONFIG_GLOBAL",
        "GIT_CONFIG_SYSTEM",
        "GIT_CONFIG_NOSYSTEM",
      ].includes(key)
    )
      delete env[key as keyof typeof env];
  Object.assign(env, { GIT_ALLOW_PROTOCOL: "", GIT_NO_LAZY_FETCH: "1" });
  const binary = await executable("git");
  if (!binary) throw new Error("Trusted Git executable unavailable");
  return (
    await exec(
      binary,
      [
        "--no-pager",
        "--no-optional-locks",
        "-c",
        "core.fsmonitor=false",
        "-c",
        `core.hooksPath=${devNull}`,
        "-c",
        "submodule.recurse=false",
        ...args,
      ],
      { cwd, env, timeout: 5000, maxBuffer: 1024 * 1024 },
    )
  ).stdout;
}
// Git terminates these scalar results with exactly one LF, not arbitrary whitespace.
function scalar(output: string) {
  if (
    !output.endsWith("\n") ||
    output.includes("\0") ||
    output.includes("\uFFFD")
  )
    throw new Error("Unsupported Git scalar output");
  return output.slice(0, -1);
}
function records(output: string) {
  if (!output) return [];
  if (!output.endsWith("\0") || output.includes("\uFFFD"))
    throw new Error("Unsupported Git record output");
  return output.slice(0, -1).split("\0");
}
async function checkInspectionSupport(root: string) {
  // Includes and worktree configuration remain effective: do not mask identity
  // settings or silently change the meaning of a filtered working tree.
  const keys = records(
    await git(root, [
      "config",
      "--includes",
      "--null",
      "--name-only",
      "--list",
    ]),
  );
  if (keys.some((key) => /^filter\./i.test(key)))
    throw new Error(
      "Unsupported Git configuration: filters (including clean/process) are not inspected in v0.1",
    );
  if (
    keys.some((key) =>
      /^extensions\.partialclone$|^remote\..*\.promisor$/i.test(key),
    )
  )
    throw new Error(
      "Unsupported Git configuration: partial clones/promisor remotes",
    );
  // Let Git resolve precedence and Boolean spellings using the same environment
  // as status. Git's default is true when the setting is absent.
  const fileMode = scalar(
    await git(root, [
      "config",
      "--includes",
      "--bool",
      "--default",
      "true",
      "--get",
      "core.fileMode",
    ]),
  );
  if (fileMode !== "true")
    throw new Error(
      "Unsupported Git configuration: core.fileMode=false hides executable-permission changes",
    );
  // Index-only enumeration: no content conversion and no submodule recursion.
  for (const record of records(
    await git(root, ["ls-files", "--stage", "-v", "-z", "--sparse"]),
  )) {
    const entry =
      /^([A-Za-z]) ([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])\t([^\0]+)$/s.exec(
        record,
      );
    if (!entry) throw new Error("Unsupported Git index record");
    const [, tag, mode, , stage] = entry;
    if (tag === "S" || tag === "s" || mode === "040000")
      throw new Error(
        "Unsupported Git index: skip-worktree/sparse-checkout entries",
      );
    if (tag !== tag!.toUpperCase())
      throw new Error("Unsupported Git index: assume-unchanged entries");
    if (mode === "160000") throw new Error("Unsupported Git index: submodules");
    if (
      tag !== "H" ||
      stage !== "0" ||
      !["100644", "100755", "120000"].includes(mode!)
    )
      throw new Error(
        "Unsupported Git index state (unmerged or unknown entry)",
      );
  }
}
export async function identity(cwd: string) {
  // Older Git treats fsmonitor=false as a hook command, not a Boolean.
  const version = /^git version (\d+)\.(\d+)\.(\d+)(?:[ .-][^\n]*)?\n$/.exec(
    await git(cwd, ["--version"]),
  );
  if (
    !version ||
    Number(version[1]) < 2 ||
    (Number(version[1]) === 2 && Number(version[2]) < 36)
  )
    throw new Error(
      "Unsupported Git version: v0.1 inspection requires Git 2.36 or newer",
    );
  const root = await realpath(
    scalar(await git(cwd, ["rev-parse", "--show-toplevel"])),
  );
  const gitDir = await realpath(
    scalar(await git(cwd, ["rev-parse", "--absolute-git-dir"])),
  );
  const fromRoot = relative(root, await realpath(cwd));
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot) ||
    (await realpath(
      scalar(await git(root, ["rev-parse", "--absolute-git-dir"])),
    )) !== gitDir
  )
    throw new Error("Git repository root/directory identity mismatch");
  await checkInspectionSupport(root);
  const referenceOutput = await git(root, [
    "symbolic-ref",
    "--quiet",
    "HEAD",
  ]).catch((error: { code?: number }) => {
    if (error.code !== 1) throw error;
    return "";
  });
  const reference = referenceOutput ? scalar(referenceOutput) : "";
  let head: string | null = null;
  try {
    head = scalar(await git(root, ["rev-parse", "--verify", "HEAD"]));
  } catch (error) {
    if (!reference) throw error;
    // Only a genuinely missing branch ref is an unborn repository.
    try {
      await git(root, ["show-ref", "--verify", "--quiet", reference]);
      throw error;
    } catch (refError) {
      if ((refError as { code?: number }).code !== 1) throw refError;
    }
  }
  if (head !== null) {
    // Traverse only this repository's tree objects. Gitlinks are leaves: no
    // submodule checkout, content conversion, diff driver or helper is used.
    for (const record of records(
      await git(root, ["ls-tree", "-r", "-z", "--full-tree", head]),
    )) {
      const entry =
        /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})\t[^\0]+$/s.exec(
          record,
        );
      if (!entry) throw new Error("Unsupported Git HEAD tree record");
      if (entry[1] === "160000")
        throw new Error("Unsupported Git HEAD tree: submodules");
      if (entry[2] !== "blob")
        throw new Error("Unsupported Git HEAD tree entry");
    }
  }
  const branch = reference ? reference.replace(/^refs\/heads\//, "") : "HEAD";
  const status = await git(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
  ]);
  return {
    root,
    gitDir,
    repositoryId: hash(root + "\0" + gitDir),
    head,
    branch,
    clean: status.length === 0,
  };
}
