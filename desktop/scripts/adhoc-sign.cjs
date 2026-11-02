// Sin certificado de Apple, el paquete queda solo con la firma del linker de Electron: en
// Apple Silicon, macOS lo trata como dañado y no ofrece abrirlo. Una firma ad hoc del paquete
// entero lo deja como "desarrollador no verificado", que se abre desde Privacidad y seguridad.
// Va en afterSign porque los fuses de Electron se escriben justo antes de firmar.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
};
