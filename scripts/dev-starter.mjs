import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { packSdk } from './pack-sdk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const starter = fileURLToPath(new URL('../packages/create-dapp/template/', import.meta.url));
const sdk = packSdk(root);
// Override only the installed SDK. Keep the publishable template metadata intact.
execFileSync('npm', ['install', '--no-save', '--package-lock=false', 'file:' + sdk.immutableArchivePath], {
  cwd: starter, stdio: 'inherit',
});
const server = spawn('npm', ['run', 'dev', '--', ...process.argv.slice(2)], { cwd: starter, stdio: 'inherit' });
server.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
