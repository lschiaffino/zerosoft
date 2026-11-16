// Arma latest.json (formato del updater de Tauri 2) con los paquetes firmados del release.
// Uso: node latest-json.mjs <carpeta> <versión> <url base de descarga>. Sin firmas no escribe nada.
import fs from 'fs';
import path from 'path';

const [dir, version, base] = process.argv.slice(2);
const PLATFORMS = {
  'darwin-aarch64': `zerosoft-${version}-mac-arm64.app.tar.gz`,
  'darwin-x86_64': `zerosoft-${version}-mac-x64.app.tar.gz`,
  'windows-x86_64': `zerosoft-${version}-win-x64.exe`,
};

const platforms = {};
for (const [key, file] of Object.entries(PLATFORMS)) {
  const sig = path.join(dir, `${file}.sig`);
  if (!fs.existsSync(path.join(dir, file)) || !fs.existsSync(sig)) continue;
  platforms[key] = { signature: fs.readFileSync(sig, 'utf8').trim(), url: `${base}/${file}` };
}

if (!Object.keys(platforms).length) {
  console.log('Sin paquetes firmados: no hay latest.json (falta TAURI_SIGNING_PRIVATE_KEY).');
  process.exit(0);
}
// Con una plataforma de menos, las apps de esa plataforma fallarían al buscar (el updater no
// encuentra su paquete en la versión nueva). Sin latest.json el feed sigue con el release anterior
// (lib/desktop-release.ts, pickReleaseWithAsset); re-correr el job que falló lo completa.
const missing = Object.keys(PLATFORMS).filter((k) => !platforms[k]);
if (missing.length) {
  console.log(`::warning::Sin latest.json: faltan paquetes firmados de ${missing.join(', ')}. Re-correr el build que falló lo completa.`);
  process.exit(0);
}
const latest = { version, notes: 'https://zerosoft.ai/changelog', pub_date: new Date().toISOString(), platforms };
fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(latest, null, 2));
console.log(`latest.json: ${Object.keys(platforms).join(', ')}`);
