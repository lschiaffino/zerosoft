/**
 * Credenciales por workspace para Flow (nodos de integraciones, HTTP) y
 * Robots ({{credentials.<name>.password}}). Server-only.
 *
 * Cifrado: AES-256-GCM. Clave = SHA-256 de CREDENTIALS_KEY, o de
 * ENCRYPTION_KEY / NEXTAUTH_SECRET si no está (con separación de dominio).
 * El texto cifrado queda atado al workspace y a la credencial (AAD): una fila
 * copiada a otro workspace no se puede descifrar. Rotar la clave invalida las
 * credenciales guardadas (hay que volver a cargarlas).
 *
 * Los secretos nunca vuelven al cliente: la API devuelve solo los campos no
 * secretos y una pista enmascarada.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { getDb, type FlowCredentialRow } from './db';
import {
  credentialFields,
  isCredentialType,
  maskSecret,
  normalizeCredentialData,
  CREDENTIAL_NAME_RE,
  type CredentialErrorCode,
  type CredentialType,
} from './flow-credentials-schema';

const PREFIX = 'cred:v1:';

function key(): Buffer {
  const dedicated = process.env.CREDENTIALS_KEY;
  if (dedicated) return createHash('sha256').update(dedicated).digest();
  const secret = process.env.ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('CREDENTIALS_KEY, ENCRYPTION_KEY or NEXTAUTH_SECRET is required');
    return createHash('sha256').update('zerosoft-dev-credentials-key').digest();
  }
  return createHash('sha256').update(`zerosoft:flow-credentials:${secret}`).digest();
}

function aad(workspaceId: string, credentialId: string): Buffer {
  return Buffer.from(`${workspaceId}:${credentialId}`, 'utf8');
}

export function encryptCredential(workspaceId: string, credentialId: string, data: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(aad(workspaceId, credentialId));
  const enc = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`;
}

/** null si no se puede descifrar (otra clave, otro workspace o dato corrupto). */
export function decryptCredential(workspaceId: string, credentialId: string, value: string): Record<string, string> | null {
  if (!value.startsWith(PREFIX)) return null;
  try {
    const [iv, tag, data] = value.slice(PREFIX.length).split('.');
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
    decipher.setAAD(aad(workspaceId, credentialId));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plain = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plain) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : null;
  } catch {
    return null;
  }
}

// ---------- DTO ----------

export interface CredentialDto {
  id: string;
  name: string;
  type: CredentialType;
  /** Campos no secretos (p. ej. usuario, header). */
  fields: Record<string, string>;
  /** Campos secretos con valor guardado (para mostrar "guardado"). */
  secretsSet: string[];
  hint: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedCredential {
  id: string;
  name: string;
  type: CredentialType;
  data: Record<string, string>;
}

function toDto(row: FlowCredentialRow): CredentialDto {
  const type = (isCredentialType(row.type) ? row.type : 'api_key') as CredentialType;
  const data = decryptCredential(row.user_id, row.id, row.data) ?? {};
  const fields: Record<string, string> = {};
  const secretsSet: string[] = [];
  for (const f of credentialFields(type)) {
    if (!data[f.key]) continue;
    if (f.secret) secretsSet.push(f.key);
    else fields[f.key] = data[f.key];
  }
  return { id: row.id, name: row.name, type, fields, secretsSet, hint: row.hint, createdAt: row.created_at, updatedAt: row.updated_at };
}

function hintFor(type: CredentialType, data: Record<string, string>): string {
  const first = credentialFields(type).find((f) => f.secret && data[f.key]);
  return first ? maskSecret(data[first.key]) : '';
}

/** Valores secretos de una credencial (para redactar pasos, logs y errores). */
export function secretValues(type: CredentialType, data: Record<string, string>): string[] {
  const out: string[] = [];
  for (const f of credentialFields(type)) {
    const v = data[f.key];
    if (!f.secret || !v) continue;
    out.push(v);
    if (f.key === 'serviceAccountJson') {
      try {
        const pk = (JSON.parse(v) as { private_key?: string }).private_key;
        if (pk) out.push(pk, JSON.stringify(pk).slice(1, -1));
      } catch {
        // validado al guardar
      }
    }
  }
  if (type === 'basic' && data.username && data.password) {
    out.push(Buffer.from(`${data.username}:${data.password}`).toString('base64'));
  }
  return out.filter((s) => s.length >= 4);
}

// ---------- CRUD ----------

export async function listCredentials(workspaceId: string): Promise<CredentialDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM flow_credentials WHERE user_id = ? ORDER BY name COLLATE NOCASE')
    .all(workspaceId)) as FlowCredentialRow[];
  return rows.map(toDto);
}

async function getRow(workspaceId: string, id: string): Promise<FlowCredentialRow | null> {
  return ((await getDb()
    .prepare('SELECT * FROM flow_credentials WHERE id = ? AND user_id = ?')
    .get(id, workspaceId)) as FlowCredentialRow | undefined) ?? null;
}

export async function getCredential(workspaceId: string, id: string): Promise<CredentialDto | null> {
  const row = await getRow(workspaceId, id);
  return row ? toDto(row) : null;
}

export type CredentialWriteResult =
  | { ok: true; credential: CredentialDto }
  | { ok: false; error: CredentialErrorCode | 'not_found'; field?: string };

async function nameTaken(workspaceId: string, name: string, exceptId?: string): Promise<boolean> {
  const row = (await getDb()
    .prepare('SELECT id FROM flow_credentials WHERE user_id = ? AND lower(name) = lower(?)')
    .get(workspaceId, name)) as { id: string } | undefined;
  return !!row && row.id !== exceptId;
}

export async function createCredential(
  workspaceId: string,
  actorId: string | null,
  input: { name: string; type: string; data: Record<string, string> },
): Promise<CredentialWriteResult> {
  const name = input.name.trim();
  if (!CREDENTIAL_NAME_RE.test(name)) return { ok: false, error: 'invalid_name' };
  if (!isCredentialType(input.type)) return { ok: false, error: 'invalid_type' };
  const norm = normalizeCredentialData(input.type, input.data);
  if (!norm.ok) return norm;
  if (await nameTaken(workspaceId, name)) return { ok: false, error: 'duplicate_name' };
  const id = crypto.randomUUID();
  const ts = new Date().toISOString();
  await getDb()
    .prepare(
      `INSERT INTO flow_credentials (id, user_id, name, type, data, hint, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, name, input.type, encryptCredential(workspaceId, id, norm.data), hintFor(input.type, norm.data), actorId, ts, ts);
  return { ok: true, credential: (await getCredential(workspaceId, id))! };
}

export async function updateCredential(
  workspaceId: string,
  id: string,
  patch: { name?: string; data?: Record<string, string> },
): Promise<CredentialWriteResult> {
  const row = await getRow(workspaceId, id);
  if (!row || !isCredentialType(row.type)) return { ok: false, error: 'not_found' };
  const name = patch.name?.trim() ?? row.name;
  if (!CREDENTIAL_NAME_RE.test(name)) return { ok: false, error: 'invalid_name' };
  if (name !== row.name && (await nameTaken(workspaceId, name, id))) return { ok: false, error: 'duplicate_name' };
  let encrypted = row.data;
  let hint = row.hint;
  if (patch.data) {
    const current = decryptCredential(workspaceId, id, row.data) ?? {};
    const merged: Record<string, string> = {};
    for (const f of credentialFields(row.type)) {
      const next = patch.data[f.key];
      // Secreto vacío = se conserva; no secreto vacío = se borra.
      if (f.secret && (next === undefined || next === '')) {
        if (current[f.key]) merged[f.key] = current[f.key];
      } else if (next !== undefined) merged[f.key] = next;
      else if (current[f.key]) merged[f.key] = current[f.key];
    }
    const norm = normalizeCredentialData(row.type, merged);
    if (!norm.ok) return norm;
    encrypted = encryptCredential(workspaceId, id, norm.data);
    hint = hintFor(row.type, norm.data);
  }
  await getDb()
    .prepare('UPDATE flow_credentials SET name = ?, data = ?, hint = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(name, encrypted, hint, new Date().toISOString(), id, workspaceId);
  return { ok: true, credential: (await getCredential(workspaceId, id))! };
}

export async function deleteCredential(workspaceId: string, id: string): Promise<boolean> {
  const res = await getDb().prepare('DELETE FROM flow_credentials WHERE id = ? AND user_id = ?').run(id, workspaceId);
  return res.changes > 0;
}

/** Credencial en claro, por id o por nombre, solo del workspace indicado. */
export async function resolveCredential(workspaceId: string, idOrName: string): Promise<ResolvedCredential | null> {
  const ref = idOrName.trim();
  if (!ref) return null;
  const row = (await getDb()
    .prepare('SELECT * FROM flow_credentials WHERE user_id = ? AND (id = ? OR name = ?) LIMIT 1')
    .get(workspaceId, ref, ref)) as FlowCredentialRow | undefined;
  if (!row || !isCredentialType(row.type)) return null;
  const data = decryptCredential(workspaceId, row.id, row.data);
  if (!data) return null;
  return { id: row.id, name: row.name, type: row.type, data };
}

/** Credenciales referenciadas por nombre en un texto ({{credentials.<name>.x}}). */
export function referencedCredentialNames(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*credentials\.([A-Za-z0-9_-]{1,60})\b/g)) out.add(m[1]);
  return [...out];
}
