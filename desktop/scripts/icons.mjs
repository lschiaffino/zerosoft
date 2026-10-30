// Genera los íconos de build/ desde el símbolo de app/icon.svg. Se corre a mano
// (SHARP_PATH=<ruta a sharp> node scripts/icons.mjs) y los PNG se versionan.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const sharp = require(process.env.SHARP_PATH || 'sharp');
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build');
const GLYPH = 'M10 1A8.5 11 0 1 1 10 23A8.5 11 0 1 1 10 1ZM10 4.1A5.3 7.9 0 1 0 10 19.9A5.3 7.9 0 1 0 10 4.1Z';

// Ícono de la app: cuadrado oscuro con el símbolo, con el margen de la grilla de macOS (824/1024).
const app = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect x="100" y="100" width="824" height="824" rx="104" fill="#0d0d0d"/>
  <path transform="translate(512 512) scale(24) translate(-10 -12)" d="${GLYPH}" fill="#ffffff" fill-rule="evenodd"/>
</svg>`;
// Bandeja de macOS: plantilla (negro sobre transparente; el sistema la pinta según el tema).
const tray = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 22 22">
  <path transform="translate(11 11) scale(0.78) translate(-10 -12)" d="${GLYPH}" fill="#000000" fill-rule="evenodd"/>
</svg>`;

await sharp(Buffer.from(app)).resize(1024, 1024).png().toFile(path.join(dir, 'icon.png'));
await sharp(Buffer.from(app)).resize(256, 256).png().toFile(path.join(dir, 'icon-256.png'));
await sharp(Buffer.from(tray)).resize(16, 16).png().toFile(path.join(dir, 'trayTemplate.png'));
await sharp(Buffer.from(tray)).resize(32, 32).png().toFile(path.join(dir, 'trayTemplate@2x.png'));
await sharp(Buffer.from(app)).resize(32, 32).png().toFile(path.join(dir, 'tray-win.png'));
console.log('icons ok');
