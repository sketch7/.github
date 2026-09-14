import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = name => readFileSync(new URL("../.github/workflows/" + name, import.meta.url), "utf8").replace(/\r\n/g, "\n");

for (const name of ["node-publish.yml", "dotnet-publish.yml"]) {
  test(name + ": preflight precedes setup and gates every publishing step", () => {
    const source = workflow(name);
    assert.ok(source.indexOf("id: version-builder") < source.indexOf("- name: Setup"));
    const steps = source.split(/(?=      - name: )/).slice(1);
    for (const step of steps) {
      if (/- name: (Checkout|Build version|Upload dist on failure)\n/.test(step)) continue;
      assert.ok(step.includes("if: steps.version-builder.outputs.skip-publish != 'true'"), step);
    }
  });
}

test("empty publisher outputs cannot create release branches or releases", () => {
  assert.match(workflow("prepare-release.yml"), /  prepare-release:\n    if: inputs.base-version != ''/);
  assert.match(workflow("create-release.yml"), /  create-release:\n    if: inputs.version != ''/);
});
