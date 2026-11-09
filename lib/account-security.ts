/**
 * Seguridad de la cuenta. Server-only.
 *
 * - Sesiones del lado del servidor: cada login (Google, código por email, app de escritorio)
 *   crea una fila en user_sessions y su id viaja en el JWT de NextAuth (`sid`). Cada request
 *   la mira (lib/session.ts): cerrada, vencida o de otra persona = sin sesión. Así se puede
 *   listar dispositivos y cerrar uno o todos al instante, aunque el JWT siga firmado.
 * - Verificación en dos pasos (TOTP, RFC 6238: SHA-1, 6 dígitos, 30 s, ±1 paso) con el
 *   secreto cifrado (lib/secret-box.ts), protección contra reuso del mismo código y 10
 *   códigos de recuperación de un solo uso guardados como SHA-256.
 * - Registro de eventos de seguridad (security_events): logins, dos pasos, sesiones, claves,
 *   exportaciones y borrados. Lo ven y exportan owner y admins del workspace; cada persona ve
 *   lo suyo.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { getClient, getDb, type UserRow } from './db';
import { open, seal } from './secret-box';

// ---------- Utilidades ----------

const nowIso = () => new Date().toISOString();
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

/** IP y user agent de la request en curso (route handler o server action); vacío fuera de una. */
export async function requestContext(): Promise<{ ip: string | null; userAgent: string | null }> {
  try {
    const { headers } = await import('next/headers');
    const h = await headers();
    const { clientIp } = await import('./rate-limit');
    const ip = clientIp(new Request('http://localhost/', { headers: h }));
    return { ip: ip === 'unknown' ? null : ip.slice(0, 64), userAgent: (h.get('user-agent') ?? '').slice(0, 300) || null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

// ---------- Sesiones ----------

export const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type LoginMethod = 'google' | 'email' | 'desktop' | '';

export interface SessionRow {
  id: string;
  user_id: string;
  method: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  mfa_at: string | null;
  revoked_at: string | null;
}

export async function createSession(
  userId: string,
  opts: { method: LoginMethod; mfaVerified?: boolean; ip?: string | null; userAgent?: string | null; maxAgeSec?: number },
): Promise<string> {
  const ctx = opts.ip === undefined && opts.userAgent === undefined ? await requestContext() : { ip: opts.ip ?? null, userAgent: opts.userAgent ?? null };
  const id = randomBytes(24).toString('base64url');
  const now = new Date();
  await getDb()
    .prepare(
      `INSERT INTO user_sessions (id, user_id, method, ip, user_agent, created_at, last_seen_at, expires_at, mfa_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      userId,
      opts.method,
      ctx.ip,
      ctx.userAgent,
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + (opts.maxAgeSec ?? SESSION_MAX_AGE_SEC) * 1000).toISOString(),
      opts.mfaVerified ? now.toISOString() : null,
    );
  return id;
}

export async function getSessionRow(id: string): Promise<SessionRow | null> {
  if (!id || id.length > 64) return null;
  return ((await getDb().prepare('SELECT * FROM user_sessions WHERE id = ?').get(id)) as SessionRow | undefined) ?? null;
}

export type SessionState = 'ok' | 'mfa_pending' | 'invalid';

export function mfaEnabled(user: Pick<UserRow, 'mfa_enabled_at'>): boolean {
  return Boolean(user.mfa_enabled_at);
}

/**
 * ¿Vale la sesión de este JWT para esta persona? `row` es la de su `sid` (null si el JWT no
 * trae uno: sesiones de antes de este cambio, que valen salvo que la persona haya cerrado
 * todas o tenga dos pasos).
 */
export function sessionState(user: UserRow, sid: string | null, row: SessionRow | null, now = Date.now()): SessionState {
  if (!sid) {
    if (user.sessions_revoked_at || mfaEnabled(user)) return 'invalid';
    return 'ok';
  }
  if (!row || row.user_id !== user.id || row.revoked_at || Date.parse(row.expires_at) <= now) return 'invalid';
  if (mfaEnabled(user) && !row.mfa_at) return 'mfa_pending';
  return 'ok';
}

const touched = new Map<string, number>();

/**
 * "Última actividad" del dispositivo, y el vencimiento corre con el uso (como el JWT de
 * NextAuth, 30 días desde la última visita): a lo sumo una escritura cada 5 minutos.
 */
export function touchSession(row: SessionRow): void {
  const now = Date.now();
  if (now - Date.parse(row.last_seen_at) < TOUCH_EVERY_MS) return;
  if (now - (touched.get(row.id) ?? 0) < TOUCH_EVERY_MS) return;
  touched.set(row.id, now);
  if (touched.size > 5000) touched.clear();
  void getDb()
    .prepare('UPDATE user_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ? AND revoked_at IS NULL AND expires_at > ?')
    .run(new Date(now).toISOString(), new Date(now + SESSION_MAX_AGE_SEC * 1000).toISOString(), row.id, new Date(now).toISOString())
    .catch(() => undefined);
}

export interface SessionDto {
  id: string;
  method: string;
  ip: string | null;
  device: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

/** "Chrome en macOS" a partir del user agent (lo justo para reconocer un dispositivo). */
export function describeDevice(ua: string | null | undefined, method?: string): string {
  if (method === 'desktop') return 'zerosoft desktop';
  const s = ua ?? '';
  const browser = /Edg\//.test(s)
    ? 'Edge'
    : /OPR\/|Opera/.test(s)
      ? 'Opera'
      : /Firefox\//.test(s)
        ? 'Firefox'
        : /Chrome\//.test(s)
          ? 'Chrome'
          : /Safari\//.test(s)
            ? 'Safari'
            : '';
  const os = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Mac OS X|Macintosh/.test(s) ? 'macOS' : /Windows/.test(s) ? 'Windows' : /Linux/.test(s) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' · ') || '';
}

export async function listSessions(userId: string, currentSid: string | null): Promise<SessionDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC LIMIT 50')
    .all(userId, nowIso())) as SessionRow[];
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    ip: r.ip,
    device: describeDevice(r.user_agent, r.method),
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    current: r.id === currentSid,
  }));
}

export async function revokeSession(userId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL').run(nowIso(), id, userId);
  return res.changes > 0;
}

/** Cierra todas las sesiones salvo `exceptSid` (también las de antes de las sesiones del servidor). */
export async function revokeOtherSessions(userId: string, exceptSid: string | null): Promise<number> {
  const db = getDb();
  const now = nowIso();
  const res = await db
    .prepare('UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND (? IS NULL OR id != ?)')
    .run(now, userId, exceptSid, exceptSid);
  await db.prepare('UPDATE users SET sessions_revoked_at = ? WHERE id = ?').run(now, userId);
  return res.changes;
}

async function markSessionMfa(sid: string | null): Promise<void> {
  if (!sid) return;
  await getDb().prepare('UPDATE user_sessions SET mfa_at = ? WHERE id = ? AND mfa_at IS NULL').run(nowIso(), sid);
}

// ---------- TOTP ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const TOTP_PERIOD = 30;

export function totpCode(secretB32: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const off = mac[mac.length - 1] & 15;
  const bin = ((mac[off] & 0x7f) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3];
  return String(bin % 1_000_000).padStart(6, '0');
}

/** El paso que coincide con el código (±1 paso de tolerancia de reloj), o null. */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = Math.floor(now / 1000 / TOTP_PERIOD);
  for (const s of [step, step - 1, step + 1]) {
    const expected = Buffer.from(totpCode(secretB32, s));
    if (timingSafeEqual(expected, Buffer.from(clean))) return s;
  }
  return null;
}

export function otpauthUri(secretB32: string, email: string): string {
  const label = encodeURIComponent(`zerosoft:${email}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=zerosoft&algorithm=SHA1&digits=6&period=${TOTP_PERIOD}`;
}

// ---------- Dos pasos: alta, verificación y baja ----------

export const RECOVERY_CODE_COUNT = 10;

/** Formato xxxx-xxxx-xxxx (base32 sin ambigüedades), ~60 bits. */
function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(8)).slice(0, 12).toLowerCase();
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function normalizeRecovery(code: string): string {
  return code.toLowerCase().replace(/[^a-z2-7]/g, '');
}

/** Empieza (o reinicia) el alta: secreto nuevo pendiente hasta que se confirme con un código. */
export async function startMfaSetup(user: UserRow): Promise<{ secret: string; uri: string }> {
  const secret = base32Encode(randomBytes(20));
  await getDb().prepare('UPDATE users SET mfa_pending_secret = ? WHERE id = ?').run(seal(secret), user.id);
  return { secret, uri: otpauthUri(secret, user.email) };
}

async function claimStep(userId: string, step: number): Promise<boolean> {
  const res = await getDb()
    .prepare('UPDATE users SET mfa_last_step = ? WHERE id = ? AND (mfa_last_step IS NULL OR mfa_last_step < ?)')
    .run(step, userId, step);
  return res.changes > 0;
}

/** Reemplaza los códigos en una sola transacción: dos regeneraciones a la vez no dejan 20. */
async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  const now = nowIso();
  await getClient().batch(
    [
      { sql: 'DELETE FROM user_mfa_recovery WHERE user_id = ?', args: [userId] },
      ...codes.map((c) => ({
        sql: 'INSERT INTO user_mfa_recovery (user_id, code_hash, created_at) VALUES (?, ?, ?)',
        args: [userId, sha256(`${userId}|${normalizeRecovery(c)}`), now],
      })),
    ],
    'write',
  );
  return codes;
}

export type MfaResult<T = object> = ({ ok: true } & T) | { ok: false; error: 'invalid_code' | 'not_started' | 'not_enabled' | 'already_enabled' };

/** Confirma el alta con un código del autenticador. Devuelve los códigos de recuperación (se muestran una vez). */
export async function confirmMfaSetup(userId: string, code: string, sid: string | null): Promise<MfaResult<{ recoveryCodes: string[] }>> {
  const db = getDb();
  const row = (await db.prepare('SELECT mfa_pending_secret, mfa_enabled_at FROM users WHERE id = ?').get(userId)) as
    | { mfa_pending_secret: string | null; mfa_enabled_at: string | null }
    | undefined;
  if (!row) return { ok: false, error: 'not_started' };
  if (row.mfa_enabled_at) return { ok: false, error: 'already_enabled' };
  const secret = open(row.mfa_pending_secret);
  if (!secret) return { ok: false, error: 'not_started' };
  const step = matchTotp(secret, code);
  if (step === null) return { ok: false, error: 'invalid_code' };
  const res = await db
    .prepare('UPDATE users SET mfa_secret = mfa_pending_secret, mfa_pending_secret = NULL, mfa_enabled_at = ?, mfa_last_step = ? WHERE id = ? AND mfa_enabled_at IS NULL AND mfa_pending_secret = ?')
    .run(nowIso(), step, userId, row.mfa_pending_secret);
  if (!res.changes) return { ok: false, error: 'not_started' };
  // La sesión desde la que se activó ya pasó el segundo paso.
  await markSessionMfa(sid);
  return { ok: true, recoveryCodes: await replaceRecoveryCodes(userId) };
}

/**
 * Verifica un código del autenticador o uno de recuperación (que se gasta). Con `sid`, marca
 * esa sesión como verificada.
 */
export async function verifyMfa(userId: string, code: string, sid: string | null): Promise<MfaResult<{ usedRecovery: boolean; recoveryLeft?: number }>> {
  const db = getDb();
  const row = (await db.prepare('SELECT mfa_secret, mfa_enabled_at FROM users WHERE id = ?').get(userId)) as
    | { mfa_secret: string | null; mfa_enabled_at: string | null }
    | undefined;
  if (!row?.mfa_enabled_at) return { ok: false, error: 'not_enabled' };
  const clean = code.trim();
  if (/^\d{3}\s?\d{3}$/.test(clean)) {
    const secret = open(row.mfa_secret);
    const step = secret ? matchTotp(secret, clean) : null;
    // Un código ya usado (o uno anterior) no vale dos veces: alguien que lo vio no entra con él.
    if (step === null || !(await claimStep(userId, step))) return { ok: false, error: 'invalid_code' };
    await markSessionMfa(sid);
    return { ok: true, usedRecovery: false };
  }
  const norm = normalizeRecovery(clean);
  if (norm.length !== 12) return { ok: false, error: 'invalid_code' };
  const used = await db
    .prepare('UPDATE user_mfa_recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL')
    .run(nowIso(), userId, sha256(`${userId}|${norm}`));
  if (!used.changes) return { ok: false, error: 'invalid_code' };
  await markSessionMfa(sid);
  return { ok: true, usedRecovery: true, recoveryLeft: await recoveryCodesLeft(userId) };
}

export async function recoveryCodesLeft(userId: string): Promise<number> {
  const r = (await getDb().prepare('SELECT COUNT(*) AS n FROM user_mfa_recovery WHERE user_id = ? AND used_at IS NULL').get(userId)) as { n: number };
  return Number(r.n);
}

/** Códigos de recuperación nuevos (los anteriores dejan de valer). Pide un código válido. */
export async function regenerateRecoveryCodes(userId: string, code: string): Promise<MfaResult<{ recoveryCodes: string[] }>> {
  const v = await verifyMfa(userId, code, null);
  if (!v.ok) return v;
  return { ok: true, recoveryCodes: await replaceRecoveryCodes(userId) };
}

/** Apaga los dos pasos. Pide un código válido (del autenticador o de recuperación). */
export async function disableMfa(userId: string, code: string): Promise<MfaResult> {
  const v = await verifyMfa(userId, code, null);
  if (!v.ok) return v;
  const db = getDb();
  await db.prepare('UPDATE users SET mfa_secret = NULL, mfa_pending_secret = NULL, mfa_enabled_at = NULL, mfa_last_step = NULL WHERE id = ?').run(userId);
  await db.prepare('DELETE FROM user_mfa_recovery WHERE user_id = ?').run(userId);
  return { ok: true };
}

// ---------- Exigir dos pasos en el workspace ----------

/** Miembros (no guests) del workspace sin dos pasos activados. */
export async function membersWithoutMfa(teamId: string): Promise<Array<{ id: string; email: string; name: string | null }>> {
  return (await getDb()
    .prepare(
      `SELECT u.id, u.email, u.name FROM team_members m JOIN users u ON u.id = m.user_id
       WHERE m.team_id = ? AND m.role != 'guest' AND u.mfa_enabled_at IS NULL ORDER BY u.email LIMIT 500`,
    )
    .all(teamId)) as Array<{ id: string; email: string; name: string | null }>;
}

/** En todas las fichas del dueño (equipos de antes de 128 incluidos): las keys miran todas. */
export async function setWorkspaceRequireMfa(teamId: string, on: boolean): Promise<void> {
  await getDb()
    .prepare('UPDATE teams SET require_mfa = ? WHERE owner_id = (SELECT owner_id FROM teams WHERE id = ?)')
    .run(on ? 1 : 0, teamId);
}

// ---------- Registro de eventos ----------

export const SECURITY_ACTIONS = [
  'login',
  'login.mfa',
  'login.failed_mfa',
  'logout',
  'mfa.enable',
  'mfa.disable',
  'mfa.recovery_used',
  'mfa.recovery_regenerated',
  'session.revoke',
  'session.revoke_others',
  'workspace.require_mfa',
  'api_key.create',
  'api_key.revoke',
  'export.account',
  'export.workspace',
  'account.delete_requested',
  'account.delete_cancelled',
  'account.deleted',
  'workspace.delete_requested',
  'workspace.deleted',
] as const;
export type SecurityAction = (typeof SECURITY_ACTIONS)[number];

export async function recordSecurityEvent(e: {
  userId: string | null;
  action: SecurityAction;
  teamId?: string | null;
  target?: string;
  meta?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const ctx = e.ip === undefined && e.userAgent === undefined ? await requestContext() : { ip: e.ip ?? null, userAgent: e.userAgent ?? null };
    await getDb()
      .prepare('INSERT INTO security_events (id, team_id, user_id, action, target, meta, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`se_${randomBytes(12).toString('base64url')}`, e.teamId ?? null, e.userId, e.action, (e.target ?? '').slice(0, 200), JSON.stringify(e.meta ?? {}), ctx.ip, ctx.userAgent, nowIso());
  } catch (err) {
    // El registro nunca rompe la acción que ya ocurrió.
    console.error('[security] event', err instanceof Error ? err.message : err);
  }
}

export interface SecurityEventDto {
  id: string;
  source: 'security' | 'members';
  action: string;
  actorId: string | null;
  actorEmail: string;
  target: string;
  meta: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

function parseMeta(raw: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(String(raw ?? '{}')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Registro del workspace: sus eventos de seguridad, los de cuenta (logins, dos pasos) de quienes
 * hoy son miembros, y los cambios de miembros y permisos (workspace_audit). Más nuevo primero.
 * `before`: cursor (created_at) para "cargar más".
 */
export async function listWorkspaceSecurityEvents(teamId: string, opts: { limit?: number; before?: string | null } = {}): Promise<SecurityEventDto[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 5000);
  const before = opts.before ?? '9999';
  const rows = (await getDb()
    .prepare(
      `SELECT * FROM (
         SELECT e.id, 'security' AS source, e.action, e.user_id AS actor_id, COALESCE(u.email, '') AS actor_email, e.target, e.meta, e.ip, e.user_agent, e.created_at
         FROM security_events e LEFT JOIN users u ON u.id = e.user_id
         WHERE (e.team_id = ? OR (e.team_id IS NULL AND EXISTS (
                  SELECT 1 FROM team_members m WHERE m.team_id = ? AND m.user_id = e.user_id AND m.role != 'guest'
                    AND e.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', m.created_at))))
           AND e.created_at < ?
         UNION ALL
         SELECT a.id, 'members' AS source, a.action, a.actor_id, COALESCE(u.email, ''), a.target_label, a.after, NULL, NULL,
                strftime('%Y-%m-%dT%H:%M:%fZ', a.created_at)
         FROM workspace_audit a LEFT JOIN users u ON u.id = a.actor_id
         WHERE a.team_id = ? AND strftime('%Y-%m-%dT%H:%M:%fZ', a.created_at) < ?
       ) ORDER BY created_at DESC LIMIT ${limit}`,
    )
    .all(teamId, teamId, before, teamId, before)) as Array<Record<string, unknown>>;
  return rows.map(toDto);
}

/** Lo de una persona (Ajustes › Seguridad › Actividad reciente). */
export async function listUserSecurityEvents(userId: string, limit = 20): Promise<SecurityEventDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT e.id, 'security' AS source, e.action, e.user_id AS actor_id, COALESCE(u.email, '') AS actor_email, e.target, e.meta, e.ip, e.user_agent, e.created_at
       FROM security_events e LEFT JOIN users u ON u.id = e.user_id WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT ?`,
    )
    .all(userId, Math.min(limit, 100))) as Array<Record<string, unknown>>;
  return rows.map(toDto);
}

function toDto(r: Record<string, unknown>): SecurityEventDto {
  return {
    id: String(r.id),
    source: r.source === 'members' ? 'members' : 'security',
    action: String(r.action),
    actorId: (r.actor_id as string | null) ?? null,
    actorEmail: String(r.actor_email ?? ''),
    target: String(r.target ?? ''),
    meta: parseMeta(r.meta),
    ip: (r.ip as string | null) ?? null,
    userAgent: (r.user_agent as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  // Sin fórmulas al abrirlo en una planilla.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function securityEventsCsv(rows: SecurityEventDto[]): string {
  const head = ['time', 'source', 'action', 'actor', 'target', 'details', 'ip', 'user_agent'];
  const lines = rows.map((r) => [r.createdAt, r.source, r.action, r.actorEmail, r.target, r.meta, r.ip, r.userAgent].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}

// ---------- Retención ----------

export const SECURITY_EVENTS_RETENTION_DAYS = 365;
export const ENDED_SESSIONS_RETENTION_DAYS = 90;

/** Borra eventos de más de un año y sesiones cerradas o vencidas hace más de 90 días. */
export async function purgeSecurityRecords(now = Date.now()): Promise<{ events: number; sessions: number }> {
  const db = getDb();
  const ev = await db.prepare('DELETE FROM security_events WHERE created_at < ?').run(new Date(now - SECURITY_EVENTS_RETENTION_DAYS * 86_400_000).toISOString());
  const cutoff = new Date(now - ENDED_SESSIONS_RETENTION_DAYS * 86_400_000).toISOString();
  const ss = await db.prepare('DELETE FROM user_sessions WHERE (revoked_at IS NOT NULL AND revoked_at < ?) OR expires_at < ?').run(cutoff, cutoff);
  return { events: ev.changes, sessions: ss.changes };
}
