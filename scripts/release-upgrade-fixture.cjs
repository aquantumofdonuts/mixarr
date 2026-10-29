const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { PrismaClient } = require('/app/api/node_modules/@prisma/client');
const mode = process.argv[2];
const credentials = '/data/.mixarr_credentials';
const url = process.env.DATABASE_URL || `mysql://mixarr:${fs.readFileSync(credentials, 'utf8').trim().split('=')[1]}@127.0.0.1:3306/mixarr`;
const db = new PrismaClient({ datasources: { db: { url } } });
const base = 'http://127.0.0.1:3005';
const api = async (path, options = {}) => {
  const response = await fetch(base + path, { ...options, signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200, path);
  return { response, body: await response.json() };
};
const models = ['user','connection','subscription','subscriptionRun','subscriptionResult','reviewItem','userSetting','globalSetting','ssoProvider','authIdentity','notificationChannel','aISettings','slskdDownload'];
const snapshot = async () => {
  const records = {};
  for (const model of models) {
    records[model] = await db[model].findMany({ orderBy: { id: 'asc' } });
    if (model === 'subscription') for (const row of records[model]) { delete row.nextRun; delete row.updatedAt; }
  }
  const files = {};
  for (const file of [credentials, '/data/certs/cert.pem', '/data/certs/key.pem']) {
    if (fs.existsSync(file)) files[file] = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  return JSON.parse(JSON.stringify({ records, files }, (_, v) => typeof v === 'bigint' ? v.toString() : v));
};
(async () => {
  if (mode === 'seed') {
    const { response, body } = await api('/api/auth/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'upgrade-fixture', password: 'Disposable-upgrade-fixture-2026!', displayName: 'Upgrade Fixture' }) });
    const userId = body.user.id;
    fs.writeFileSync('/tmp/upgrade-cookie.txt', response.headers.get('set-cookie').split(';')[0]);
    const c = await db.connection.create({ data: { userId, type: 'lastfm', name: 'Retained connection', isActive: false, config: { apiKey: 'synthetic-key', username: 'fixture' } } });
    await db.connection.create({ data: { userId, type: 'spotify', name: 'Retained OAuth', isActive: false, config: { accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' } } });
    const sub = await db.subscription.create({ data: { userId, connectionId: c.id, name: 'Retained schedule', type: 'lastfm_library', config: { username: 'fixture' }, isActive: true, schedule: '0 0 1 1 *', resultHandling: 'queue' } });
    const run = await db.subscriptionRun.create({ data: { subscriptionId: sub.id, status: 'completed', resultsCount: 6, completedAt: new Date() } });
    for (const status of ['pending', 'queued', 'added', 'failed', 'rejected', 'skipped']) await db.subscriptionResult.create({ data: { subscriptionId: sub.id, runId: run.id, itemType: 'artist', name: 'Retained ' + status, status, sources: ['lastfm'] } });
    for (const status of ['pending', 'approved', 'rejected']) await db.reviewItem.create({ data: { userId, artistName: 'Retained ' + status, source: 'fixture', status } });
    await db.userSetting.create({ data: { userId, key: 'preferences', value: { theme: 'dark', defaultResultHandling: 'queue' } } });
    await db.globalSetting.create({ data: { key: 'setupCompleted', value: true } });
    await db.globalSetting.create({ data: { key: 'baseUrl', value: 'http://localhost:3000' } });
    const provider = process.env.RELEASE_UPGRADE_FROM === 'v2.3.5' ? 'oidc' : 'google';
    await db.ssoProvider.create({ data: { type: provider, name: 'Retained SSO', isEnabled: false, config: { issuer: 'https://example.invalid', clientId: 'fixture', clientSecret: 'synthetic-secret' } } });
    await db.authIdentity.create({ data: { userId, provider, providerUserId: 'fixture-subject', email: 'fixture@example.invalid' } });
    await db.notificationChannel.create({ data: { userId, type: 'webhook', name: 'Retained channel', isActive: false, config: { url: 'https://example.invalid' }, events: ['subscription_complete'] } });
    await db.aISettings.create({ data: { openaiEnabled: false, openaiApiKey: 'synthetic-key', openaiModel: 'retained-model' } });
    const slskd = await db.connection.create({ data: { userId, type: 'slskd', name: 'Retained download connection', isActive: false, config: { url: 'https://example.invalid', apiKey: 'synthetic-key' } } });
    await db.slskdDownload.create({ data: { connectionId: slskd.id, artistName: 'Retained artist', albumName: 'Retained album', username: 'synthetic-peer', filename: 'track.flac', fileSize: 12345n, status: 'completed', finalPath: '/music/fixture/track.flac' } });
    await db.$executeRawUnsafe('CREATE TABLE soulseek_diversions (id INT PRIMARY KEY, marker VARCHAR(100))');
    await db.$executeRaw`INSERT INTO soulseek_diversions VALUES (1, 'retained diversion')`;
  } else if (mode === 'legacy-schema') {
    assert.ok(['v2.0.0', 'v2.2.0'].includes(process.env.RELEASE_UPGRADE_FROM));
    const schema = fs.readFileSync('/tmp/upgrade-schema.prisma', 'utf8');
    const enumValues = name => {
      const match = new RegExp(`enum ${name}\\s*\\{([^}]+)\\}`).exec(schema);
      assert.ok(match, name);
      const entries = match[1].replace(/\/\/[^\n]*/g, '').trim().split(/\s+/);
      assert.ok(entries.every(value => /^[a-z_]+$/.test(value)));
      return entries;
    };
    const values = name => enumValues(name).map(value => `'${value}'`).join(',');
    await db.$executeRawUnsafe(`ALTER TABLE sso_providers MODIFY COLUMN type ENUM(${values('SsoProviderType')}) NOT NULL`);
    await db.$executeRawUnsafe(`ALTER TABLE auth_identities MODIFY COLUMN provider ENUM(${values('SsoProviderType')}) NOT NULL`);
    await db.$executeRawUnsafe(`ALTER TABLE subscriptions MODIFY COLUMN type ENUM(${values('SubscriptionType')}) NOT NULL`);
    const user = await db.user.findFirstOrThrow();
    for (const type of enumValues('SubscriptionType')) {
      await db.subscription.create({ data: { userId: user.id, name: `Retained ${type}`, type, config: {}, isActive: false } });
    }
    console.log(`Prepared synthetic ${process.env.RELEASE_UPGRADE_FROM} schema in the pinned v2.3.5 image.`);
  } else if (mode === 'snapshot') {
    console.log(JSON.stringify(await snapshot()));
  } else if (mode === 'verify') {
    const proxy = await fetch('http://127.0.0.1:3000/api/health', { signal: AbortSignal.timeout(10000) });
    assert.equal(proxy.status, 200, 'Bundled frontend proxies the API without an API_URL override');
    assert.equal((await proxy.json()).status, 'ok');
    const before = JSON.parse(fs.readFileSync('/tmp/upgrade-before.json', 'utf8'));
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(await db.$queryRaw`SELECT marker FROM soulseek_diversions WHERE id=1`, [{ marker: 'retained diversion' }]);
    assert.equal(await db.constellationPerson.count(), 0);
    for (const table of ['constellation_identity','constellation_edge','constellation_genre','constellation_orbit','constellation_owned']) {
      assert.equal((await db.$queryRaw`SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=${table}`)[0].n, 1n);
    }
    const cookie = fs.readFileSync('/tmp/upgrade-cookie.txt', 'utf8');
    const { body } = await api('/api/auth/me', { headers: { Cookie: cookie } });
    assert.equal(body.user.username, 'upgrade-fixture');
    assert.equal(body.setupRequired, false);
    for (const path of ['/api/imports/review/queue','/api/connections','/api/settings','/api/constellation/owned']) await api(path, { headers: { Cookie: cookie } });
    assert.ok((await db.subscription.findFirstOrThrow()).nextRun);
    console.log(JSON.stringify({ preservedRecords: Object.values(before.records).reduce((n, rows) => n + rows.length, 0), models: models.length, diversionPreserved: true, sessionPreserved: true, scheduleRestored: true }));
  } else if (mode === 'login') {
    const { body } = await api('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'upgrade-fixture', password: 'Disposable-upgrade-fixture-2026!' }) });
    assert.equal(body.user.username, 'upgrade-fixture');
  } else if (mode === 'fresh') {
    assert.equal(await db.user.count(), 0);
    assert.equal(await db.constellationPerson.count(), 0);
    assert.equal((await api('/api/auth/setup-required')).body.setupRequired, true);
    console.log('Fresh install is ready with all release migrations applied.');
  } else if (mode === 'drift') {
    await db.$executeRawUnsafe('ALTER TABLE users ADD COLUMN upgrade_guard_test VARCHAR(100)');
  } else { throw new Error('Unknown fixture mode'); }
})().finally(() => db.$disconnect()).catch(error => { console.error(error); process.exitCode = 1; });
