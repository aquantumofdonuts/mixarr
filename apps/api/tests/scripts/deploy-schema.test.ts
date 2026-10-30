import { describe, expect, it } from 'vitest';
import { onlyUnmanagedTableDrops } from '../../src/scripts/deploy-schema.js';

describe('schema baseline comparison', () => {
  const managed = new Set(['users', 'constellation_person']);
  it('accepts an identical schema and ignores only extra tables in a comparison', () => {
    expect(onlyUnmanagedTableDrops('-- This is an empty migration.\n', managed)).toBe(true);
    expect(onlyUnmanagedTableDrops('-- DropTable\nDROP TABLE `soulseek_diversions`;\n', managed)).toBe(true);
  });
  it.each([
    'DROP TABLE `users`;',
    'DROP TABLE `constellation_person`;',
    'ALTER TABLE `users` DROP COLUMN `email`;',
    'CREATE TABLE `users` (`id` INT);',
    'DROP TABLE `extra`; ALTER TABLE `users` ADD COLUMN `x` INT;',
    'DROP TABLE `extra` CASCADE;',
  ])('refuses required schema changes: %s', sql => {
    expect(onlyUnmanagedTableDrops(sql, managed)).toBe(false);
  });
  it('handles escaped identifiers without allowing multiple statements', () => {
    expect(onlyUnmanagedTableDrops('DROP TABLE `custom``table`;', managed)).toBe(true);
    expect(onlyUnmanagedTableDrops('DROP TABLE `custom`; DELETE FROM `users`;', managed)).toBe(false);
  });
});
