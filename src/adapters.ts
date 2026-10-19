import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { delimiter, isAbsolute, join, dirname } from "node:path";
import { access, realpath, lstat } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
export interface AgentCapability {
  id: "claude" | "codex";
  executable: string | null;
  executionSupported: false;
}
export async function executable(name: string) {
  let projectRoot = await realpath(process.cwd());
  let ancestor = projectRoot;
  while (true) {
    try {
      await lstat(join(ancestor, ".git"));
      projectRoot = ancestor;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory)) continue;
    // Project-local executable paths are not trusted for diagnostic execution.
    const candidate = join(
      directory,
      process.platform === "win32" ? `${name}.exe` : name,
    );
    try {
      const resolved = await realpath(candidate);
      const cwd = projectRoot;
      if (
        resolved === cwd ||
        resolved.startsWith(cwd + "/") ||
        resolved.startsWith(cwd + "\\")
      )
        continue;
      await access(resolved, constants.X_OK);
      return resolved;
    } catch {
      /* Missing PATH entry. */
    }
  }
  return null;
}
export async function doctor() {
  const results = [];
  for (const name of ["git", "claude", "codex"]) {
    const path = await executable(name);
    if (!path) {
      results.push({ name, available: false });
      continue;
    }
    try {
      const { stdout } = await promisify(execFile)(path, ["--version"], {
        cwd: tmpdir(),
        timeout: 5000,
        maxBuffer: 16384,
      });
      results.push({ name, path, available: true, version: stdout.trim() });
    } catch {
      results.push({
        name,
        path,
        available: false,
        error: "Version probe failed",
      });
    }
  }
  return {
    runtime: process.version,
    tools: results,
    authentication: "not inspected",
    agentExecution: "not implemented",
  };
}
