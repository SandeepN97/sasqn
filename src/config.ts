import { z } from "zod";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFile, lstat, mkdir, realpath } from "node:fs/promises";

export const projectSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preferredAgent: z.enum(["claude", "codex"]).optional(),
  verification: z
    .array(
      z.strictObject({
        executable: z.string().min(1).max(256),
        args: z.array(z.string().max(4096)).max(100),
      }),
    )
    .max(20)
    .default([]),
  riskPolicy: z.literal("owner-approval").default("owner-approval"),
});
export type ProjectConfig = z.infer<typeof projectSchema>;
export const defaultConfig = projectSchema.parse({ schemaVersion: 1 });
export const globalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preferredAgent: z.enum(["claude", "codex"]).optional(),
});
export function locations() {
  const home = homedir();
  const config =
    process.platform === "win32"
      ? join(process.env.APPDATA ?? home, "sasqn")
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support", "sasqn", "config")
        : join(process.env.XDG_CONFIG_HOME ?? join(home, ".config"), "sasqn");
  const data =
    process.platform === "win32"
      ? join(process.env.LOCALAPPDATA ?? home, "sasqn")
      : process.platform === "darwin"
        ? join(home, "Library", "Application Support", "sasqn", "data")
        : join(
            process.env.XDG_DATA_HOME ?? join(home, ".local", "share"),
            "sasqn",
          );
  return {
    config: resolve(process.env.SASQN_CONFIG_HOME ?? config),
    data: resolve(process.env.SASQN_DATA_HOME ?? data),
  };
}
// Reject symlinks in managed paths; canonicalize user-selected roots separately.
export async function safePath(path: string) {
  const absolute = resolve(path);
  let current = absolute;
  while (true) {
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Symlink rejected: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const parent = resolve(current, "..");
    if (parent === current) break;
    current = parent;
  }
  return absolute;
}
export async function readJson(path: string): Promise<unknown> {
  await safePath(path);
  const info = await lstat(path);
  if (!info.isFile() || info.size > 1024 * 1024)
    throw new Error("Expected a regular JSON file under 1 MiB");
  return JSON.parse(await readFile(path, "utf8"));
}
export async function privateDirectory(path: string) {
  await safePath(path);
  await mkdir(path, { recursive: true, mode: 0o700 });
  await safePath(path);
  return realpath(path);
}
export async function projectConfig(root: string) {
  return projectSchema.parse(
    await readJson(join(root, ".sasqn", "config.json")),
  );
}
export async function globalConfig() {
  try {
    return globalSchema.parse(
      await readJson(join(locations().config, "config.json")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return globalSchema.parse({ schemaVersion: 1 });
    throw error;
  }
}
