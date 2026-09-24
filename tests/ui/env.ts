// Where the UI tests' server runs, shared by playwright.config.ts and the tests (they run in other processes).
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_PORT = Number(process.env.FLOWMAP_E2E_PORT ?? 4987);
export const E2E_DIR = process.env.FLOWMAP_E2E_DIR ?? join(tmpdir(), `flowmap-ui-e2e-${E2E_PORT}`);
