import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const target = process.env.RELEASE_UPGRADE_TEST_DATABASE_URL;
const allowed = 'mysql://root@127.0.0.1:13316/mixarr_upgrade_test';
if (target && target !== allowed) throw new Error('Only the disposable release upgrade database is permitted');
const db = new PrismaClient({ datasources: { db: { url: allowed } } });
const execute = promisify(execFile);
const require = createRequire(import.meta.url);
const env = { ...process.env, DATABASE_URL: allowed };
const cli = (...args: string[]) => execute(process.execPath, [require.resolve('prisma/build/index.js'), ...args], { env });
const deploy = () => execute(process.execPath, [require.resolve('tsx/cli'), 'src/scripts/deploy-schema.ts'], { env });
const oldSchema = () => cli('db', 'execute', '--file', 'prisma/migrations/0_v2_3_5/migration.sql', '--schema', 'prisma/schema.prisma');
const legacySchema = (version: string) => `prisma/upgrade-schemas/${version}.prisma`;
const extra = async () => {
  await db.$executeRawUnsafe('CREATE TABLE soulseek_diversions (id INT PRIMARY KEY, marker VARCHAR(100))');
  await db.$executeRaw`INSERT INTO soulseek_diversions VALUES (1, 'preserve this diversion')`;
};
const assertExtra = async () => expect(await db.$queryRaw`SELECT marker FROM soulseek_diversions WHERE id=1`).toEqual([{ marker: 'preserve this diversion' }]);
const historyCount = async () => (await db.$queryRaw<Array<{ n: bigint }>>`
  SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='_prisma_migrations'
`)[0].n;

describe.skipIf(!target)('release schema deployment against disposable MySQL', () => {
  beforeEach(async () => {
    await db.$disconnect();
    const admin = new PrismaClient({ datasources: { db: { url: 'mysql://root@127.0.0.1:13316/mysql' } } });
    try {
      await admin.$executeRawUnsafe('DROP DATABASE IF EXISTS mixarr_upgrade_test');
      await admin.$executeRawUnsafe('CREATE DATABASE mixarr_upgrade_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
    } finally { await admin.$disconnect(); }
  });
  afterAll(() => db.$disconnect());

  it('installs fresh and preserves extra tables on repeat deployment', async () => {
    await deploy();
    await extra();
    await deploy();
    await assertExtra();
    expect(await db.constellationPerson.count()).toBe(0);
  });
  it('adopts v2.3.5 without changing account, configuration or diversion data', async () => {
    await oldSchema();
    const user = await db.user.create({ data: { username: 'release-fixture', displayName: 'Retained User', passwordHash: 'retained-hash' } });
    const setting = await db.userSetting.create({ data: { userId: user.id, key: 'preferences', value: { theme: 'dark' } } });
    await extra();
    await deploy();
    expect(await db.user.findUnique({ where: { id: user.id } })).toEqual(user);
    expect(await db.userSetting.findUnique({ where: { id: setting.id } })).toEqual(setting);
    await assertExtra();
    expect(await db.constellationPerson.count()).toBe(0);
    expect(await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`).toEqual([
      { migration_name: '0_v2_3_5' }, { migration_name: '20261011000000_legacy_enum_expansion' }, { migration_name: '20261012000000_constellation' },
    ]);
  });
  it.each(['v2.0.0', 'v2.1.0'])('upgrades the %s release schema while preserving every stored enum value and existing records', async version => {
    await cli('db', 'push', '--schema', legacySchema(version), '--skip-generate');
    const user = await db.user.create({ data: { username: 'older-release', displayName: 'Retained account', passwordHash: 'retained-hash' } });
    const setting = await db.userSetting.create({ data: { userId: user.id, key: 'preferences', value: { theme: 'dark' } } });
    const connection = await db.connection.create({ data: { userId: user.id, type: 'spotify', name: 'Retained OAuth', config: { refreshToken: 'synthetic-refresh' } } });
    const source = await readFile(legacySchema(version), 'utf8');
    const subscriptionTypes = /enum SubscriptionType\s*\{([^}]+)\}/.exec(source)![1].replace(/\/\/[^\n]*/g, '').trim().split(/\s+/);
    for (const type of subscriptionTypes) {
      await db.$executeRaw`INSERT INTO subscriptions (user_id,name,type,config,updated_at) VALUES (${user.id},${type},${type},'{}',NOW())`;
    }
    for (const provider of ['ldap', 'saml', 'google', 'plex'] as const) {
      await db.ssoProvider.create({ data: { type: provider, name: provider, config: { retained: true } } });
      await db.authIdentity.create({ data: { userId: user.id, provider, providerUserId: provider, email: `${provider}@example.invalid` } });
    }
    const subscriptions = await db.subscription.findMany({ orderBy: { id: 'asc' } });
    const providers = await db.ssoProvider.findMany({ orderBy: { id: 'asc' } });
    const identities = await db.authIdentity.findMany({ orderBy: { id: 'asc' } });
    await extra();
    await deploy();
    await deploy();
    expect(await db.user.findUnique({ where: { id: user.id } })).toEqual(user);
    expect(await db.userSetting.findUnique({ where: { id: setting.id } })).toEqual(setting);
    expect(await db.connection.findUnique({ where: { id: connection.id } })).toEqual(connection);
    expect(await db.subscription.findMany({ orderBy: { id: 'asc' } })).toEqual(subscriptions);
    expect(await db.ssoProvider.findMany({ orderBy: { id: 'asc' } })).toEqual(providers);
    expect(await db.authIdentity.findMany({ orderBy: { id: 'asc' } })).toEqual(identities);
    await assertExtra();
    expect(await db.constellationPerson.count()).toBe(0);
    await db.ssoProvider.create({ data: { type: 'oidc', name: 'New OIDC provider', config: {} } });
    await db.authIdentity.create({ data: { userId: user.id, provider: 'oidc', providerUserId: 'new-subject', email: 'oidc@example.invalid' } });
    await db.subscription.create({ data: { userId: user.id, name: 'New extended Last.fm subscription', type: 'lastfm_weekly_artists', config: {} } });
  });
  it('refuses unknown enum values before changing data or migration history even with a recorded baseline', async () => {
    await cli('db', 'push', '--schema', legacySchema('v2.1.0'), '--skip-generate');
    await cli('migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', '0_v2_3_5');
    await db.$executeRawUnsafe("ALTER TABLE sso_providers MODIFY COLUMN type ENUM('ldap','saml','google','plex','custom_provider') NOT NULL");
    await db.$executeRawUnsafe("INSERT INTO sso_providers (type,name,config,updated_at) VALUES ('custom_provider','Retained custom provider','{}',NOW())");
    const history = await db.$queryRaw`SELECT * FROM _prisma_migrations`;
    await extra();
    await expect(deploy()).rejects.toThrow('Database does not match');
    expect(await db.$queryRaw`SELECT type FROM sso_providers`).toEqual([{ type: 'custom_provider' }]);
    expect(await db.$queryRaw`SELECT * FROM _prisma_migrations`).toEqual(history);
    await assertExtra();
  });
  it('adopts an already-current db-push database without losing graph data', async () => {
    await oldSchema();
    await cli('db', 'execute', '--file', 'prisma/migrations/20261012000000_constellation/migration.sql', '--schema', 'prisma/schema.prisma');
    await db.constellationPerson.create({ data: { personId: 42, displayName: 'Retained graph person' } });
    await extra();
    await deploy();
    expect((await db.constellationPerson.findUniqueOrThrow({ where: { personId: 42 } })).displayName).toBe('Retained graph person');
    await assertExtra();
  });
  it('adopts the compatibility migration on an already-migrated current database without replaying table creation', async () => {
    await oldSchema();
    await cli('db', 'execute', '--file', 'prisma/migrations/20261012000000_constellation/migration.sql', '--schema', 'prisma/schema.prisma');
    for (const name of ['0_v2_3_5', '20261012000000_constellation']) {
      await cli('migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', name);
    }
    await db.constellationPerson.create({ data: { personId: 43, displayName: 'Existing migrated person' } });
    await extra();
    await deploy();
    await deploy();
    expect((await db.constellationPerson.findUniqueOrThrow({ where: { personId: 43 } })).displayName).toBe('Existing migrated person');
    await assertExtra();
    expect(await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name='20261011000000_legacy_enum_expansion' AND finished_at IS NOT NULL`).toEqual([
      { migration_name: '20261011000000_legacy_enum_expansion' },
    ]);
  });
  it('retains completed historical migration records when adopting v2.3.5', async () => {
    await oldSchema();
    await cli('migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', '0_v2_3_5');
    const checksum = createHash('sha256').update(await readFile('prisma/legacy-migrations/20260522000001_add_oidc_provider/migration.sql')).digest('hex');
    await db.$executeRaw`UPDATE _prisma_migrations SET migration_name='20260522000001_add_oidc_provider', checksum=${checksum} WHERE migration_name='0_v2_3_5'`;
    await extra();
    await deploy();
    await assertExtra();
    expect(await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE migration_name='20260522000001_add_oidc_provider' AND finished_at IS NOT NULL`).toEqual([
      { migration_name: '20260522000001_add_oidc_provider' },
    ]);
    expect(await db.constellationPerson.count()).toBe(0);
  });
  it('refuses existing schema drift before writing migration history or removing data', async () => {
    await oldSchema();
    await extra();
    await db.$executeRawUnsafe('ALTER TABLE users ADD COLUMN retained_custom_column VARCHAR(100)');
    await expect(deploy()).rejects.toThrow('Database does not match');
    expect(await historyCount()).toBe(0n);
    await assertExtra();
  });
  it('refuses partial constellation layouts before recording a baseline', async () => {
    await oldSchema();
    const sql = await readFile('prisma/migrations/20261012000000_constellation/migration.sql', 'utf8');
    await db.$executeRawUnsafe(sql.split(';')[0]);
    await expect(deploy()).rejects.toThrow('Database does not match');
    expect(await historyCount()).toBe(0n);
  });
  it('does not clear unresolved migration failures', async () => {
    await oldSchema();
    await cli('migrate', 'resolve', '--schema', 'prisma/schema.prisma', '--applied', '0_v2_3_5');
    await db.$executeRaw`INSERT INTO _prisma_migrations (id,checksum,migration_name) VALUES ('test-failed-migration','synthetic-checksum','20261012000000_constellation')`;
    await expect(deploy()).rejects.toThrow('unresolved migration failure');
    expect(await db.$queryRaw`SELECT finished_at FROM _prisma_migrations WHERE id='test-failed-migration'`).toEqual([{ finished_at: null }]);
  });
});
