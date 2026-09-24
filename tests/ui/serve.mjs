// Starts `flowmap serve` for the UI tests on a fresh temp copy of fixtures/purchase-request.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = process.env.FLOWMAP_E2E_DIR;
const port = process.env.FLOWMAP_E2E_PORT;
if (!dir || !port) throw new Error('FLOWMAP_E2E_DIR and FLOWMAP_E2E_PORT must be set');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
cpSync(join(root, 'fixtures/purchase-request'), dir, { recursive: true });

const child = spawn(process.execPath, [join(root, 'dist/cli.js'), 'serve', dir, '--port', port], { stdio: 'inherit' });
const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', (code) => process.exit(code ?? 0));
