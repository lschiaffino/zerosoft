// Después de `cap add ios|android`: registra el esquema zerosoft:// (vuelta del
// login con Google en el navegador) y los permisos de micrófono (Voice y Talk).
// Idempotente: se puede correr de nuevo después de cada `cap add`.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function patchIos() {
  const plist = path.join(root, 'ios/App/App/Info.plist');
  if (!fs.existsSync(plist)) return console.log('ios: sin proyecto (corré npm run add:ios)');
  let xml = fs.readFileSync(plist, 'utf8');
  const add = [];
  if (!xml.includes('<string>zerosoft</string>')) {
    add.push(`\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>ai.zerosoft.app</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>zerosoft</string>
\t\t\t</array>
\t\t</dict>
\t</array>`);
  }
  if (!xml.includes('NSMicrophoneUsageDescription')) {
    add.push(`\t<key>NSMicrophoneUsageDescription</key>
\t<string>zerosoft records your microphone for dictation, meeting notes and Talk huddles.</string>`);
  }
  if (!add.length) return console.log('ios: ya configurado');
  const i = xml.lastIndexOf('</dict>');
  xml = `${xml.slice(0, i)}${add.join('\n')}\n${xml.slice(i)}`;
  fs.writeFileSync(plist, xml);
  console.log('ios: esquema zerosoft:// y micrófono');
}

function patchAndroid() {
  const manifest = path.join(root, 'android/app/src/main/AndroidManifest.xml');
  if (!fs.existsSync(manifest)) return console.log('android: sin proyecto (corré npm run add:android)');
  let xml = fs.readFileSync(manifest, 'utf8');
  let changed = false;
  if (!xml.includes('android:scheme="zerosoft"')) {
    const filter = `
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="zerosoft" />
            </intent-filter>`;
    const i = xml.indexOf('</activity>');
    if (i < 0) throw new Error('AndroidManifest.xml sin <activity>');
    xml = `${xml.slice(0, i)}${filter}\n        ${xml.slice(i)}`;
    changed = true;
  }
  for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
    if (!xml.includes(perm)) {
      xml = xml.replace('</manifest>', `    <uses-permission android:name="${perm}" />\n</manifest>`);
      changed = true;
    }
  }
  if (!changed) return console.log('android: ya configurado');
  fs.writeFileSync(manifest, xml);
  console.log('android: esquema zerosoft:// y micrófono');
}

patchIos();
patchAndroid();
