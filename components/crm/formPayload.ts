/**
 * Formularios de alta del CRM (contacto, empresa, deal): FormData → body del
 * POST. Puro, sin React, para testearlo y usarlo desde server o client.
 */

export interface CustomFieldDef {
  name: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'boolean';
  options: string[];
}

export const CUSTOM_PREFIX = 'custom.';

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Campos propios: `custom.<name>` con el tipo de cada definición. Vacíos se omiten. */
export function readCustomFields(fd: FormData, defs: CustomFieldDef[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of defs) {
    const key = CUSTOM_PREFIX + f.name;
    if (f.type === 'boolean') {
      if (fd.get(key) !== null) out[f.name] = true;
      continue;
    }
    const v = str(fd, key);
    if (v === undefined) continue;
    if (f.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) out[f.name] = n;
    } else {
      out[f.name] = v;
    }
  }
  return out;
}

export function contactPayload(fd: FormData, customFields: CustomFieldDef[]) {
  return {
    firstName: str(fd, 'firstName'),
    lastName: str(fd, 'lastName'),
    email: str(fd, 'email'),
    phone: str(fd, 'phone'),
    jobTitle: str(fd, 'jobTitle'),
    website: str(fd, 'website'),
    city: str(fd, 'city'),
    country: str(fd, 'country'),
    lifecycleStage: str(fd, 'lifecycleStage') ?? 'lead',
    leadStatus: str(fd, 'leadStatus') ?? 'new',
    source: str(fd, 'source'),
    companyId: str(fd, 'companyId') ?? null,
    custom: readCustomFields(fd, customFields),
  };
}

/**
 * Dominio a partir de lo que escribieron (o del sitio web si el dominio quedó
 * vacío): sin protocolo, sin www, sin ruta. "https://www.Acme.com/x" → "acme.com".
 */
export function deriveDomain(domain: string | undefined, website: string | undefined): string | undefined {
  const raw = (domain || website || '').trim().toLowerCase();
  if (!raw) return undefined;
  const host = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/^www\./, '')
    .replace(/:\d+$/, '');
  return host || undefined;
}

export function companyPayload(fd: FormData) {
  const website = str(fd, 'website');
  const employees = str(fd, 'employees');
  return {
    name: str(fd, 'name') ?? '',
    domain: deriveDomain(str(fd, 'domain'), website) ?? '',
    industry: str(fd, 'industry') ?? '',
    employees: employees !== undefined && Number.isFinite(Number(employees)) ? Number(employees) : null,
    phone: str(fd, 'phone') ?? '',
    website: website ?? '',
    city: str(fd, 'city') ?? '',
    country: str(fd, 'country') ?? '',
    lifecycleStage: str(fd, 'lifecycleStage') ?? 'lead',
  };
}

/** Etapas elegibles al crear un deal: las abiertas (si no hay, todas). */
export function creatableStages<S extends { is_won: number; is_lost: number }>(
  pipeline: { stages: S[] } | undefined,
): S[] {
  const all = pipeline?.stages ?? [];
  const open = all.filter((s) => !s.is_won && !s.is_lost);
  return open.length ? open : all;
}

export function dealPayload(fd: FormData, fixedContactId?: string) {
  const amount = str(fd, 'amount');
  const contactId = fixedContactId ?? str(fd, 'contactId');
  const source = str(fd, 'source');
  const description = str(fd, 'description');
  return {
    pipelineId: str(fd, 'pipelineId') ?? '',
    stageId: str(fd, 'stageId') ?? '',
    name: str(fd, 'name') ?? '',
    amount: amount && Number.isFinite(Number(amount)) ? Number(amount) : 0,
    currency: (str(fd, 'currency') ?? 'USD').toUpperCase(),
    closeDate: str(fd, 'closeDate') ?? null,
    priority: str(fd, 'priority') ?? 'medium',
    ...(source ? { source } : {}),
    ...(description ? { description } : {}),
    ...(contactId ? { contactIds: [contactId] } : {}),
  };
}
