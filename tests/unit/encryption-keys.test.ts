import { afterEach, describe, expect, it } from 'vitest';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { getClient, getDb } from '@/lib/db';
import { activeKey, keyRing } from '@/lib/key-ring';
import { isSealed, needsRotation, open, seal, sealedKeyId } from '@/lib/secret-box';
import { decryptCredential, encryptCredential } from '@/lib/flow-credentials';
import { rotateEncryptedValues } from '@/lib/key-rotation';

const K1 = randomBytes(32).toString('base64');
const K2 = randomBytes(32).toString('hex');

/** Un valor como los que escribía secret-box v1 (AES-GCM directo con SHA-256 de NEXTAUTH_SECRET). */
function legacyV1(plain: string): string {
  const key = createHash('sha256').update(process.env.NEXTAUTH_SECRET!).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `enc:v1:${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${data.toString('base64url')}`;
}

function legacyCredential(ws: string, id: string, data: Record<string, string>): string {
  const key = createHash('sha256').update(`zerosoft:flow-credentials:${process.env.NEXTAUTH_SECRET}`).digest();
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(Buffer.from(`${ws}:${id}`));
  const enc = Buffer.concat([c.update(JSON.stringify(data), 'utf8'), c.final()]);
  return `cred:v1:${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

afterEach(() => {
  delete process.env.ENCRYPTION_KEYS;
  delete process.env.ENCRYPTION_LEGACY_KEY;
});

describe('cifrado en sobre con anillo de claves', () => {
  it('sin ENCRYPTION_KEYS usa la clave heredada "0" y escribe v2', () => {
    expect(activeKey().id).toBe('0');
    const s = seal('token-secreto');
    expect(s.startsWith('enc:v2:0:')).toBe(true);
    expect(s).not.toContain('token-secreto');
    expect(open(s)).toBe('token-secreto');
    // Cada valor tiene su propia DEK e IV: dos sellos del mismo texto no se parecen.
    expect(seal('token-secreto')).not.toBe(s);
  });

  it('sigue leyendo v1 y texto plano heredado', () => {
    expect(open(legacyV1('viejo'))).toBe('viejo');
    expect(open('plano')).toBe('plano');
    expect(isSealed(legacyV1('x'))).toBe(true);
    expect(sealedKeyId(legacyV1('x'))).toBe('0');
  });

  it('una clave nueva cifra lo nuevo y la vieja sigue abriendo lo anterior', () => {
    const before = seal('a');
    process.env.ENCRYPTION_KEYS = `k2:${K2},k1:${K1}`;
    expect(keyRing().map((k) => k.id)).toEqual(['k2', 'k1', '0']);
    const after = seal('b');
    expect(sealedKeyId(after)).toBe('k2');
    expect(open(before)).toBe('a');
    expect(open(after)).toBe('b');
    expect(needsRotation(before)).toBe(true);
    expect(needsRotation(after)).toBe(false);
    // Sin la clave del valor, no se abre.
    process.env.ENCRYPTION_KEYS = `k1:${K1}`;
    expect(open(after)).toBe('');
  });

  it('un dato manipulado no se abre', () => {
    const s = seal('integridad');
    const parts = s.split('.');
    parts[3] = Buffer.from('otra-cosa').toString('base64url');
    expect(open(parts.join('.'))).toBe('');
  });

  it('rechaza ids mal formados o repetidos', () => {
    process.env.ENCRYPTION_KEYS = `0:${K1}`;
    expect(() => keyRing()).toThrow();
    process.env.ENCRYPTION_KEYS = `a:${K1},a:${K2}`;
    expect(() => keyRing()).toThrow();
  });

  it('ENCRYPTION_LEGACY_KEY=disabled saca la clave heredada después de rotar', () => {
    const old = seal('x');
    process.env.ENCRYPTION_KEYS = `k1:${K1}`;
    process.env.ENCRYPTION_LEGACY_KEY = 'disabled';
    expect(keyRing().map((k) => k.id)).toEqual(['k1']);
    expect(open(old)).toBe('');
  });
});

describe('rotación de claves', () => {
  it('vuelve a cifrar valores sueltos, dentro de JSON y credenciales de Flow', async () => {
    const db = getDb();
    await db.prepare('CREATE TABLE IF NOT EXISTS rot_test (id TEXT PRIMARY KEY, token TEXT, config TEXT)').run();
    const v1 = legacyV1('ya29.uno');
    const v2old = seal('ya29.dos');
    await db.prepare('INSERT INTO rot_test (id, token, config) VALUES (?, ?, ?)').run('r1', v1, JSON.stringify({ apiKey: v2old, name: 'x' }));
    const ws = 'u-rot';
    await db.prepare("INSERT OR IGNORE INTO users (id, email) VALUES (?, 'rot@example.com')").run(ws);
    const credId = 'cred-rot';
    await db
      .prepare("INSERT INTO flow_credentials (id, user_id, name, type, data, created_at, updated_at) VALUES (?, ?, 'rot', 'basic', ?, datetime('now'), datetime('now'))")
      .run(credId, ws, legacyCredential(ws, credId, { username: 'a', password: 'b' }));

    process.env.ENCRYPTION_KEYS = `k1:${K1}`;
    const dry = await rotateEncryptedValues(getClient(), { apply: false });
    expect(dry.pending).toBeGreaterThanOrEqual(3);
    expect(dry.byColumn['rot_test.token']).toBe(1);
    expect(dry.byColumn['rot_test.config']).toBe(1);
    expect(dry.byColumn['flow_credentials.data']).toBeGreaterThanOrEqual(1);
    expect(dry.rotated).toBe(0);

    const run = await rotateEncryptedValues(getClient(), { apply: true });
    expect(run.unreadable).toBe(0);
    expect(run.rotated).toBeGreaterThanOrEqual(3);
    const row = (await db.prepare('SELECT token, config FROM rot_test WHERE id = ?').get('r1')) as { token: string; config: string };
    expect(sealedKeyId(row.token)).toBe('k1');
    expect(open(row.token)).toBe('ya29.uno');
    const cfg = JSON.parse(row.config) as { apiKey: string; name: string };
    expect(sealedKeyId(cfg.apiKey)).toBe('k1');
    expect(open(cfg.apiKey)).toBe('ya29.dos');
    const cred = (await db.prepare('SELECT data FROM flow_credentials WHERE id = ?').get(credId)) as { data: string };
    expect(cred.data.startsWith('cred:v2:k1:')).toBe(true);
    expect(decryptCredential(ws, credId, cred.data)).toEqual({ username: 'a', password: 'b' });
    // La credencial sigue atada a su workspace.
    expect(decryptCredential('otro', credId, cred.data)).toBeNull();

    const again = await rotateEncryptedValues(getClient(), { apply: false });
    expect(again.pending).toBe(0);
  });

  it('las credenciales nuevas usan la clave activa', () => {
    process.env.ENCRYPTION_KEYS = `k1:${K1}`;
    const v = encryptCredential('w', 'c', { token: 't' });
    expect(v.startsWith('cred:v2:k1:')).toBe(true);
    expect(decryptCredential('w', 'c', v)).toEqual({ token: 't' });
  });
});
