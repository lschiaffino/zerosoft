import { createPublicKey, verify } from 'crypto';

/**
 * Verificación offline de la licencia Enterprise (/ee). Formato de la key:
 * base64url(payload JSON) + "." + base64url(firma Ed25519 del payload).
 * Sin key válida, todo lo de /ee queda apagado y el core funciona igual.
 */

export type EnterpriseFeature = 'sso' | 'audit' | 'roles' | 'whitelabel';

export interface LicensePayload {
  customer: string;
  expiresAt: string; // YYYY-MM-DD
  features: EnterpriseFeature[];
}

/** Clave pública oficial (PEM). Hasta publicarla en código se lee de la env. */
const OFFICIAL_PUBLIC_KEY = '';

function publicKeyPem(): string {
  return process.env.ZEROSOFT_LICENSE_PUBLIC_KEY || OFFICIAL_PUBLIC_KEY;
}

export function parseLicense(key: string | undefined, pem = publicKeyPem()): LicensePayload | null {
  if (!key || !pem) return null;
  const [body, sig] = key.trim().split('.');
  if (!body || !sig) return null;
  try {
    const ok = verify(null, Buffer.from(body), createPublicKey(pem), Buffer.from(sig, 'base64url'));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicensePayload;
    if (!payload.expiresAt || new Date(`${payload.expiresAt}T23:59:59Z`).getTime() < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

let cached: { key: string | undefined; payload: LicensePayload | null } | null = null;

export function currentLicense(): LicensePayload | null {
  const key = process.env.ZEROSOFT_LICENSE_KEY;
  if (!cached || cached.key !== key) cached = { key, payload: parseLicense(key) };
  return cached.payload;
}

export function isEnterprise(): boolean {
  return currentLicense() !== null;
}

export function hasFeature(feature: EnterpriseFeature): boolean {
  return currentLicense()?.features.includes(feature) ?? false;
}
