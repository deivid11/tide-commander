#!/usr/bin/env node
// Dev server launcher for `npm run dev:server`.
//
// `tsx watch` restarts the API on a change to ANY module the process has
// imported. External plugins (plugins/state.json `sourcePath`, loaded by the
// plugin manager through a dynamic import()) count, so editing a plugin's
// server.mjs in a sibling checkout restarted the whole commander: live exec
// registries, agent streams and WebSocket clients all dropped. This wrapper
// excludes every installed plugin root from the watcher. Plugins re-import
// with an mtime cache-bust on POST /api/plugins/:id/disable + /enable.
//
// Only relative --exclude patterns work: tsx hands them to chokidar, which
// matches against absolute paths, so `**/*.mjs` silently matches nothing.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'),
  'tide-commander',
);

function installedPluginRoots() {
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'plugins', 'state.json'), 'utf8');
    const state = JSON.parse(raw);
    const roots = [];
    for (const entry of state.installed ?? []) {
      if (typeof entry?.sourcePath !== 'string') continue;
      let root = entry.sourcePath;
      try { root = fs.realpathSync(root); } catch { /* keep as configured */ }
      // A plugin living inside the repo is normal source; leave it watched.
      const rel = path.relative(repoRoot, root);
      if (!rel || (!rel.startsWith('..') && !path.isAbsolute(rel))) continue;
      roots.push(rel);
    }
    return roots;
  } catch {
    return [];
  }
}

const excludes = installedPluginRoots();
const args = ['watch', '--clear-screen=false'];
for (const rel of excludes) args.push('--exclude', path.join(rel, '**'));
args.push('src/packages/server/index.ts');

if (excludes.length > 0) {
  console.log(`[dev-server] excluding ${excludes.length} external plugin root(s) from tsx watch: ${excludes.join(', ')}`);
}

if (process.env.DEV_SERVER_PRINT_ARGS) {
  console.log(JSON.stringify(args));
  process.exit(0);
}

const tsxBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
const child = spawn(tsxBin, args, { cwd: repoRoot, stdio: 'inherit', shell: process.platform === 'win32' });

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => { child.kill(signal); });
}
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
