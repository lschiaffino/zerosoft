// Compila main, preloads y renderers con esbuild a dist/. Los preloads con
// sandbox no pueden hacer require de archivos propios: van en un solo bundle.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const common = { bundle: true, sourcemap: 'linked', logLevel: 'warning', target: 'es2022', legalComments: 'none' };

await Promise.all([
  build({
    ...common,
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(out, 'main.js'),
    platform: 'node',
    format: 'cjs',
    external: ['electron', 'uiohook-napi', 'electron-updater'],
  }),
  ...['app', 'overlay', 'settings'].map((name) =>
    build({
      ...common,
      entryPoints: [path.join(root, `src/preload/${name}.ts`)],
      outfile: path.join(out, `preload-${name}.js`),
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    }),
  ),
  ...['overlay', 'settings'].map((name) =>
    build({
      ...common,
      entryPoints: [path.join(root, `src/renderer/${name}.ts`)],
      outfile: path.join(out, `${name}.js`),
      platform: 'browser',
      format: 'iife',
    }),
  ),
]);

for (const name of ['overlay.html', 'settings.html']) fs.copyFileSync(path.join(root, 'src/renderer', name), path.join(out, name));
console.log('desktop build ok');
