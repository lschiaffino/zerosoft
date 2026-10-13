import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'crypto';
import { parseLicense } from '@/ee/lib/license';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function issue(payload: object, key = privateKey) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(null, Buffer.from(body), key).toString('base64url')}`;
}

describe('licencia Enterprise (offline)', () => {
  it('acepta una key firmada y vigente', () => {
    const key = issue({ customer: 'Acme', expiresAt: '2099-01-01', features: ['sso'] });
    expect(parseLicense(key, pem)?.features).toEqual(['sso']);
  });

  it('rechaza vencida, adulterada, de otra clave o sin clave pública', () => {
    expect(parseLicense(issue({ customer: 'A', expiresAt: '2000-01-01', features: [] }), pem)).toBeNull();
    const good = issue({ customer: 'A', expiresAt: '2099-01-01', features: ['sso'] });
    const tampered = Buffer.from(JSON.stringify({ customer: 'A', expiresAt: '2099-01-01', features: ['sso', 'audit'] })).toString('base64url') + '.' + good.split('.')[1];
    expect(parseLicense(tampered, pem)).toBeNull();
    const other = generateKeyPairSync('ed25519').privateKey;
    expect(parseLicense(issue({ customer: 'A', expiresAt: '2099-01-01', features: [] }, other), pem)).toBeNull();
    expect(parseLicense(good, '')).toBeNull();
    expect(parseLicense(undefined, pem)).toBeNull();
  });
});
