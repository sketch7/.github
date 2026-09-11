import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Execute the actual workflow script against real Git tags and a small GitHub API fake.
const workflow = readFileSync(new URL('../.github/workflows/create-release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const script = workflow.split('          script: |\n')[1].replace(/^            /gm, '');
const run = new (Object.getPrototypeOf(async function () {}).constructor)('github', 'context', 'core', 'require', 'process', script);
const notFound = () => { throw Object.assign(new Error('not found'), { status: 404 }); };

function fixture(t, version = '1.3.0') {
  const cwd = mkdtempSync(join(tmpdir(), 'release-finalizer-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  git('config', 'user.name', 'release-test');
  git('config', 'user.email', 'release-test@example.invalid');
  git('commit', '--allow-empty', '-qm', 'initial');
  const sha = git('rev-parse', 'HEAD');
  const state = { release: undefined, tags: [], branch: sha, writes: [], outputs: {}, pages: 0 };
  const github = {
    rest: {
      git: {
        getRef: async ({ ref }) => {
          if (ref === 'heads/v1') return { data: { object: { sha: state.branch } } };
          return notFound();
        },
        createRef: async data => { state.writes.push(['tag', data]); return { data }; },
        updateRef: async data => { state.writes.push(['float', data]); return { data }; },
      },
      repos: {
        getReleaseByTag: async () => state.release ? { data: state.release } : notFound(),
        createRelease: async data => {
          state.writes.push(['release', data]);
          return { data: { ...data, id: 42 } };
        },
        updateRelease: async data => { state.writes.push(['latest', data]); return { data }; },
        listTags: () => {},
      },
    },
    paginate: async (_method, options) => {
      assert.equal(options.per_page, 100);
      state.pages++;
      return state.tags.map(name => ({ name }));
    },
  };
  return {
    state, git, github, sha,
    execute: () => run(github, { repo: { owner: 'test', repo: 'app' }, sha, ref: 'refs/heads/v1' },
      { setOutput: (key, value) => { state.outputs[key] = value; }, notice: () => {} },
      name => {
        assert.equal(name, 'node:child_process');
        return { execFileSync: (file, args, options) => execFileSync(file, args, { ...options, cwd }) };
      }, { env: { VERSION: version } }),
  };
}

test('new stable finalizes exact tag before release, then latest and major channel', async t => {
  const f = fixture(t);
  await f.execute();
  assert.deepEqual(f.state.writes.map(([kind]) => kind), ['tag', 'release', 'tag', 'latest']);
  assert.equal(f.state.writes[0][1].ref, 'refs/tags/v1.3.0');
  assert.equal(f.state.writes[2][1].ref, 'refs/tags/v1');
  assert.equal(f.state.outputs['is-latest'], true);
});

test('prerelease creates exact release only', async t => {
  const f = fixture(t, '1.3.0-rc.5');
  await f.execute();
  assert.deepEqual(f.state.writes.map(([kind]) => kind), ['tag', 'release']);
  assert.equal(f.state.writes[1][1].prerelease, true);
  assert.equal(f.state.outputs['is-latest'], false);
});

test('annotated exact tag resumes missing release without recreating tag', async t => {
  const f = fixture(t);
  f.git('tag', '-a', 'v1.3.0', '-m', 'candidate');
  await f.execute();
  assert.equal(f.state.writes[0][0], 'release');
});

test('matching completed release is idempotent at finalization', async t => {
  const f = fixture(t);
  f.git('tag', 'v1.3.0');
  f.state.release = { id: 42, tag_name: 'v1.3.0', draft: false, prerelease: false };
  await f.execute();
  assert.equal(f.state.writes.some(([kind]) => kind === 'release'), false);
});

test('conflicting exact commit fails without writes', async t => {
  const f = fixture(t);
  f.git('commit', '--allow-empty', '-qm', 'other');
  f.git('tag', 'v1.3.0');
  await assert.rejects(f.execute(), /another commit/);
  assert.deepEqual(f.state.writes, []);
});

for (const conflict of ['draft', 'prerelease', 'missing-tag']) {
  test(`rejects ${conflict} release before writes`, async t => {
    const f = fixture(t);
    if (conflict !== 'missing-tag') f.git('tag', 'v1.3.0');
    f.state.release = { id: 42, tag_name: 'v1.3.0', draft: conflict === 'draft', prerelease: conflict === 'prerelease' };
    await assert.rejects(f.execute(), /conflicts/);
    assert.deepEqual(f.state.writes, []);
  });
}

test('higher stable major prevents latest but allows old-major channel', async t => {
  const f = fixture(t);
  f.state.tags = [...Array.from({ length: 100 }, (_, i) => `v1.0.0-rc.${i}`), 'v2.0.0'];
  await f.execute();
  assert.equal(f.state.pages, 1);
  assert.equal(f.state.outputs['is-latest'], false);
  assert.equal(f.state.writes.some(([kind, data]) => kind === 'tag' && data.ref === 'refs/tags/v1'), true);
});

test('higher prerelease does not take latest', async t => {
  const f = fixture(t);
  f.state.tags = ['v2.0.0-rc.1'];
  await f.execute();
  assert.equal(f.state.outputs['is-latest'], true);
});

test('newer same-major stable suppresses all channel mutation', async t => {
  const f = fixture(t);
  f.state.tags = ['v1.4.0'];
  await f.execute();
  assert.deepEqual(f.state.writes.map(([kind]) => kind), ['tag', 'release']);
});

test('large major comparison stays exact', async t => {
  const f = fixture(t, '9007199254740992.0.0');
  f.state.tags = ['v9007199254740993.0.0'];
  await f.execute();
  assert.equal(f.state.outputs['is-latest'], false);
});

test('stale branch finalizes but cannot move channels', async t => {
  const f = fixture(t);
  f.state.branch = '0'.repeat(40);
  await f.execute();
  assert.deepEqual(f.state.writes.map(([kind]) => kind), ['tag', 'release']);
});

test('authentication failure is not treated as absence', async t => {
  const f = fixture(t);
  f.github.rest.repos.getReleaseByTag = async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); };
  await assert.rejects(f.execute(), /unauthorized/);
  assert.deepEqual(f.state.writes, []);
});

test('invalid version fails before API writes', async t => {
  const f = fixture(t, '1.3.0-01');
  await assert.rejects(f.execute(), /canonical SemVer/);
  assert.deepEqual(f.state.writes, []);
});
