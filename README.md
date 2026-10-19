# SASQN

SASQN ("Sassy Queen") is a local-first AI development orchestration CLI under the Samjhana Multiproduct brand. Its intended role is to coordinate Claude Code and Codex across arbitrary repositories, using users' existing supported CLI authentication.

Version 0.1 implements **planning and durable metadata recovery only**. It does not invoke AI agents, execute verification commands, review code, or automate releases.

## Local installation

Requires Node.js 22 or newer, npm, and Git 2.36 or newer. From this checkout:

```sh
npm ci --ignore-scripts
npm run build
node dist/cli.js --help
node dist/cli.js --version
```

The package exposes a `sasqn` executable through its npm `bin` entry. `npm pack` builds a local installable archive; publication and global installation are separate owner actions. No SASQN dependency is needed in target applications.

## Try it in another repository

Use an absolute path to this checkout's `dist/cli.js`:

```sh
cd /path/to/another/git-repository
node /path/to/sasqn/dist/cli.js init
node /path/to/sasqn/dist/cli.js doctor
node /path/to/sasqn/dist/cli.js status
```

Review the generated `.sasqn/config.json` and commit it yourself. Task planning requires a clean Git working tree, including no untracked files.

```sh
node /path/to/sasqn/dist/cli.js run "Fix the authentication bug" --dry-run
node /path/to/sasqn/dist/cli.js resume <task-id>
```

`--dry-run` writes a checkpoint outside the project. It does not invoke an agent or change application files. Resume reloads metadata only and rejects changed revisions, branches, configuration or dirty worktrees. With no explicit preferred agent, routing remains undecided.

## Git inspection limits

v0.1 rejects effective `core.fileMode=false` (which hides executable-bit changes), any configured `filter.*` entry (including global Git LFS filters), partial-clone/promisor settings, submodules in the index or committed HEAD tree (including staged deletions/replacements), unmerged/unknown index states, and `skip-worktree` or `assume-unchanged` entries. This includes sparse checkouts with excluded entries or sparse directories. Rejection applies to `init`, `status`, `run`, and `resume`; SASQN does not remove or change those settings.

Inspection disables hooks and filesystem monitors, does not run external diff/textconv operations, and does not recurse into submodules. Git configuration includes and worktree settings remain effective and are checked before working-tree status. Unsupported/malformed output and repository identity mismatches fail closed. Use a supported full checkout; do not disable filters merely to bypass the check, since filtered content may have different semantics.

## Configuration and storage

Project configuration is strict, versioned JSON at `.sasqn/config.json`:

```json
{
  "schemaVersion": 1,
  "preferredAgent": "codex",
  "verification": [],
  "riskPolicy": "owner-approval"
}
```

Verification entries contain `executable` and `args` fields; they are inert in v0.1. Unknown keys and unsupported versions fail validation. Initialization never overwrites an existing file.

Optional global `config.json` supports `schemaVersion: 1` and `preferredAgent`. Locations:

| Platform | Configuration                                 | Task data                                        |
| -------- | --------------------------------------------- | ------------------------------------------------ |
| macOS    | `~/Library/Application Support/sasqn/config`  | `~/Library/Application Support/sasqn/data`       |
| Linux    | `$XDG_CONFIG_HOME/sasqn` or `~/.config/sasqn` | `$XDG_DATA_HOME/sasqn` or `~/.local/share/sasqn` |
| Windows  | `%APPDATA%/sasqn`                             | `%LOCALAPPDATA%/sasqn`                           |

`SASQN_CONFIG_HOME` and `SASQN_DATA_HOME` explicitly override these directories. Use absolute paths without symlink components. Task text is stored locally in plaintext: do not include secrets. Credentials and repository file contents are not collected.

`doctor` probes installed CLI versions from PATH in a temporary working directory. It does not authenticate or test account entitlement. User-controlled PATH installations are trusted; project-local paths are excluded.

## Development

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
```

See [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [contribution guidelines](CONTRIBUTING.md). Apache-2.0; see [LICENSE](LICENSE).
