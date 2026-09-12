# workflows

Reusable GitHub Actions workflows for Node and .NET packages. Provides separate, composable workflows for CI checks, publishing, release PR preparation, and GitHub Release creation.

## Breaking migration

The next tracks are `node-libs-v3`, `dotnet-libs-v3` and `release-v2`; they are not published by this change. Integration callers remain on `feature/promotable-app-release-cycle` until validation and merge.

Remove `is-prerelease` from release calls and `tag-tmpl` from publish/release calls. Exact tags always use `v{version}`; stable floating tags use `v{major}`. Older major tags are no longer updated by this branch.

## Tags

[![update tags](https://github.com/sketch7/.github/actions/workflows/update-tags.yml/badge.svg)](https://github.com/sketch7/.github/actions/workflows/update-tags.yml)

Tags are updated automatically on push to `main` when workflow files change. Use [workflow_dispatch](https://github.com/sketch7/.github/actions/workflows/update-tags.yml) to manually update multiple tags at once.

| Tag              | Workflows                                                         |
| ---------------- | ----------------------------------------------------------------- |
| `node-libs-v3`   | `node-ci.yml`, `node-publish.yml`                                 |
| `dotnet-libs-v3` | `dotnet-ci.yml`, `dotnet-publish.yml`                             |
| `release-v2`     | `prepare-release.yml`, `create-release.yml`, `node-bump-main.yml` |

```bash
# manual fallback — move a single tag
TAG=<TAG> && git tag -f $TAG && git push origin $TAG -f
```

---

## Workflows

### `node-ci.yml` · `@node-libs-v3`

Runs lint, build, and test. No publish, no version logic. Use on PRs and pushes.

**Inputs**

| Input                  | Default        | Description                                            |
| ---------------------- | -------------- | ------------------------------------------------------ |
| `node-version-file`    | `package.json` | File containing the Node version spec                  |
| `package-manager`      | `npm`          | `npm` or `pnpm`                                        |
| `private-npm-registry` | —              | Private registry URL; configures auth when set         |
| `private-npm-scope`    | —              | Scope for private registry; auto-resolved when omitted |

**Secrets** `private-npm-auth-token`

---

### `node-publish.yml` · `@node-libs-v3`

Resolves the version via `version-builder-action`, runs a fail-closed release preflight, then bumps `package.json`, installs, builds, and publishes the package. Designed to run **after** `node-ci.yml` — does not repeat lint/test.

The preflight reads live, paginated branch, tag, exact-tag, and GitHub Release state before any package/version mutation, build, or registry publication. It is read-only, but the reusable job grants `contents: write` so GitHub includes draft releases in the release listing. Authentication, authorization, rate-limit, transport, and malformed-response failures stop the job without falling back to local tags. During integration, the action is temporarily consumed from `sketch7/version-builder-action@feature/promotable-app-release-cycle`.

**Inputs**

| Input                  | Default                      | Description                                           |
| ---------------------- | ---------------------------- | ----------------------------------------------------- |
| `node-version-file`    | `package.json`               | File containing the Node version spec                 |
| `package-manager`      | `npm`                        | `npm` or `pnpm`                                       |
| `registry-url`         | `https://registry.npmjs.org` | NPM registry to publish to                            |
| `private-npm-registry` | —                            | Private registry URL                                  |
| `private-npm-scope`    | —                            | Scope for private registry                            |
| `preid-branches`       | _(action default)_           | Branch → preid mapping e.g. `main:rc,develop:dev`     |
| `force-preid`          | `false`                      | Force preid even if branch doesn't match              |
| `on-version-conflict`  | `bump-patch`                       | `ignore`, `fail`, or `bump-patch` when a stable version's tag already exists. Passed through to `version-builder-action` (whose own default is `ignore`).       |
| `publish-command`      | `npm run release`            | Command used to publish                               |
| `version-replace`      | `0.0.0-PLACEHOLDER`          | Placeholder string to replace in source               |
| `version-replace-glob` | `src/version.ts`             | Glob of files to replace placeholder in; `""` to skip |

**Secrets** `private-npm-auth-token`

**Outputs**

| Output         | Example                    | Description                                                       |
| -------------- | -------------------------- | ------------------------------------------------------------------- |
| `version`      | `2.1.0-rc.5`               | Full published version; patch is bumped if `on-version-conflict` resolved a tag collision |
| `baseVersion`  | `2.1.0`                    | Version without preid         |
| `isPrerelease` | `true`                     | Whether this is a pre-release |
| `tag`          | `rc` / `latest` / `v1-lts` | NPM dist-tag used             |
| `majorVersion` | `2`                        | Major version number          |
| `minorVersion` | `1`                        | Minor version number          |
| `patchVersion` | `0`                        | Patch version number          |

---

### `prepare-release.yml` · `@release-v2`

After a pre-release publish on `main`, force-pushes the current HEAD to a `release/v{baseVersion}` branch, ensures the `v{major}` stable branch exists (creates it automatically on first use), and always creates (or updates) a PR from `release/v{baseVersion}` → `v{major}`. On first bootstrap, `v{major}` is created one commit behind the release branch so the PR has a real file diff — ensuring a squash merge onto `v{major}` always contains real changes and correctly triggers push-based workflows. Language-agnostic.

**Inputs**

| Input          | Required | Description                                               |
| -------------- | -------- | --------------------------------------------------------- |
| `base-version` | ✅        | e.g. `2.1.0`                                              |
| `title`        | —        | PR title override; defaults to `release: v{base-version}` |

**Secrets**

| Secret  | Required | Description                                                                                                                                                                                                                    |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `token` | —        | GitHub token to use. Defaults to `GITHUB_TOKEN`. **Public repos** must supply a PAT or GitHub App token with the `workflow` scope — `GITHUB_TOKEN` cannot push branches containing `.github/workflows/` files on public repos. |

---

### `create-release.yml` · `@release-v2`

Creates the exact `v{version}` Git tag and GitHub Release, then moves eligible stable channels. The publisher resolves and preflights the version before publication. The finalizer consumes it verbatim; it does not calculate another version. Canonical SemVer without build metadata is required.

Callers must serialize the entire publish/finalize flow per repository with `cancel-in-progress: false` and `queue: max`. Reruns reuse an exact tag only when it resolves to the workflow commit and reuse only a published release with matching prerelease state; conflicts, drafts, and non-404 API errors fail closed before mutation. Immediately before stable-channel mutation, the workflow re-reads the triggering branch ref and paginates stable exact tags. A moved branch or higher same-major version suppresses floating-tag mutation; a higher stable major also suppresses latest and makes `is-latest` false. A stable invocation triggered from a tag can still finish exact tag/release finalization, but it has no branch head to validate, so stable-channel mutations are skipped and `is-latest` is `false`. Pre-release and floating tags do not participate in stable comparisons.

**Inputs**

| Input              | Required | Default    | Description                                                                                                    |
| ------------------ | -------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `runs-on`           | —        | `"ubuntu-latest"` | JSON-encoded runner value passed to the release job, e.g. `"ubuntu-latest"` or `["blacksmith-4vcpu-ubuntu-2404"]`. |
| `timeout-minutes`   | —        | `15`       | Release job timeout in minutes.                                                                               |
| `version`           | ✅        | —          | Published canonical SemVer without build metadata, e.g. `2.1.0` or `2.1.0-rc.5`; consumed verbatim. Prerelease state is derived from this value. |

**Outputs**

| Output      | Example | Description                                                          |
| ----------- | ------- | -------------------------------------------------------------------- |
| `update-channels` | `true` | Whether an app may proceed to Docker channels/deployment. Allows RCs and current old-major releases, but excludes stale/superseded stable releases. The app still checks branch freshness immediately before channel updates. |
| `is-latest` | `true`  | String value `true` only when this stable release is on the highest stable major, the triggering branch still points at `github.sha`, and no higher same-major stable version exists. It is `false` for prereleases, tag-triggered stable calls, moved branches, and superseded stable releases; callers use `needs.release.outputs.is-latest == 'true'` to guard bump-main. |

---

### `node-bump-main.yml` · `@release-v2`

After a latest-major stable release, opens a PR for the released version's next minor. Retries reuse the same branch; an already advanced main is left unchanged. There are no CI skip markers. Callers must pass a `token` secret (PAT or GitHub App token) that can trigger PR checks, and guard with `create-release` output `is-latest == 'true'`. The optional `package-json-dir` input defaults to `.` for repositories whose version lives below the root.

**Inputs**

| Input              | Required | Default | Description                                         |
| ------------------ | -------- | ------- | --------------------------------------------------- |
| `released-version` | ✅        | —       | The just-released stable version e.g. `2.1.0`       |
| `default-branch`   | —        | `main`  | Branch to bump and target with the PR e.g. `master` |

---

### `dotnet-ci.yml` · `@dotnet-libs-v3`

Runs `dotnet restore`, `dotnet build`, and `dotnet test`. No publish.

**Inputs**

| Input                      | Default   | Description                                                                                                                                    |
| -------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet-version`           | `10.0.x`  | .NET SDK version                                                                                                                               |
| `dotnet-cfg`               | `Release` | Build configuration e.g. `Release`, `Debug`.                                                                                                   |
| `project-path`             | `./`      | Path to the project or mono repo sub-folder e.g. `./my-service`. Prepended to `solution-file` when resolving.                                  |
| `solution-file`            | —         | Solution or project file to build. When omitted, auto-resolved from `package.json#dotnetBuildSln`, then blank.                                 |
| `private-nuget-env-prefix` | —         | Env var prefix for NuGet credentials (must match `NuGet.Config` `%{PREFIX}_USERNAME%` / `%{PREFIX}_TOKEN%`). When set, configures credentials. |

**Secrets**

| Secret                   | Description                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `nuget-auth-token`       | Auth token for the private NuGet registry. Also used as `{PREFIX}_TOKEN` for private restore credentials. Defaults to `GITHUB_TOKEN`. |
| `private-nuget-username` | Username for private NuGet registry. Defaults to `github.actor`.                                                                      |

---

### `dotnet-publish.yml` · `@dotnet-libs-v3`

Resolves the version via `version-builder-action`, runs a fail-closed release preflight, then builds, packs, and pushes NuGet packages.

The preflight reads live, paginated branch, tag, exact-tag, and GitHub Release state before any version-file mutation, compilation, packing, or registry publication. It is read-only, but the reusable job grants `contents: write` so GitHub includes draft releases in the release listing. Authentication, authorization, rate-limit, transport, and malformed-response failures stop the job without falling back to local tags. During integration, the action is temporarily consumed from `sketch7/version-builder-action@feature/promotable-app-release-cycle`.

**Inputs**

| Input                      | Default                               | Description                                                                                                                                    |
| -------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dotnet-version`           | `10.0.x`                              | .NET SDK version                                                                                                                               |
| `dotnet-cfg`               | `Release`                             | Build configuration e.g. `Release`, `Debug`.                                                                                                   |
| `project-path`             | `./`                                  | Path to the project or mono repo sub-folder e.g. `./my-service`. Prepended to `solution-file` when resolving.                                  |
| `source-url`               | `https://api.nuget.org/v3/index.json` | NuGet source URL passed to `setup-dotnet` for credential configuration.                                                                        |
| `source-name`              | —                                     | NuGet source name (from `NuGet.Config`) used for `dotnet nuget push -s`. Falls back to `source-url` when omitted.                              |
| `solution-file`            | —                                     | Solution or project file to build. When omitted, auto-resolved from `package.json#dotnetBuildSln`, then blank.                                 |
| `private-nuget-env-prefix` | —                                     | Env var prefix for NuGet credentials (must match `NuGet.Config` `%{PREFIX}_USERNAME%` / `%{PREFIX}_TOKEN%`). When set, configures credentials. |
| `preid-branches`           | _(action default)_                    | Branch → preid mapping e.g. `main:rc,develop:dev`                                                                                              |
| `force-preid`              | `false`                               | Force preid even if branch doesn't match                                                                                                       |
| `on-version-conflict`      | `bump-patch`                                | `ignore`, `fail`, or `bump-patch` when a stable version's tag already exists. Passed through to `version-builder-action` (whose own default is `ignore`). |

**Secrets**

| Secret                   | Description                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `nuget-auth-token`       | Auth token for the NuGet publish source. Also used as `{PREFIX}_TOKEN` for private restore credentials. Defaults to `GITHUB_TOKEN`. |
| `private-nuget-username` | Username for private NuGet registry. Defaults to `github.actor`.                                                                    |

**Outputs** `version`, `baseVersion`, `isPrerelease`, `tag`, `majorVersion`

---

## Branch & Release Flow

PRs into `main` and `v*` run CI. A push to `main` publishes an RC and prepares the release PR; merging the release PR into `v1` publishes stable. Release-branch bootstrap pushes (`github.event.created`) must not publish. Older majors can release patches without becoming latest or bumping main.

---

## Usage Examples

### Node package (npm / pnpm)

> Minimal setup for a Node library published to a private registry using pnpm.

> **Public repo?** The `prepare-release` job must pass a PAT or GitHub App token with the `workflow` scope via `secrets: token`. Store it as a repository secret (e.g. `GH_PAT`) and add to the job:
>
> ```yaml
>   prepare-release:
>     ...
>     secrets:
>       token: ${{ secrets.GH_PAT }}
> ```
>
> Private repos work with the default `GITHUB_TOKEN` and no extra configuration.

**.github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: ["workflow"]
    paths-ignore: ["**.md"]
  pull_request:
    branches: [main, "v*"]
    paths-ignore: ["**.md"]

permissions:
  contents: read

jobs:
  ci:
    name: node CI
    uses: sketch7/.github/.github/workflows/node-ci.yml@node-libs-v3
    with:
      package-manager: pnpm
      private-npm-registry: ${{ vars.MY_NPM_REGISTRY }}
    secrets:
      private-npm-auth-token: ${{ secrets.MY_NPM_TOKEN }}
```

**.github/workflows/cd.yml**

```yaml
name: CD

concurrency:
  group: package-release-${{ github.repository }}
  cancel-in-progress: false
  queue: max

on:
  push:
    branches: [main, "v*", "workflow"]
    paths-ignore: ["**.md"]
  workflow_dispatch:
    inputs:
      publish:
        description: "Publish 🚀"
        type: boolean
        default: false
      force-prerelease:
        description: "Force Pre-release"
        type: boolean
        default: true

permissions:
  id-token: write
  contents: write
  packages: write
  pull-requests: write

jobs:
  publish:
    name: Publish
    if: |
      (github.event_name != 'push' || github.event.created == false) &&
      (contains(fromJSON('["main", "workflow"]'), github.ref_name) ||
       startsWith(github.ref_name, 'v') ||
       github.event.inputs.publish == 'true')
    uses: sketch7/.github/.github/workflows/node-publish.yml@node-libs-v3
    with:
      package-manager: pnpm
      private-npm-registry: ${{ vars.MY_NPM_REGISTRY }}
      force-preid: ${{ github.event.inputs.force-prerelease == 'true' }}
      version-replace-glob: "" # set to "src/version.ts" if you embed the version
    secrets:
      private-npm-auth-token: ${{ secrets.MY_NPM_TOKEN }}

  prepare-release:
    name: Prepare Release
    needs: publish
    if: |
      needs.publish.result == 'success' &&
      github.event_name == 'push' &&
      github.ref_name == 'main'
    uses: sketch7/.github/.github/workflows/prepare-release.yml@release-v2
    with:
      base-version: ${{ needs.publish.outputs.baseVersion }}

  release:
    name: Release
    needs: publish
    if: needs.publish.result == 'success'
    uses: sketch7/.github/.github/workflows/create-release.yml@release-v2
    with:
      version: ${{ needs.publish.outputs.version }}

  bump-main:
    name: Bump main
    needs: [publish, release]
    if: |
      needs.release.result == 'success' &&
      needs.release.outputs.is-latest == 'true' &&
      github.event_name == 'push'
    uses: sketch7/.github/.github/workflows/node-bump-main.yml@release-v2
    with:
      released-version: ${{ needs.publish.outputs.version }}
    secrets:
      token: ${{ secrets.GH_PAT }}
```

---

### .NET / NuGet package

> Minimal setup for a .NET library published to NuGet.org. For a **private registry** (e.g. GitHub Packages), set `private-nuget-env-prefix` and supply the matching credentials — see the private registry example below.

**.github/workflows/ci.yml**

```yaml
name: CI

on:
  push:
    branches: ["workflow"]
    paths-ignore: ["**.md"]
  pull_request:
    branches: [main, "v*"]
    paths-ignore: ["**.md"]

permissions:
  contents: read
  packages: read

jobs:
  ci:
    name: dotnet CI
    uses: sketch7/.github/.github/workflows/dotnet-ci.yml@dotnet-libs-v3
```

> With a **private NuGet registry** (e.g. GitHub Packages), add:
>
> ```yaml
> with:
>   private-nuget-env-prefix: MY_NUGET
>   source-name: my-nuget-source # source key in NuGet.Config
> secrets:
>   nuget-auth-token: ${{ secrets.GITHUB_TOKEN }}
> ```
>
> And in your `NuGet.Config` reference the env vars as `%MY_NUGET_USERNAME%` / `%MY_NUGET_TOKEN%`.

**.github/workflows/cd.yml**

```yaml
name: CD

concurrency:
  group: package-release-${{ github.repository }}
  cancel-in-progress: false
  queue: max

on:
  push:
    branches: [main, "v*", "workflow"]
    paths-ignore: ["**.md"]
  workflow_dispatch:
    inputs:
      publish:
        description: "Publish 🚀"
        type: boolean
        default: false
      force-prerelease:
        description: "Force Pre-release"
        type: boolean
        default: true

permissions:
  id-token: write
  contents: write
  packages: write

jobs:
  publish:
    name: Publish
    if: |
      (github.event_name != 'push' || github.event.created == false) &&
      (contains(fromJSON('["main", "workflow"]'), github.ref_name) ||
       startsWith(github.ref_name, 'v') ||
       github.event.inputs.publish == 'true')
    uses: sketch7/.github/.github/workflows/dotnet-publish.yml@dotnet-libs-v3
    with:
      force-preid: ${{ github.event.inputs.force-prerelease == 'true' }}
    secrets:
      nuget-auth-token: ${{ secrets.NUGET_TOKEN }}

  prepare-release:
    name: Prepare Release
    needs: publish
    if: |
      needs.publish.result == 'success' &&
      github.event_name == 'push' &&
      github.ref_name == 'main'
    uses: sketch7/.github/.github/workflows/prepare-release.yml@release-v2
    with:
      base-version: ${{ needs.publish.outputs.baseVersion }}

  release:
    name: Release
    needs: publish
    if: needs.publish.result == 'success'
    uses: sketch7/.github/.github/workflows/create-release.yml@release-v2
    with:
      version: ${{ needs.publish.outputs.version }}
```
