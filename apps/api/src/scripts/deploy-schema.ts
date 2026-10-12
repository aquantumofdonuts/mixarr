import 'dotenv/config';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';

const execute = promisify(execFile);
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const schema = fileURLToPath(new URL('../../prisma/schema.prisma', import.meta.url));
const baseline = fileURLToPath(new URL('../../prisma/baseline.prisma', import.meta.url));
const BASELINE = '0_v2_3_5';
const CONSTELLATION = '20261012000000_constellation';

/** Extra tables are ignored only in schema comparisons; this SQL is never executed. */
export function onlyUnmanagedTableDrops(sql: string, managed: ReadonlySet<string>): boolean {
  return sql.replace(/^--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean).every(statement => {
    const match = /^DROP TABLE `((?:[^`]|``)+)`$/.exec(statement);
    return !!match && !managed.has(match[1].replace(/``/g, '`'));
  });
}

async function prisma(...args: string[]): Promise<string> {
  const result = await execute(process.execPath, [prismaCli, ...args], { maxBuffer: 5 * 1024 * 1024 });
  return result.stdout;
}

/** Adopt verified db-push installations, then apply only checked-in migrations. */
export async function deploySchema(): Promise<void> {
  const db = new PrismaClient();
  try {
    const tables = await db.$queryRaw<Array<{ name: string }>>`
      SELECT table_name AS name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
    `;
    const history = tables.some(t => t.name === '_prisma_migrations')
      ? await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
          SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
        ` : [];
    if (history.some(m => !m.finished_at && !m.rolled_back_at)) {
      throw new Error('An unresolved migration failure exists. Inspect migration status before restarting; no automatic reset is permitted.');
    }
    const applied = new Set(history.filter(m => m.finished_at && !m.rolled_back_at).map(m => m.migration_name));
    const currentSchema = await readFile(schema, 'utf8');
    const managed = new Set([...currentSchema.matchAll(/@@map\("([^"]+)"\)/g)].map(m => m[1]));
    const matches = async (target: string) => onlyUnmanagedTableDrops(await prisma(
      'migrate', 'diff', '--from-schema-datasource', schema, '--to-schema-datamodel', target, '--script',
    ), managed);

    if (tables.some(t => t.name !== '_prisma_migrations') && !applied.has(BASELINE)) {
      const alreadyCurrent = await matches(schema);
      if (!alreadyCurrent && !await matches(baseline)) {
        throw new Error('Database does not match v2.3.5 or the current schema. Back up and inspect schema drift; no data or migration history was changed.');
      }
      console.log('Verified existing schema; recording the migration baseline.');
      console.log(await prisma('migrate', 'resolve', '--schema', schema, '--applied', BASELINE));
      if (alreadyCurrent && !applied.has(CONSTELLATION)) {
        console.log(await prisma('migrate', 'resolve', '--schema', schema, '--applied', CONSTELLATION));
      }
    }
    console.log(await prisma('migrate', 'deploy', '--schema', schema));
    if (!await matches(schema)) throw new Error('Deployed migrations do not match the application schema. Inspect schema drift before starting the API.');
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  deploySchema().catch(error => {
    console.error('Schema deployment failed:', error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
