import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * Cifrado simétrico (AES-256-GCM) para secretos en la base: tokens OAuth.
 * Clave: ENCRYPTION_KEY, o NEXTAUTH_SECRET si no está (rotarlo invalida los
 * tokens: hay que reconectar la integración). Formato: "enc:v1:<iv>.<tag>.<data>"
 * en base64url. Los valores sin prefijo son texto plano heredado y se leen tal cual.
 */

const PREFIX = 'enc:v1:';

function key(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('ENCRYPTION_KEY or NEXTAUTH_SECRET is required');
    return createHash('sha256').update('zerosoft-dev-encryption-key').digest();
  }
  return createHash('sha256').update(secret).digest();
}

export function seal(plain: string): string {
  if (!plain) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

/** Devuelve el texto plano, o '' si no se puede descifrar (clave rotada o dato corrupto). */
export function open(value: string | null | undefined): string {
  if (!value) return '';
  if (!value.startsWith(PREFIX)) return value;
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split('.');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}
