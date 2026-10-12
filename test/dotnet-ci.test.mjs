import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/dotnet-ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const step = name => workflow.split(/(?=      - name: )/).find(s => s.startsWith(`      - name: ${name}\n`)) ?? "";
const input = name => workflow.match(new RegExp(`\n      ${name}:\n((?:        .+\n)+)`))?.[1] ?? "";
const expression = name => "$" + "{{ inputs." + name + " }}";

// A suite too slow for one serial `dotnet test` (e.g. integration tests run as parallel shards) brings its
// own runner. Defaults preserve the original behavior: built-in test step, default TRX glob, no extras.
const optional = [
  { input: "test-command", default: "" },
  { input: "test-results-path", default: "**/TestResults/*.trx" },
  { input: "test-artifacts-path", default: "" },
  { input: "node-version", default: "" },
];

for (const { input: name, default: value } of optional) {
  test(`dotnet-ci.yml: ${name} is optional and defaults to '${value}'`, () => {
    const source = input(name);
    assert.ok(source, `${name} input missing`);
    assert.match(source, /required: false/);
    assert.match(source, /type: string/);
    assert.ok(source.includes(`default: "${value}"`), source);
  });
}

test("dotnet-ci.yml: Test passes inputs via env, not shell interpolation", () => {
  const source = step("Test");
  for (const name of ["dotnet-cfg", "test-command", "test-filter"])
    assert.ok(source.includes(expression(name)), `${name} not passed`);
  assert.doesNotMatch(source.split("run:")[1] ?? "", /\$\{\{/);
});

test("dotnet-ci.yml: test-command replaces the built-in dotnet test and fails the step when it fails", () => {
  const run = step("Test").split("run:")[1] ?? "";
  const custom = run.indexOf('bash -eo pipefail -c "$TEST_COMMAND"');
  assert.ok(custom > run.indexOf('if [[ -n "$TEST_COMMAND" ]]'), run);
  assert.ok(run.indexOf("exit", custom) < run.indexOf("dotnet test"), run);
});

test("dotnet-ci.yml: the built-in test still runs the solution with --no-build", () => {
  assert.match(step("Test"), /dotnet test "\$SLN" -c "\$DOTNET_CFG" --no-build --logger trx/);
});

test("dotnet-ci.yml: the test report reads test-results-path", () => {
  const source = step("Test Report");
  assert.ok(source.includes("hashFiles(inputs.test-results-path)"), source);
  assert.ok(source.includes(`path: ${expression("test-results-path")}`), source);
});

test("dotnet-ci.yml: Node and the failure artifact are opt-in", () => {
  assert.ok(step("Setup Node").includes("if: inputs.node-version != ''"));
  assert.ok(step("Upload test artifacts").includes("failure() && inputs.test-artifacts-path != ''"));
});
