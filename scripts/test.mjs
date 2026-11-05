import { build } from 'esbuild';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const testDirectory = join(root, 'tests');
const entries = (await readdir(testDirectory))
  .filter((name) => name.endsWith('.test.js'))
  .map((name) => join(testDirectory, name));
if (!entries.length) throw new Error('No test files found.');

const outputDirectory = await mkdtemp(join(tmpdir(), 'pintia-answer-extension-tests-'));
try {
  await build({
    entryPoints: entries,
    outbase: testDirectory,
    outdir: outputDirectory,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    outExtension: { '.js': '.mjs' },
    logLevel: 'info'
  });
  const outputFiles = entries.map((entry) =>
    join(outputDirectory, entry.slice(testDirectory.length + 1).replace(/\.js$/, '.mjs'))
  );
  const result = spawnSync(process.execPath, ['--test', ...outputFiles], {
    cwd: root,
    stdio: 'inherit'
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  await rm(outputDirectory, { recursive: true, force: true });
}
