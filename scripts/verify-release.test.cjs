const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requiredChecks, readVersions, verifyRelease } = require('./verify-release.cjs');
const version = require('../package.json').version;

const valid = () => ({
  tag: `v${version}`, sha: 'reviewed-prod-commit', prodSha: 'reviewed-prod-commit', versions: [version, version],
  checks: requiredChecks.map((name, id) => ({ name, id, status: 'completed', conclusion: 'success' })),
});
test('allows a versioned, fully tested release from the current production commit', () => {
  verifyRelease(valid());
  verifyRelease({ ...valid(), versions: readVersions(process.cwd()) });
});
test('rejects arbitrary aliases and branch refs', () => {
  for (const tag of ['latest', 'dev', 'v3.0.0;echo injected']) assert.throws(() => verifyRelease({ ...valid(), tag }));
});
test('rejects unreviewed branches and stale release tags', () => {
  assert.throws(() => verifyRelease({ ...valid(), sha: 'dev-commit' }), /current prod/);
  assert.throws(() => verifyRelease({ ...valid(), sha: 'older-prod-commit' }), /current prod/);
});
test('rejects package and lockfile version drift', () => {
  assert.throws(() => verifyRelease({ ...valid(), versions: ['3.0.0', '2.3.5'] }), /versions must match/);
  assert.throws(() => verifyRelease({ ...valid(), versions: ['3.0.0', undefined] }), /versions must match/);
});
test('rejects every missing, failed, skipped or unfinished release check', () => {
  for (const name of requiredChecks) {
    const input = valid();
    assert.throws(() => verifyRelease({ ...input, checks: input.checks.filter(check => check.name !== name) }));
    for (const conclusion of ['failure', 'skipped', null]) {
      assert.throws(() => verifyRelease({ ...input, checks: input.checks.map(check => check.name === name ? { ...check, conclusion } : check) }));
    }
  }
});
test('a successful older attempt cannot mask a newer failed or running check', () => {
  const input = valid();
  for (const status of ['completed', 'in_progress']) assert.throws(() => verifyRelease({ ...input,
    checks: [...input.checks, { name: 'Test', id: 100, status, conclusion: status === 'completed' ? 'failure' : null }],
  }));
});
