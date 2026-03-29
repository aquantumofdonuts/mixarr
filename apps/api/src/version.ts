import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

export const VERSION = pkg.version;
export const LICENSE = 'GPL-3.0';
export const PRODUCT = 'Mixarr';

/**
 * Print startup banner with ASCII art logo
 */
export function printBanner(): void {
  const versionLine = `  Version: v${VERSION}`.padEnd(30) + `License: ${LICENSE}`.padEnd(28);
  const banner = `
╔══════════════════════════════════════════════════════════╗
║                                                          ║
║   __  __ _                                               ║
║  |  \\/  (_)_  ____ _ _ __ _ __                           ║
║  | |\\/| | \\ \\/ / _\` | '__| '__|                          ║
║  | |  | | |>  < (_| | |  | |                             ║
║  |_|  |_|_/_/\\_\\__,_|_|  |_|                             ║
║                                                          ║
║  Music Discovery for Lidarr                              ║
║                                                          ║
║${versionLine}║
╚══════════════════════════════════════════════════════════╝
`;
  console.log(banner);
}
