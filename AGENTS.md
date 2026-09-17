# AGENTS.md

Agent guidance for Sketch7's `.github` special repo — canonical for Claude Code and other coding agents (see [CLAUDE.md](CLAUDE.md)).

## What this repo is

`.github/workflows/` here does not run CI for *this* repo — it hosts **reusable GitHub Actions workflows** consumed by other Sketch7 repos org-wide, referenced as `uses: sketch7/.github/.github/workflows/<workflow-file>.yml@<tag>`. There's no build/test/lint step for this repo itself. "Testing" a change means dispatching the workflow from a consumer repo on a branch ref, or (for a floating-tag rollout) merging to `main` and letting `update-tags.yml` move the tag.

## Floating tags are the API surface

Consumers pin to a **floating tag**, not a commit or branch — see `README.md`'s Tags table for the current tag → workflow mapping. `update-tags.yml` auto-force-moves a tag to latest `main` whenever a mapped `.yml` file changes. Because tags float, merging a workflow change to `main` changes behavior for every consumer pinned to that tag immediately — treat edits here like a shared library release, not a local change. There's no staging/canary tag; a manual `workflow_dispatch` tag move is the only way to defer a rollout.

## Gotchas worth knowing before editing

- .NET repos here carry a `package.json` purely so `dotnet-ci.yml`/`dotnet-publish.yml` can auto-resolve `solution-file` from `package.json#dotnetBuildSln` via the local composite action `.github/actions/resolve-dotnet-sln`.
- `node-bump-main.yml`'s bump commit title ends in `[skip ci]` — that's intentional, not a leftover.
- This branch is mid-migration to new tag tracks (see README's "Breaking migration" section) — check `README.md` for current inputs/tags rather than trusting version numbers or removed inputs (e.g. `is-prerelease`, `tag-tmpl`) from memory or older revisions of this file.

## When editing workflow files here

Keep `README.md`'s tables (Tags, per-workflow Inputs/Secrets/Outputs) in sync with any input/output change — it's the authoritative reference consumers are pointed to. Don't duplicate that detail here; this file is for things README doesn't cover.
