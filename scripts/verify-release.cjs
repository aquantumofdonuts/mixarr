const fs = require('node:fs');
const path = require('node:path');

const requiredChecks = [
  'Lint & Typecheck', 'Test', 'Build', 'Release migration safety',
  'Release image (unified)', 'Release image (slim)', 'E2E Smoke Tests', 'CodeQL',
];

function readVersions(root) {
  const manifests = ['', 'apps/api', 'apps/web', 'packages/config', 'packages/shared-types'];
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const lock = read('package-lock.json');
  return [read('package.json').version, lock.version,
    ...manifests.flatMap(dir => [read(path.join(dir, 'package.json')).version, lock.packages[dir]?.version])];
}

function verifyRelease({ tag, sha, prodSha, versions, checks }) {
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/.test(tag)) {
    throw new Error('An existing vX.Y.Z release tag is required');
  }
  if (!sha || sha !== prodSha) throw new Error('The release tag must point to the current prod commit');
  if (!versions.length || versions.some(version => version !== tag.slice(1))) {
    throw new Error('Release tag, package manifests and lockfile versions must match');
  }
  for (const name of requiredChecks) {
    const latest = checks.filter(check => check.name === name).sort((a, b) => b.id - a.id)[0];
    if (!latest || latest.status !== 'completed' || latest.conclusion !== 'success') {
      throw new Error(`Release requires a successful ${name} check on the tagged prod commit`);
    }
  }
}

module.exports = { requiredChecks, readVersions, verifyRelease };
