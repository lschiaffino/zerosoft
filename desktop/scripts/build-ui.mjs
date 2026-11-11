// Compila las páginas locales (Ajustes, HUD, indicador de grabación, tira de pestañas y barra y burbuja de Rec) con esbuild a dist-ui/, que Tauri embebe en el binario.
import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist-ui');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await Promise.all(
  ['settings', 'hud', 'indicator', 'tabs', 'recbar', 'recbubble'].map((name) =>
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
for (const name of ['settings.html', 'hud.html', 'indicator.html', 'tabs.html', 'recbar.html', 'recbubble.html']) fs.copyFileSync(path.join(root, 'ui', name), path.join(out, name));
console.log('ui build ok');
