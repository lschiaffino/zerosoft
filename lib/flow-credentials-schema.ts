/**
 * Credenciales de Flow/Robots — catálogo de tipos y validación. Sin
 * dependencias de servidor: lo comparten la API, el motor y los editores.
 */
import { z } from 'zod';

export interface CredentialFieldDef {
  key: string;
  /** Secreto: nunca vuelve al cliente después de guardarlo; se redacta en logs. */
  secret: boolean;
  optional?: boolean;
  multiline?: boolean;
  placeholder?: string;
}

export const CREDENTIAL_TYPES = {
  api_key: {
    fields: [
      { key: 'headerName', secret: false, placeholder: 'Authorization' },
      { key: 'prefix', secret: false, optional: true, placeholder: 'Bearer' },
      { key: 'value', secret: true },
    ],
  },
  basic: {
    fields: [
      { key: 'username', secret: false },
      { key: 'password', secret: true },
    ],
  },
  oauth_token: { fields: [{ key: 'accessToken', secret: true }] },
  slack: {
    fields: [
      { key: 'botToken', secret: true, optional: true, placeholder: 'xoxb-…' },
      { key: 'webhookUrl', secret: true, optional: true, placeholder: 'https://hooks.slack.com/services/…' },
    ],
  },
  google: {
    fields: [
      { key: 'accessToken', secret: true, optional: true, placeholder: 'ya29.…' },
      { key: 'serviceAccountJson', secret: true, optional: true, multiline: true, placeholder: '{"type": "service_account", …}' },
    ],
  },
  stripe: {
    fields: [
      { key: 'secretKey', secret: true, placeholder: 'sk_live_…' },
      { key: 'webhookSecret', secret: true, optional: true, placeholder: 'whsec_…' },
    ],
  },
  notion: { fields: [{ key: 'token', secret: true, placeholder: 'ntn_…' }] },
  discord: { fields: [{ key: 'webhookUrl', secret: true, placeholder: 'https://discord.com/api/webhooks/…' }] },
  telegram: { fields: [{ key: 'botToken', secret: true, placeholder: '123456:ABC…' }] },
} as const satisfies Record<string, { fields: readonly CredentialFieldDef[] }>;

export type CredentialType = keyof typeof CREDENTIAL_TYPES;
export const CREDENTIAL_TYPE_KEYS = Object.keys(CREDENTIAL_TYPES) as CredentialType[];

export function isCredentialType(v: unknown): v is CredentialType {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CREDENTIAL_TYPES, v);
}

export function credentialFields(type: CredentialType): readonly CredentialFieldDef[] {
  return CREDENTIAL_TYPES[type].fields;
}

/** Nombre usable en plantillas: {{credentials.<name>.password}}. */
export const CREDENTIAL_NAME_RE = /^[A-Za-z0-9_-]{1,60}$/;

export const credentialCreateSchema = z.object({
  name: z.string().trim().regex(CREDENTIAL_NAME_RE),
  type: z.string().refine(isCredentialType),
  data: z.record(z.string().max(20_000)),
});

export const credentialUpdateSchema = z.object({
  name: z.string().trim().regex(CREDENTIAL_NAME_RE).optional(),
  /** Campos secretos vacíos = se conserva el valor guardado. */
  data: z.record(z.string().max(20_000)).optional(),
});

export type CredentialErrorCode = 'invalid_name' | 'invalid_type' | 'missing_field' | 'duplicate_name' | 'invalid_json';

/**
 * Normaliza los datos de un tipo: solo claves conocidas, recortadas. Exige los
 * campos no opcionales y reglas por tipo (Slack: token o webhook; Google:
 * token o cuenta de servicio con JSON válido).
 */
export function normalizeCredentialData(
  type: CredentialType,
  data: Record<string, string>,
): { ok: true; data: Record<string, string> } | { ok: false; error: CredentialErrorCode; field?: string } {
  const out: Record<string, string> = {};
  for (const f of credentialFields(type)) {
    const v = typeof data[f.key] === 'string' ? data[f.key].trim() : '';
    if (!v && !f.optional) return { ok: false, error: 'missing_field', field: f.key };
    if (v) out[f.key] = v;
  }
  if (type === 'slack' && !out.botToken && !out.webhookUrl) return { ok: false, error: 'missing_field', field: 'botToken' };
  if (type === 'google') {
    if (!out.accessToken && !out.serviceAccountJson) return { ok: false, error: 'missing_field', field: 'accessToken' };
    if (out.serviceAccountJson) {
      try {
        const sa = JSON.parse(out.serviceAccountJson) as { client_email?: string; private_key?: string };
        if (!sa.client_email || !sa.private_key) return { ok: false, error: 'invalid_json', field: 'serviceAccountJson' };
      } catch {
        return { ok: false, error: 'invalid_json', field: 'serviceAccountJson' };
      }
    }
  }
  return { ok: true, data: out };
}

/** Pista visible del secreto: '••••abcd'. */
export function maskSecret(value: string): string {
  if (!value) return '';
  return value.length <= 8 ? '••••' : `••••${value.slice(-4)}`;
}

// ---------- Redacción ----------

export const REDACTED = '[redacted]';

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Reemplaza cada secreto por [redacted] en textos, arrays y objetos (claves incluidas). */
export function redact<T>(value: T, secrets: readonly string[]): T {
  const list = [...new Set(secrets.filter((s) => s && s.length >= 4))].sort((a, b) => b.length - a.length);
  if (list.length === 0) return value;
  const re = new RegExp(list.map(escapeRe).join('|'), 'g');
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return v.replace(re, REDACTED);
    if (depth > 30 || v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k.replace(re, REDACTED)] = walk(x, depth + 1);
    return out;
  };
  return walk(value, 0) as T;
}
