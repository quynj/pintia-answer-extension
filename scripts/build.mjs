import { build } from 'esbuild';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const sourceDirectory = join(root, 'src');
const outputDirectory = join(root, 'dist');
await rm(outputDirectory, { recursive: true, force: true });

await build({
  entryPoints: [
    'src/background/service-worker.ts',
    'src/content/content.ts',
    'src/popup/popup.ts',
    'src/settings/settings.ts'
  ],
  outbase: '.',
  outdir: outputDirectory,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  loader: { '.html': 'text' },
  sourcemap: false,
  logLevel: 'info'
});

await cp(join(root, 'manifest.json'), join(outputDirectory, 'manifest.json'));
await cp(join(root, 'LICENSE'), join(outputDirectory, 'LICENSE'));

async function copyStaticFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const sourcePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await copyStaticFiles(sourcePath);
    } else if (/\.(html|css)$/.test(entry.name) && !entry.name.endsWith('.template.html')) {
      const outputPath = join(outputDirectory, relative(root, sourcePath));
      await mkdir(dirname(outputPath), { recursive: true });
      await cp(sourcePath, outputPath);
    }
  }
}

await copyStaticFiles(sourceDirectory);
console.log(`Built extension to ${outputDirectory}`);
