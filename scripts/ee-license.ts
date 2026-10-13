/**
 * Emisión de licencias Enterprise.
 *   npx tsx scripts/ee-license.ts keygen
 *   ZEROSOFT_LICENSE_PRIVATE_KEY="$(cat private.pem)" npx tsx scripts/ee-license.ts issue "Acme" 2027-12-31 sso,audit
 * La clave privada nunca va al repo.
 */
import { createPrivateKey, generateKeyPairSync, sign } from 'crypto';

const [cmd, customer, expiresAt, features = ''] = process.argv.slice(2);

if (cmd === 'keygen') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  console.log(publicKey.export({ type: 'spki', format: 'pem' }));
  console.log(privateKey.export({ type: 'pkcs8', format: 'pem' }));
} else if (cmd === 'issue' && customer && /^\d{4}-\d{2}-\d{2}$/.test(expiresAt ?? '')) {
  const pem = process.env.ZEROSOFT_LICENSE_PRIVATE_KEY;
  if (!pem) throw new Error('ZEROSOFT_LICENSE_PRIVATE_KEY is required');
  const body = Buffer.from(
    JSON.stringify({ customer, expiresAt, features: features.split(',').filter(Boolean) }),
  ).toString('base64url');
  const sig = sign(null, Buffer.from(body), createPrivateKey(pem)).toString('base64url');
  console.log(`${body}.${sig}`);
} else {
  console.error('usage: keygen | issue <customer> <YYYY-MM-DD> <features,comma,separated>');
  process.exit(1);
}
