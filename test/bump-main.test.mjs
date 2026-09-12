import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/node-bump-main.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = workflow.split('          script: |\n').at(-1).replace(/^            /gm, '');
const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', 'require', 'process', script);

for (const {
  name,
  current,
  released,
  branchExists = false,
  directory = '.',
  expected,
  existingVersion = expected,
  changedFiles = [],
  existingPrTitle,
  expectedError,
} of [
  { name: 'bumps from released version, not main', current: '1.2.0', released: '1.3.4', expected: '1.4.0' },
  { name: 'does not bump an already advanced main', current: '1.5.0', released: '1.3.4', expected: null },
  { name: 'does not downgrade a future major', current: '2.0.0', released: '1.3.4', expected: null },
  {
    name: 'reuses an existing nested branch with only allowed files',
    current: '1.3.0',
    released: '1.3.4',
    branchExists: true,
    directory: 'src/management',
    expected: '1.4.0',
    changedFiles: ['src/management/package.json', 'src/management/package-lock.json', 'src/management/npm-shrinkwrap.json'],
  },
  {
    name: 'rejects existing branch changes outside package files',
    current: '1.3.0',
    released: '1.3.4',
    branchExists: true,
    directory: 'src/management',
    expected: '1.4.0',
    changedFiles: ['src/management/package.json', 'src/management/README.md'],
    expectedError: /unexpected files/,
  },
  {
    name: 'normalizes an existing skip-ci PR title',
    current: '1.3.0',
    released: '1.3.4',
    branchExists: true,
    expected: '1.4.0',
    changedFiles: ['package.json'],
    existingPrTitle: 'chore: bump version to 1.4.0 [skip ci]',
  },
]) {
  test(name, async () => {
    const commands = [];
    const prs = [];
    const updates = [];
    const github = { rest: { pulls: {
      list: async () => ({ data: existingPrTitle ? [{ number: 1, title: existingPrTitle }] : [] }),
      create: async input => { prs.push(input); return { data: { number: 1 } }; },
      update: async input => { updates.push(input); return { data: { number: 1 } }; },
    } } };
    const execute = () => run(github, { repo: { owner: 'test', repo: 'app' } }, { notice() {} }, moduleName => {
      if (moduleName === 'node:fs') return {
        readFileSync: () => JSON.stringify({ version: current }),
        existsSync: () => false,
      };
      if (moduleName === 'node:path') return {
        resolve: posix.resolve,
        relative: posix.relative,
        sep: posix.sep,
      };
      assert.equal(moduleName, 'node:child_process');
      return { execFileSync: (file, args) => {
        commands.push([file, ...args]);
        if (args[0] === 'ls-remote') return branchExists ? 'abc refs/heads/bump' : '';
        if (args[0] === 'merge-base') return 'base-sha';
        if (args[0] === 'diff') return changedFiles.join('\n');
        if (args[0] === 'show') return JSON.stringify({ version: existingVersion });
        return '';
      } };
    }, { cwd: () => '/workspace', env: { RELEASED_VERSION: released, DEFAULT_BRANCH: 'main', PACKAGE_JSON_DIR: directory } });

    if (expectedError) {
      await assert.rejects(execute, expectedError);
      assert.equal(prs.length, 0);
      assert.equal(updates.length, 0);
      return;
    }

    await execute();
    if (expected === null) {
      assert.equal(prs.length, 0);
      assert.equal(commands.length, 0);
    } else {
      const expectedBranch = `chore/bump-v${expected}`;
      if (existingPrTitle) {
        assert.equal(prs.length, 0);
        assert.equal(updates[0].title, `chore(release): bump version to ${expected}`);
      } else {
        assert.equal(prs[0].head, expectedBranch);
        assert.ok(!prs[0].title.includes('[skip ci]'));
      }
      assert.equal(commands.some(command => command[0] === 'npm'), !branchExists);
      if (branchExists) {
        assert.deepEqual(commands.find(command => command[0] === 'git' && command[1] === 'fetch'), [
          'git',
          'fetch',
          '--no-tags',
          'origin',
          'refs/heads/main:refs/remotes/origin/main',
          `refs/heads/${expectedBranch}:refs/remotes/origin/${expectedBranch}`,
        ]);
        assert.ok(commands.some(command => command[0] === 'git' && command[1] === 'merge-base'));
        assert.ok(commands.some(command => command[0] === 'git' && command[1] === 'diff' && command.at(-1) === `base-sha...refs/remotes/origin/${expectedBranch}`));
        assert.ok(!commands.some(command => command[0] === 'git' && command[1] === 'checkout' && command[2] === '-b'));
        assert.ok(!commands.some(command => command[0] === 'git' && command[1] === 'push'));
      } else {
        assert.ok(commands.some(command => command.includes(expected)));
      }
    }
  });
}
