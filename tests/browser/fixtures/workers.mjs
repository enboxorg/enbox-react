import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const project = process.cwd();
const mainPath = join(project, 'src/main.tsx');
const main = readFileSync(mainPath, 'utf8');
const workerPath = join(project, 'src/ordinary-worker.ts');
const output = mkdtempSync(join(tmpdir(), 'enbox-workers-'));
const marker = 'ordinary-worker-regression';
try {
  writeFileSync(workerPath, `console.info('${marker}');\n`);
  writeFileSync(mainPath, `${main}\nimport ordinaryWorker from './ordinary-worker.ts?worker&url';\nconsole.info(ordinaryWorker);\n`);
  execFileSync(process.execPath, [join(project, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', output], {
    cwd: project, stdio: 'inherit',
  });
  const ordinary = readdirSync(join(output, 'assets')).filter((file) => /^ordinary-worker-.+\.js$/.test(file));
  assert.equal(ordinary.length, 1, 'Ordinary workers must keep their own hashed entrypoint.');
  assert.ok(readFileSync(join(output, 'assets', ordinary[0]), 'utf8').includes(marker));
  assert.ok(!readFileSync(join(output, 'sw.js'), 'utf8').includes(marker),
    'An ordinary worker must never overwrite the app service worker.');
  console.log('Starter workers passed: ordinary workers and the app service worker have separate entrypoints.');
} finally {
  writeFileSync(mainPath, main);
  rmSync(workerPath, { force: true });
  rmSync(output, { recursive: true, force: true });
}
