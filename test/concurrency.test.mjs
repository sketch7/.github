import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = name => readFileSync(new URL("../.github/workflows/" + name, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const group = name => workflow(name).match(/^concurrency:\n {2}group: (.+)$/m)?.[1];

// A reusable workflow's concurrency group is shared by every caller on the same ref: two callers of the same
// track (e.g. a mono repo's Management CI + Delivery CI) must not cancel or drop each other's runs.
// In a reusable workflow `github.workflow` is the caller's name.
for (const name of ["dotnet-ci.yml", "dotnet-publish.yml", "node-ci.yml", "node-publish.yml"]) {
  test(name + ": concurrency group is scoped to the calling workflow", () => {
    assert.match(group(name), /\$\{\{ github\.workflow \}\}/);
    assert.match(group(name), /\$\{\{ github\.ref \}\}/);
  });
}

for (const name of ["dotnet-ci.yml", "dotnet-publish.yml"]) {
  test(name + ": concurrency group is scoped to the project path", () => {
    assert.match(group(name), /\$\{\{ inputs\.project-path \}\}/);
  });
}
