// Compila las páginas locales (Ajustes, HUD, indicador de grabación y tira de pestañas) con esbuild a dist-ui/, que Tauri embebe en el binario.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-ui');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await Promise.all(
  ['settings', 'hud', 'indicator', 'tabs'].map((name) =>
    build({
      entryPoints: [path.join(root, `ui/${name}.ts`)],
      outfile: path.join(out, `${name}.js`),
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      minify: true,
      legalComments: 'none',
      logLevel: 'warning',
    }),
  ),
);
for (const name of ['settings.html', 'hud.html', 'indicator.html', 'tabs.html']) fs.copyFileSync(path.join(root, 'ui', name), path.join(out, name));
console.log('ui build ok');
