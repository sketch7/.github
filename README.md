# workflows

Reusable GitHub Actions workflows for Node and .NET packages. Provides separate, composable workflows for CI checks, publishing, release PR preparation, and GitHub Release creation.

## Tags

| Tag              | Workflows                                                       |
| ---------------- | --------------------------------------------------------------- |
| `node-libs-v1`   | `node-lib.yml` (deprecated — use v2 split workflows)            |
| `node-libs-v2`   | `node-ci.yml`, `node-publish.yml`                               |
| `dotnet-libs-v1` | `dotnet-package.yml` (deprecated — use v2 split workflows)      |
| `dotnet-libs-v2` | `dotnet-ci.yml`, `dotnet-publish.yml`                           |
| `release-v1`     | `prepare-release.yml`, `create-release.yml` (language-agnostic) |

```bash
# move tag (shorthand)
TAG=<TAG> && git tag -f $TAG && git push origin $TAG -f
```

---

## Workflows

### `node-ci.yml` · `@node-libs-v2`

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

### `node-publish.yml` · `@node-libs-v2`

Resolves the version via `version-builder-action`, bumps `package.json`, installs, builds, and publishes the package. Designed to run **after** `node-ci.yml` — does not repeat lint/test.

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
| `publish-command`      | `npm run release`            | Command used to publish                               |
| `version-replace`      | `0.0.0-PLACEHOLDER`          | Placeholder string to replace in source               |
| `version-replace-glob` | `src/version.ts`             | Glob of files to replace placeholder in; `""` to skip |

**Secrets** `private-npm-auth-token`

**Outputs**

| Output         | Example                    | Description                   |
| -------------- | -------------------------- | ----------------------------- |
| `version`      | `2.1.0-rc.5`               | Full published version        |
| `baseVersion`  | `2.1.0`                    | Version without preid         |
| `isPrerelease` | `true`                     | Whether this is a pre-release |
| `tag`          | `rc` / `latest` / `v1-lts` | NPM dist-tag used             |
| `majorVersion` | `2`                        | Major version number          |
| `minorVersion` | `1`                        | Minor version number          |
| `patchVersion` | `0`                        | Patch version number          |

---

### `prepare-release.yml` · `@release-v1`

After a pre-release publish on `main`, force-pushes the current HEAD to a `release/v{baseVersion}` branch and creates (or updates) a PR targeting the `v{major}` stable branch. Language-agnostic.

**Inputs**

| Input          | Required | Description                                              |
| -------------- | -------- | -------------------------------------------------------- |
| `base-version` | ✅        | e.g. `2.1.0`                                             |
| `title`        | —        | PR title override; defaults to `Release v{base-version}` |

---

### `create-release.yml` · `@release-v1`

Creates the exact git tag (`v2.1.0`), force-updates the floating major tag (`v2`), and publishes a GitHub Release with auto-generated notes. Automatically determines whether to mark the release as `--latest` by comparing the major version against all existing tags. Language-agnostic — used by both Node and .NET publish flows.

**Inputs**

| Input      | Required | Default    | Description                                                                                                    |
| ---------- | -------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `version`  | ✅        | —          | e.g. `2.1.0`                                                                                                   |
| `tag-tmpl` | —        | `v{major}` | Tag template; `{major}` is replaced with the major version number. e.g. `v{major}` → `v2`, `{major}.x` → `2.x` |

---

### `dotnet-ci.yml` · `@dotnet-libs-v2`

Runs `dotnet restore`, `dotnet build`, and `dotnet test`. No publish.

**Inputs**

| Input            | Default  | Description      |
| ---------------- | -------- | ---------------- |
| `dotnet-version` | `10.0.x` | .NET SDK version |

---

### `dotnet-publish.yml` · `@dotnet-libs-v2`

Resolves the version via `version-builder-action`, builds, packs, and pushes NuGet packages.

**Inputs**

| Input            | Default                               | Description                              |
| ---------------- | ------------------------------------- | ---------------------------------------- |
| `dotnet-version` | `10.0.x`                              | .NET SDK version                         |
| `source-url`     | `https://api.nuget.org/v3/index.json` | NuGet source URL                         |
| `preid-branches` | _(action default)_                    | Branch → preid mapping                   |
| `force-preid`    | `false`                               | Force preid even if branch doesn't match |

**Secrets** `nuget-auth-token`

**Outputs** `version`, `baseVersion`, `isPrerelease`, `tag`, `majorVersion`

---

## Branch & Release Flow

```mermaid
flowchart TD
    PR["Pull Request → main"] -->|on: pull_request| CI
    PUSH_MAIN["Push to main"] -->|on: push| CI
    PUSH_MAIN --> CD_publish

    CD_publish["CD: publish job<br/>node-publish.yml<br/>→ publishes 2.1.0-rc.5 --tag rc"]
    CD_publish -->|"ref_name == 'main'"| PrepareRelease
    PrepareRelease["CD: prepare-release job<br/>prepare-release.yml<br/>→ creates/updates PR<br/>release/v2.1.0 → v2"]

    RELEASE_PR["Release PR merged<br/>(release/v2.1.0 → v2)"] -->|on: push to v2| CI2
    RELEASE_PR --> CD_stable

    CI["CI workflow<br/>node-ci.yml<br/>→ lint, build, test"]
    CI2["CI workflow<br/>node-ci.yml<br/>→ lint, build, test"]

    CD_stable["CD: publish job<br/>node-publish.yml<br/>→ publishes 2.1.0 --tag latest"]
    CD_stable -->|"isPrerelease == false"| CreateRelease

    CreateRelease["CD: release job<br/>create-release.yml<br/>→ tag v2.1.0<br/>→ float tag v2<br/>→ GitHub Release ✨"]

    PUSH_LTS["Push to v1 (LTS fix)"] -->|on: push| CI3
    PUSH_LTS --> CD_lts

    CI3["CI workflow<br/>node-ci.yml<br/>→ lint, build, test"]

    CD_lts["CD: publish job<br/>node-publish.yml<br/>→ publishes 1.5.3 --tag v1-lts"]
    CD_lts -->|"isPrerelease == false"| CreateRelease2

    CreateRelease2["CD: release job<br/>create-release.yml<br/>→ tag v1.5.3<br/>→ float tag v1<br/>→ GitHub Release (non-latest) ✨"]

    style PrepareRelease fill:#dbeafe,stroke:#3b82f6
    style CreateRelease fill:#dcfce7,stroke:#16a34a
    style CreateRelease2 fill:#dcfce7,stroke:#16a34a
    style CD_publish fill:#fef9c3,stroke:#ca8a04
    style CD_stable fill:#fef9c3,stroke:#ca8a04
    style CD_lts fill:#fef9c3,stroke:#ca8a04
```

---

## Usage Examples

### Node package (npm / pnpm)

> Minimal setup for a Node library published to a private registry using pnpm.

**.github/workflows/ci.yml**
```yaml
name: CI

on:
  push:
    branches: [main, "v*", "workflow"]
    paths-ignore: ["**.md"]
  pull_request:
    branches: [main, "v*"]
    paths-ignore: ["**.md"]

permissions:
  contents: read

jobs:
  ci:
    name: CI
    uses: sketch7/.github/.github/workflows/node-ci.yml@node-libs-v2
    with:
      package-manager: pnpm
      private-npm-registry: ${{ vars.MY_NPM_REGISTRY }}
    secrets:
      private-npm-auth-token: ${{ secrets.MY_NPM_TOKEN }}
```

**.github/workflows/cd.yml**
```yaml
name: CD

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
      contains(fromJSON('["main", "workflow"]'), github.ref_name) ||
      startsWith(github.ref_name, 'v') ||
      github.event.inputs.publish == 'true'
    uses: sketch7/.github/.github/workflows/node-publish.yml@node-libs-v2
    with:
      package-manager: pnpm
      private-npm-registry: ${{ vars.MY_NPM_REGISTRY }}
      force-preid: ${{ github.event.inputs.force-prerelease == 'true' }}
      version-replace-glob: "" # set to "src/version.ts" if you embed the version
    secrets:
      private-npm-auth-token: ${{ secrets.MY_NPM_TOKEN }}

  prepare-release:
    name: Prepare Release PR
    needs: publish
    if: |
      needs.publish.result == 'success' &&
      github.event_name == 'push' &&
      github.ref_name == 'main'
    uses: sketch7/.github/.github/workflows/prepare-release.yml@release-v1
    with:
      base-version: ${{ needs.publish.outputs.baseVersion }}

  release:
    name: Release
    needs: publish
    if: |
      needs.publish.result == 'success' &&
      !fromJSON(needs.publish.outputs.isPrerelease)
    uses: sketch7/.github/.github/workflows/create-release.yml@release-v1
    with:
      version: ${{ needs.publish.outputs.version }}
```

---

### .NET / NuGet package

**.github/workflows/ci.yml**
```yaml
name: CI

on:
  push:
    branches: [main, "v*", "workflow"]
    paths-ignore: ["**.md"]
  pull_request:
    branches: [main, "v*"]
    paths-ignore: ["**.md"]

permissions:
  contents: read

jobs:
  ci:
    name: CI
    uses: sketch7/.github/.github/workflows/dotnet-ci.yml@dotnet-libs-v2
```

**.github/workflows/cd.yml**
```yaml
name: CD

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

jobs:
  publish:
    name: Publish
    if: |
      contains(fromJSON('["main", "workflow"]'), github.ref_name) ||
      startsWith(github.ref_name, 'v') ||
      github.event.inputs.publish == 'true'
    uses: sketch7/.github/.github/workflows/dotnet-publish.yml@dotnet-libs-v2
    with:
      force-preid: ${{ github.event.inputs.force-prerelease == 'true' }}
      source-url: https://api.nuget.org/v3/index.json
    secrets:
      nuget-auth-token: ${{ secrets.NUGET_TOKEN }}

  prepare-release:
    name: Prepare Release PR
    needs: publish
    if: |
      needs.publish.result == 'success' &&
      github.event_name == 'push' &&
      github.ref_name == 'main'
    uses: sketch7/.github/.github/workflows/prepare-release.yml@release-v1
    with:
      base-version: ${{ needs.publish.outputs.baseVersion }}

  release:
    name: Release
    needs: publish
    if: |
      needs.publish.result == 'success' &&
      !fromJSON(needs.publish.outputs.isPrerelease)
    uses: sketch7/.github/.github/workflows/create-release.yml@release-v1
    with:
      version: ${{ needs.publish.outputs.version }}
```

---

## Deprecated Workflows

| Workflow                               | Replaced by                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `node-lib.yml` `@node-libs-v1`         | `node-ci.yml` + `node-publish.yml` + `prepare-release.yml` + `create-release.yml` `@node-libs-v2` / `@release-v1` |
| `dotnet-package.yml` `@dotnet-libs-v1` | `dotnet-ci.yml` + `dotnet-publish.yml` + `create-release.yml` `@dotnet-libs-v2` / `@release-v1`                   |