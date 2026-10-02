import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("../.github/workflows/node-ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const step = name => workflow.split(/(?=      - name: )/).find(s => s.startsWith(`      - name: ${name} (`)) ?? "";

// Mono repos (e.g. a .NET + Angular repo) keep their bare `build`/`test` scripts for the whole repo, so
// node CI must be able to run side-specific scripts instead. Defaults preserve the original behavior.
const scripts = [
  { step: "Format check", input: "fmt-check-script", default: "fmt:check", optional: true },
  { step: "Lint", input: "lint-script", default: "lint", optional: true },
  { step: "Build", input: "build-script", default: "build", optional: false },
  { step: "Test", input: "test-script", default: "test", optional: true },
];

for (const script of scripts) {
  test(`node-ci.yml: ${script.input} defaults to '${script.default}'`, () => {
    const input = workflow.match(new RegExp(`\n      ${script.input}:\n((?:        .+\n)+)`))?.[1];
    assert.ok(input, `${script.input} input missing`);
    assert.match(input, new RegExp(`default: "${script.default}"`));
    assert.match(input, /type: string/);
  });

  test(`node-ci.yml: ${script.step} runs ${script.input} via env, not shell interpolation`, () => {
    const source = step(script.step);
    assert.ok(source.startsWith(`      - name: ${script.step} (` + "$" + "{{ inputs." + script.input + " }})\n"), source);
    assert.ok(source.includes("SCRIPT: " + "$" + "{{ inputs." + script.input + " }}"), source);
    assert.doesNotMatch(source.split("run:")[1] ?? "", /\$\{\{/);
    assert.equal(/--if-present/.test(source), script.optional);
  });
}
