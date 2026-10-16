/**
 * Arma el kit de marca en public/brand/: SVGs (logo, símbolo, ícono y un
 * símbolo por producto), PNGs a 512 y 1024 px renderizados con Chromium
 * (playwright-core) y zerosoft-brand-kit.zip con todo más las dos fuentes
 * (OFL), bajadas de github.com/google/fonts.
 *
 *   npx tsx scripts/brand/build-kit.ts
 *
 * Todo sale de lib/brand.ts: si cambia la marca, se corre de nuevo.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { BRAND_LINES, appIconSvg, productSymbolSvg, symbolSvg, wordmarkSvg, BRAND_INK, BRAND_WHITE } from '../../lib/brand';

const OUT = join(__dirname, '..', '..', 'public', 'brand');
const SIZES = [512, 1024] as const;

const FONTS = [
  { file: 'Archivo[wdth,wght].ttf', url: 'https://github.com/google/fonts/raw/main/ofl/archivo/Archivo%5Bwdth,wght%5D.ttf' },
  { file: 'Archivo-OFL.txt', url: 'https://github.com/google/fonts/raw/main/ofl/archivo/OFL.txt' },
  { file: 'JetBrainsMono[wght].ttf', url: 'https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf' },
  { file: 'JetBrainsMono-OFL.txt', url: 'https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/OFL.txt' },
];

const svgs: Record<string, string> = {
  'logo-dark.svg': wordmarkSvg('ink'),
  'logo-light.svg': wordmarkSvg('white'),
  'symbol.svg': symbolSvg(),
  'symbol-light.svg': symbolSvg(BRAND_WHITE, BRAND_INK),
  'app-icon.svg': appIconSvg(128),
};
for (const l of BRAND_LINES) svgs[`symbol-${l.key}.svg`] = productSymbolSvg(l.key);

async function main() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'png'), { recursive: true });

  for (const [name, svg] of Object.entries(svgs)) writeFileSync(join(OUT, name), `${svg}\n`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, svg] of Object.entries(svgs)) {
    for (const size of SIZES) {
      // El ancho manda; el alto sale de la proporción del SVG.
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(
        `<html><body style="margin:0;background:transparent">${svg.replace(/ width="[^"]+" height="[^"]+"/, ` width="${size}"`)}</body></html>`,
      );
      const box = await page.locator('svg').boundingBox();
      if (!box) throw new Error(`sin caja: ${name}`);
      await page.screenshot({
        path: join(OUT, 'png', name.replace('.svg', `-${size}.png`)),
        omitBackground: true,
        clip: { x: 0, y: 0, width: size, height: Math.round(box.height) },
      });
    }
  }
  await browser.close();

  const stage = mkdtempSync(join(tmpdir(), 'zerosoft-kit-'));
  const kit = join(stage, 'zerosoft-brand-kit');
  mkdirSync(join(kit, 'svg'), { recursive: true });
  mkdirSync(join(kit, 'png'), { recursive: true });
  mkdirSync(join(kit, 'fonts'), { recursive: true });
  for (const name of Object.keys(svgs)) copyFileSync(join(OUT, name), join(kit, 'svg', name));
  for (const name of readdirSync(join(OUT, 'png'))) copyFileSync(join(OUT, 'png', name), join(kit, 'png', name));
  for (const f of FONTS) {
    const res = await fetch(f.url);
    if (!res.ok) throw new Error(`${f.url}: ${res.status}`);
    writeFileSync(join(kit, 'fonts', f.file), Buffer.from(await res.arrayBuffer()));
  }
  writeFileSync(join(kit, 'README.txt'), readme());
  execFileSync('zip', ['-rqX', join(OUT, 'zerosoft-brand-kit.zip'), 'zerosoft-brand-kit'], { cwd: stage });
  rmSync(stage, { recursive: true, force: true });
  console.log(`kit listo en ${OUT}`);
}

function readme(): string {
  const lines = BRAND_LINES.map(
    (l) => `  ${l.name.padEnd(7)} línea ${l.line}  ${l.lineOklch.padEnd(26)} texto ${l.ink}  ${l.inkOklch}`,
  ).join('\n');
  return `zerosoft · kit de marca
Guía completa: https://branding.zerosoft.ai

svg/   logo-dark (tinta, para fondos claros), logo-light (blanco, para fondos oscuros),
       symbol, symbol-light, app-icon y un symbol por producto.
png/   lo mismo a 512 y 1024 px de ancho, fondo transparente.
fonts/ Archivo y JetBrains Mono, SIL Open Font License 1.1.

El nombre se escribe zerosoft, en minúscula.
Área de resguardo: una estación (el diámetro de la o de zero) por lado.
Tamaño mínimo: estación de 15 px, wordmark de 80 px de ancho, símbolo de 16 px.

Neutros: blanco #ffffff, esmalte #f4f4f2, tinta #111111.
Líneas (color de línea para trazos y rellenos; texto: versión AA sobre blanco):
${lines}

Generado por scripts/brand/build-kit.ts desde lib/brand.ts.
Contacto de prensa: hola@zerosoft.ai
`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
