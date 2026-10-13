import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { getDb, type ApiKeyRow, type UserRow } from './db';
import { clientIp, rateLimit } from './rate-limit';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

// ---------- Public v1 API auth ----------

export function extractBearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const key = header.slice(7).trim();
  return key.length > 0 ? key : null;
}

/** Looks up a raw API key; on success bumps last_used_at and returns the owner. */
export async function validateApiKey(rawKey: string): Promise<UserRow | null> {
  const db = getDb();
  const row = (await db
    .prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0')
    .get(sha256(rawKey))) as ApiKeyRow | undefined;
  if (!row) return null;
  await db.prepare(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`).run(row.id);
  return (await db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id)) as UserRow;
}

export function apiError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}

export type ApiAuth = { user: UserRow } | { res: NextResponse };

/** 429 con Retry-After (segundos hasta que se libera la ventana). */
function withRetryAfter(res: NextResponse, resetAt: number): NextResponse {
  res.headers.set('retry-after', String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
  return res;
}

/** Bearer auth + rate limit for /api/v1/* handlers. */
export async function requireApiUser(req: Request): Promise<ApiAuth> {
  const raw = extractBearer(req);
  if (!raw) return { res: apiError(401, 'invalid_key', 'Missing API key. Use Authorization: Bearer zs_…') };
  // Se limita antes de validar: así tampoco se pueden probar keys a fuerza bruta.
  const limited = await rateLimit(`api:${sha256(raw)}`, 100, 60);
  if (!limited.ok) {
    return { res: withRetryAfter(apiError(429, 'rate_limited', 'Rate limit exceeded: 100 requests per minute.'), limited.resetAt) };
  }
  const user = await validateApiKey(raw);
  if (!user) {
    // Keys inválidas: además, tope por IP para frenar enumeración.
    const byIp = await rateLimit(`api-invalid:${clientIp(req)}`, 20, 60);
    if (!byIp.ok) return { res: withRetryAfter(apiError(429, 'rate_limited', 'Too many invalid keys.'), byIp.resetAt) };
    return { res: apiError(401, 'invalid_key', 'Invalid or revoked API key.') };
  }
  return { user };
}

// ---------- Key management (session API) ----------

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  created_by?: string | null;
  created_by_email?: string | null;
}

/** Generates `zs_<nanoid(32)>`, stores only its sha256. Full key is returned once. */
export async function createApiKey(
  userId: string,
  name: string,
  createdBy: string = userId,
): Promise<{ id: string; key: string }> {
  const db = getDb();
  const key = `zs_${nanoid(32)}`;
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO api_keys (id, user_id, name, prefix, key_hash, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, name, key.slice(0, 10), sha256(key), createdBy);
  return { id, key };
}

/** Keys del workspace. Con `onlyCreatedBy`, solo las que creó esa persona. */
export async function listApiKeys(userId: string, onlyCreatedBy?: string): Promise<ApiKeyDto[]> {
  return (await getDb()
    .prepare(
      `SELECT k.id, k.name, k.prefix, k.created_at, k.last_used_at, k.created_by, u.email AS created_by_email
       FROM api_keys k LEFT JOIN users u ON u.id = k.created_by
       WHERE k.user_id = ? AND k.revoked = 0 AND (? IS NULL OR k.created_by = ?)
       ORDER BY k.created_at DESC`,
    )
    .all(userId, onlyCreatedBy ?? null, onlyCreatedBy ?? null)) as ApiKeyDto[];
}

export async function revokeApiKey(userId: string, id: string, onlyCreatedBy?: string): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ? AND (? IS NULL OR created_by = ?)')
    .run(id, userId, onlyCreatedBy ?? null, onlyCreatedBy ?? null);
  return res.changes > 0;
}
