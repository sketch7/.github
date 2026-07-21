# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is Sketch7's GitHub `.github` special repo: `.github/workflows/` here does not run CI for *this* repo — it hosts **reusable GitHub Actions workflows** consumed by other Sketch7 repos org-wide. Callers reference them as:

```yaml
uses: sketch7/.github/.github/workflows/<workflow-file>.yml@<tag>
```

e.g. `sketch7.arcane.hexgate`'s CI does `uses: sketch7/.github/.github/workflows/dotnet-ci.yml@dotnet-libs-v2`.

There is no build/test/lint step for this repo itself — it's YAML + one composite action. "Testing" a change means either dispatching the workflow from a consumer repo on a branch ref, or (for workflow-file changes destined for a floating tag) merging to `main` and letting `update-tags.yml` move the tag.

## Floating tags (the API surface / versioning contract)

Consumers pin to a **floating tag**, not a commit or branch. `update-tags.yml` auto-force-moves a tag to the latest `main` commit whenever a `.yml` file mapped to it changes (push to `main`, path-filtered to `.github/workflows/*.yml`). It can also be triggered manually via `workflow_dispatch` to move multiple tags at once. A manual fallback for moving a single tag exists too: `TAG=<TAG> && git tag -f $TAG && git push origin $TAG -f`.

| Tag              | Workflows                                                         |
| ---------------- | ------------------------------------------------------------------ |
| `node-libs-v1`   | `node-lib.yml` — **deprecated**, use v2 split workflows            |
| `node-libs-v2`   | `node-ci.yml`, `node-publish.yml`                                  |
| `dotnet-libs-v1` | `dotnet-package.yml` — **deprecated**, use v2 split workflows      |
| `dotnet-libs-v2` | `dotnet-ci.yml`, `dotnet-publish.yml`                              |
| `release-v1`     | `prepare-release.yml`, `create-release.yml`, `node-bump-main.yml`  |

Because tags float, changing a workflow file changes behavior for every consumer pinned to its tag immediately after merge to `main` — treat edits here as you would a shared library release, not a local change. There's no versioned-and-immutable-per-commit consumption path; pin discipline is entirely at the tag level.

## Workflows provided (grouped by purpose)

**Node package CI/CD** (`@node-libs-v2`)
- `node-ci.yml` — lint, build, test only. No publish/version logic.
- `node-publish.yml` — resolves version via `version-builder-action`, bumps `package.json`, builds, publishes. Meant to run after `node-ci.yml`, not duplicate it. Emits `version`/`baseVersion`/`isPrerelease`/`tag`/`majorVersion`/`minorVersion`/`patchVersion` outputs consumed by the release jobs below.

**.NET package CI/CD** (`@dotnet-libs-v2`)
- `dotnet-ci.yml` — `dotnet restore/build/test`. Solution/project resolution is delegated to the local composite action `.github/actions/resolve-dotnet-sln` (auto-resolves from `package.json#dotnetBuildSln` when `solution-file` is omitted — yes, .NET repos here carry a `package.json` for this purpose).
- `dotnet-publish.yml` — resolves version, builds, packs, pushes NuGet packages. Same output contract as `node-publish.yml` (minus `minorVersion`/`patchVersion`).

**Release flow** (`@release-v1`, language-agnostic — shared by both Node and .NET pipelines)
- `prepare-release.yml` — after a pre-release publish on `main`, force-pushes HEAD to `release/v{baseVersion}`, ensures the `v{major}` stable branch exists (bootstraps it one commit behind so the first PR has a real diff), opens/updates the PR `release/v{baseVersion} → v{major}`.
- `create-release.yml` — tags the exact version (`v2.1.0`), force-moves the floating major tag (`v2`), publishes a GitHub Release with auto-notes, and outputs `is-latest` (major-version comparison) to gate downstream bump.
- `node-bump-main.yml` — after a stable release on the latest major, bumps minor version on `main` (`npm version minor --no-git-tag-version`) and opens a PR, committed with `[skip ci]`. Callers must guard this with `create-release`'s `is-latest == 'true'` so LTS/backport releases (e.g. publishing `v1.x` while `main` is on `v2`) don't spuriously bump main.

**Automation**
- `update-tags.yml` — the tag-mover described above.

## Conventions callers must follow

- **Public repos**: `prepare-release.yml`'s `secrets.token` must be a PAT/GitHub App token with `workflow` scope — the default `GITHUB_TOKEN` cannot push branches containing `.github/workflows/` files on public repos. Private repos work with the default token.
- **`node-publish` / `dotnet-publish` → `prepare-release` → `create-release` → `bump-main`** wire together via job `needs` + `if` conditions on prior outputs (`isPrerelease`, `is-latest`, `ref_name`) — see the full `ci.yml`/`cd.yml` examples in `README.md` for the exact permissions blocks and gating logic per language. Both examples share one branch pattern: push/PR triggers on `[main, "v*", "workflow"]`, plus a `workflow_dispatch` with `publish` / `force-prerelease` inputs for manual runs.
- Private registries: Node uses `private-npm-registry`/`private-npm-scope`/`private-npm-auth-token`; .NET uses `private-nuget-env-prefix` (must match `NuGet.Config`'s `%{PREFIX}_USERNAME%`/`%{PREFIX}_TOKEN%` placeholders) plus `nuget-auth-token`/`private-nuget-username` secrets.
- `create-release.yml`'s `tag-tmpl` input controls the floating major-tag format (default `v{major}`); override for repos wanting e.g. `{major}.x`.

## When editing workflow files here

Changes to any workflow YAML take effect for all org consumers once merged to `main` and the mapped tag moves (automatically, via `update-tags.yml`). There's no staging/canary tag — `dispatch`-driven manual tag moves are the only way to defer a rollout. Keep the `README.md` tables (Tags, per-workflow Inputs/Secrets/Outputs) in sync with any input/output changes — it's the authoritative reference consumers are pointed to.
