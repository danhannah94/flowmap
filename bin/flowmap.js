#!/usr/bin/env node
// Committed launcher so `pnpm install` can link the `flowmap` bin before `pnpm build` has produced dist/cli.js
// (pnpm skips bin links whose target doesn't exist yet, which broke `pnpm exec flowmap` on a fresh clone).
import('../dist/cli.js');
