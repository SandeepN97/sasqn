# Contributing

Discuss architectural or security changes before implementing them. Preserve the Apache-2.0 license and notices. Obtain owner authorization before branch creation or consequential Git/release operations.

Use `snyoupane1s/$(date +%Y)/<category>/<kebab-name>` for branch names. Categories: api, fix, refactor, security, devops, ui, docs, i18n, data, test, feat, auth.

Install development dependencies with `npm ci --ignore-scripts`. Run formatting, lint, type checking and tests as listed in README. Tests use temporary repositories and never invoke inference. Include tests for changed trust boundaries and failure cases. Avoid adding dependencies for trivial helpers.

Reports must distinguish implemented behavior from planned capabilities, and disclose platform coverage and security limitations. Never include credentials or private task text in bug reports.
