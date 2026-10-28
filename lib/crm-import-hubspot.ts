/**
 * CRM — fuente HubSpot (API v3/v4 con un token de Private App). Server-only.
 *
 * Permisos (scopes) que tiene que tener la Private App, todos de lectura:
 * - crm.objects.contacts.read, crm.objects.companies.read, crm.objects.deals.read
 *   (las notas, llamadas, reuniones y tareas se leen con el de contactos)
 * - crm.objects.owners.read
 * - crm.schemas.contacts.read, crm.schemas.companies.read, crm.schemas.deals.read
 *   (propiedades propias y pipelines)
 * - sales-email-read (solo para traer los emails registrados)
 * - crm.lists.read (listas de contactos y empresas → etiquetas)
 *
 * Lectura: listados con `after` (100 por página) y asociaciones por lote
 * (POST /crm/v4/associations/{de}/{a}/batch/read, 100 ids por pedido). El
 * cliente HTTP respeta 100 pedidos cada 10 s y reintenta los 429.
 */
import {
  createHttpClient,
  dbTimestamp,
  domainFromUrl,
  htmlToText,
  type CrmSource,
  type FetchLike,
  type HttpRequest,
  type ImportPhase,
  type RateLimiter,
  type SleepFn,
  type SourcePage,
  type SrcActivity,
  type SrcActivityType,
  type SrcCompany,
  type SrcContact,
  type SrcDeal,
  type SrcField,
  type SrcList,
  type SrcOwner,
  type SrcPipeline,
  type SrcRecord,
  ymd,
} from './crm-import-source';
import type { CrmCustomFieldType } from './schema/types';

export const HUBSPOT_BASE = 'https://api.hubapi.com';

export const HUBSPOT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
  'crm.objects.owners.read',
  'crm.schemas.contacts.read',
  'crm.schemas.companies.read',
  'crm.schemas.deals.read',
  'crm.lists.read',
  'sales-email-read',
] as const;

const PHASES: ImportPhase[] = ['companies', 'contacts', 'deals', 'notes', 'calls', 'meetings', 'tasks', 'emails', 'lists'];

/** Listas por página, páginas de miembros por tramo y miembros por lista (las más grandes se cortan). */
const LISTS_PER_PAGE = 10;
const MEMBER_PAGES_PER_STEP = 8;
export const LIST_MAX_MEMBERS = 10_000;

/** objectTypeId de HubSpot de cada lista que se importa. */
const LIST_OBJECTS: Record<string, 'contact' | 'company'> = { '0-1': 'contact', '0-2': 'company' };

interface HsListDef {
  listId: string | number;
  name: string;
  objectTypeId?: string;
  processingType?: string;
  size?: number;
}

/** Objeto de HubSpot de cada fase. */
const OBJECT: Record<string, string> = {
  companies: 'companies',
  contacts: 'contacts',
  deals: 'deals',
  notes: 'notes',
  calls: 'calls',
  meetings: 'meetings',
  tasks: 'tasks',
  emails: 'emails',
};

const BASE_PROPS: Record<string, string[]> = {
  companies: [
    'name', 'domain', 'industry', 'numberofemployees', 'phone', 'website', 'city', 'country',
    'lifecyclestage', 'hubspot_owner_id', 'hs_parent_company_id',
  ],
  contacts: [
    'firstname', 'lastname', 'email', 'phone', 'mobilephone', 'jobtitle', 'website', 'city', 'country',
    'lifecyclestage', 'hs_lead_status', 'hs_analytics_source', 'hubspot_owner_id',
  ],
  deals: [
    'dealname', 'pipeline', 'dealstage', 'amount', 'deal_currency_code', 'closedate', 'hubspot_owner_id',
    'description', 'closed_lost_reason',
  ],
  notes: ['hs_note_body', 'hs_timestamp', 'hubspot_owner_id'],
  calls: [
    'hs_call_title', 'hs_call_body', 'hs_timestamp', 'hs_call_direction', 'hs_call_duration',
    'hs_call_disposition', 'hubspot_owner_id',
  ],
  meetings: [
    'hs_meeting_title', 'hs_meeting_body', 'hs_timestamp', 'hs_meeting_start_time', 'hs_meeting_end_time',
    'hs_meeting_outcome', 'hubspot_owner_id',
  ],
  tasks: ['hs_task_subject', 'hs_task_body', 'hs_timestamp', 'hs_task_status', 'hubspot_owner_id'],
  emails: ['hs_email_subject', 'hs_email_text', 'hs_email_html', 'hs_email_direction', 'hs_timestamp', 'hubspot_owner_id'],
};

/** Asociaciones que se leen por lote en cada fase. */
const ASSOC: Record<string, string[]> = {
  contacts: ['companies'],
  deals: ['contacts', 'companies'],
  notes: ['contacts', 'companies', 'deals'],
  calls: ['contacts', 'companies', 'deals'],
  meetings: ['contacts', 'companies', 'deals'],
  tasks: ['contacts', 'companies', 'deals'],
  emails: ['contacts', 'companies', 'deals'],
};

/** typeId de las asociaciones primarias (HUBSPOT_DEFINED): contacto→empresa 1, deal→empresa 5. */
const PRIMARY_TYPE_IDS = new Set([1, 5]);

interface HsProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  hubspotDefined?: boolean;
  calculated?: boolean;
  archived?: boolean;
  hidden?: boolean;
  showCurrencySymbol?: boolean;
  options?: Array<{ label: string; value: string; hidden?: boolean }>;
}

interface HsObject {
  id: string;
  properties: Record<string, string | null>;
}

interface HsList {
  results: HsObject[];
  paging?: { next?: { after?: string } };
}

interface HsAssocBatch {
  results: Array<{
    from: { id: string };
    to: Array<{ toObjectId: string | number; associationTypes?: Array<{ category?: string; typeId?: number; label?: string | null }> }>;
  }>;
}

/** Tipo de propiedad de HubSpot → tipo de custom field nuestro. */
export function hubspotFieldType(p: Pick<HsProperty, 'type' | 'fieldType' | 'showCurrencySymbol'>): CrmCustomFieldType {
  if (p.type === 'number') return p.showCurrencySymbol ? 'currency' : 'number';
  if (p.type === 'date' || p.type === 'datetime') return 'date';
  if (p.type === 'bool' || p.fieldType === 'booleancheckbox') return 'boolean';
  if (p.type === 'enumeration') return p.fieldType === 'checkbox' ? 'multiselect' : 'select';
  if (p.type === 'phone_number' || p.fieldType === 'phonenumber') return 'phone';
  return 'text';
}

const val = (o: HsObject, k: string) => (o.properties[k] ?? '').trim();

function num(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export interface HubspotOptions {
  fetch?: FetchLike;
  sleep?: SleepFn;
  limiter?: RateLimiter;
  base?: string;
}

export function createHubspotSource(token: string, opts: HubspotOptions = {}): CrmSource {
  const base = opts.base ?? HUBSPOT_BASE;
  const request: HttpRequest = createHttpClient({
    fetch: opts.fetch,
    sleep: opts.sleep,
    limiter: opts.limiter,
    headers: { authorization: `Bearer ${token}` },
  });

  async function allPages<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let i = 0; i < 1000; i++) {
      const sep = path.includes('?') ? '&' : '?';
      const res = await request<{ results: T[]; paging?: { next?: { after?: string } } }>(
        `${base}${path}${sep}limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      );
      out.push(...(res.results ?? []));
      after = res.paging?.next?.after;
      if (!after) break;
    }
    return out;
  }

  /** Asociaciones por lote: id → [{ id, primary }]. */
  async function associations(from: string, to: string, ids: string[]): Promise<Map<string, Array<{ id: string; primary: boolean }>>> {
    const out = new Map<string, Array<{ id: string; primary: boolean }>>();
    for (let i = 0; i < ids.length; i += 100) {
      const res = await request<HsAssocBatch>(`${base}/crm/v4/associations/${from}/${to}/batch/read`, {
        method: 'POST',
        body: { inputs: ids.slice(i, i + 100).map((id) => ({ id })) },
      });
      for (const r of res.results ?? []) {
        out.set(
          String(r.from.id),
          r.to.map((t) => ({
            id: String(t.toObjectId),
            primary: (t.associationTypes ?? []).some(
              (a) => (a.category === 'HUBSPOT_DEFINED' && PRIMARY_TYPE_IDS.has(Number(a.typeId))) || a.label === 'Primary',
            ),
          })),
        );
      }
    }
    return out;
  }

  function custom(o: HsObject, fields: SrcField[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
      const v = val(o, f.key);
      if (v) out[f.key] = v;
    }
    return out;
  }

  function toCompany(o: HsObject, fields: SrcField[]): SrcCompany {
    const website = val(o, 'website');
    return {
      kind: 'company',
      id: o.id,
      name: val(o, 'name'),
      domain: domainFromUrl(val(o, 'domain') || website),
      industry: val(o, 'industry'),
      employees: num(val(o, 'numberofemployees')),
      phone: val(o, 'phone'),
      website,
      city: val(o, 'city'),
      country: val(o, 'country'),
      lifecycleStage: val(o, 'lifecyclestage'),
      ownerId: val(o, 'hubspot_owner_id'),
      parentId: val(o, 'hs_parent_company_id'),
      custom: custom(o, fields.filter((f) => f.entity === 'companies')),
    };
  }

  function sortPrimary(list: Array<{ id: string; primary: boolean }> | undefined) {
    return [...(list ?? [])].sort((a, b) => Number(b.primary) - Number(a.primary));
  }

  function toContact(o: HsObject, fields: SrcField[], companies?: Array<{ id: string; primary: boolean }>): SrcContact {
    return {
      kind: 'contact',
      id: o.id,
      firstName: val(o, 'firstname'),
      lastName: val(o, 'lastname'),
      email: val(o, 'email').toLowerCase(),
      phone: val(o, 'phone') || val(o, 'mobilephone'),
      jobTitle: val(o, 'jobtitle'),
      website: val(o, 'website'),
      city: val(o, 'city'),
      country: val(o, 'country'),
      lifecycleStage: val(o, 'lifecyclestage'),
      leadStatus: val(o, 'hs_lead_status'),
      source: val(o, 'hs_analytics_source'),
      ownerId: val(o, 'hubspot_owner_id'),
      companies: sortPrimary(companies),
      custom: custom(o, fields.filter((f) => f.entity === 'contacts')),
    };
  }

  function toDeal(
    o: HsObject,
    fields: SrcField[],
    contacts?: Array<{ id: string }>,
    companies?: Array<{ id: string; primary: boolean }>,
  ): SrcDeal {
    return {
      kind: 'deal',
      id: o.id,
      name: val(o, 'dealname'),
      pipelineId: val(o, 'pipeline'),
      stageId: val(o, 'dealstage'),
      amount: num(val(o, 'amount')),
      currency: val(o, 'deal_currency_code').toUpperCase(),
      closeDate: ymd(val(o, 'closedate')),
      ownerId: val(o, 'hubspot_owner_id'),
      description: val(o, 'description'),
      lostReason: val(o, 'closed_lost_reason'),
      contactIds: (contacts ?? []).map((c) => c.id),
      companies: sortPrimary(companies),
      custom: custom(o, fields.filter((f) => f.entity === 'deals')),
    };
  }

  function toActivity(phase: ImportPhase, o: HsObject, assoc: Record<string, Array<{ id: string }> | undefined>): SrcActivity {
    const at = dbTimestamp(val(o, 'hs_timestamp'));
    const base = {
      kind: 'activity' as const,
      id: `${phase}:${o.id}`,
      at,
      dueAt: '',
      done: true,
      ownerId: val(o, 'hubspot_owner_id'),
      direction: '' as SrcActivity['direction'],
      durationMin: null as number | null,
      outcome: '',
      contactIds: (assoc.contacts ?? []).map((x) => x.id),
      companyIds: (assoc.companies ?? []).map((x) => x.id),
      dealIds: (assoc.deals ?? []).map((x) => x.id),
    };
    const type: SrcActivityType = phase === 'notes' ? 'note' : (phase.slice(0, -1) as SrcActivityType);
    switch (phase) {
      case 'notes':
        return { ...base, type, subject: '', body: htmlToText(val(o, 'hs_note_body')) };
      case 'calls': {
        const dir = val(o, 'hs_call_direction').toUpperCase();
        const ms = num(val(o, 'hs_call_duration'));
        return {
          ...base,
          type,
          subject: val(o, 'hs_call_title'),
          body: htmlToText(val(o, 'hs_call_body')),
          direction: dir === 'INBOUND' ? 'inbound' : dir === 'OUTBOUND' ? 'outbound' : '',
          durationMin: ms === null ? null : Math.round(ms / 60000),
        };
      }
      case 'meetings': {
        const start = dbTimestamp(val(o, 'hs_meeting_start_time')) || at;
        const end = dbTimestamp(val(o, 'hs_meeting_end_time'));
        const dur = start && end ? Math.round((Date.parse(`${end.replace(' ', 'T')}Z`) - Date.parse(`${start.replace(' ', 'T')}Z`)) / 60000) : null;
        return {
          ...base,
          type,
          subject: val(o, 'hs_meeting_title'),
          body: htmlToText(val(o, 'hs_meeting_body')),
          at: start,
          dueAt: start,
          done: start ? start <= dbTimestamp(Date.now()) : true,
          durationMin: dur !== null && dur >= 0 ? dur : null,
          outcome: val(o, 'hs_meeting_outcome').toLowerCase(),
        };
      }
      case 'tasks':
        return {
          ...base,
          type,
          subject: val(o, 'hs_task_subject'),
          body: htmlToText(val(o, 'hs_task_body')),
          dueAt: at,
          done: val(o, 'hs_task_status').toUpperCase() === 'COMPLETED',
        };
      default: {
        const dir = val(o, 'hs_email_direction').toUpperCase();
        return {
          ...base,
          type: 'email',
          subject: val(o, 'hs_email_subject'),
          body: val(o, 'hs_email_text') || htmlToText(val(o, 'hs_email_html')),
          direction: dir === 'INCOMING_EMAIL' ? 'inbound' : dir ? 'outbound' : '',
        };
      }
    }
  }

  return {
    provider: 'hubspot',
    phases: () => [...PHASES],

    async owners(): Promise<SrcOwner[]> {
      const rows = await allPages<{ id: string; email?: string; firstName?: string; lastName?: string }>('/crm/v3/owners');
      return rows.map((o) => ({
        id: String(o.id),
        email: (o.email ?? '').toLowerCase(),
        name: [o.firstName, o.lastName].filter(Boolean).join(' '),
      }));
    },

    async fields(): Promise<SrcField[]> {
      const out: SrcField[] = [];
      for (const entity of ['contacts', 'companies', 'deals'] as const) {
        const res = await request<{ results: HsProperty[] }>(`${base}/crm/v3/properties/${entity}`);
        for (const p of res.results ?? []) {
          if (p.hubspotDefined || p.archived || p.calculated || p.hidden) continue;
          const type = hubspotFieldType(p);
          const opts = (p.options ?? []).filter((o) => !o.hidden && o.label);
          out.push({
            entity,
            key: p.name,
            label: p.label || p.name,
            type,
            options: type === 'select' || type === 'multiselect' ? opts.map((o) => o.label).slice(0, 100) : [],
            optionMap: opts.length ? Object.fromEntries(opts.map((o) => [o.value, o.label])) : undefined,
            separator: ';',
          });
        }
      }
      return out;
    },

    async pipelines(): Promise<SrcPipeline[]> {
      const res = await request<{
        results: Array<{
          id: string;
          label: string;
          displayOrder?: number;
          stages: Array<{ id: string; label: string; displayOrder?: number; metadata?: { probability?: string; isClosed?: string } }>;
        }>;
      }>(`${base}/crm/v3/pipelines/deals`);
      return [...(res.results ?? [])]
        .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
        .map((p) => ({
          id: String(p.id),
          name: p.label,
          stages: [...p.stages]
            .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0))
            .map((s) => {
              const prob = Number(s.metadata?.probability ?? 0);
              const closed = s.metadata?.isClosed === 'true';
              return {
                id: String(s.id),
                name: s.label,
                probability: Math.round((Number.isFinite(prob) ? prob : 0) * 100),
                isWon: closed && prob >= 1,
                isLost: closed && prob <= 0,
              };
            }),
        }));
    },

    async count(phase) {
      if (phase === 'lists') {
        const res = await request<{ total?: number; lists?: HsListDef[] }>(`${base}/crm/v3/lists/search`, {
          method: 'POST',
          body: { count: 1, offset: 0 },
        });
        return typeof res.total === 'number' ? res.total : null;
      }
      const res = await request<{ total?: number }>(`${base}/crm/v3/objects/${OBJECT[phase]}/search`, {
        method: 'POST',
        body: { limit: 1, properties: ['hs_object_id'] },
      });
      return typeof res.total === 'number' ? res.total : null;
    },

    async page(phase, cursor, fields, limit = 100): Promise<SourcePage> {
      if (phase === 'lists') {
        // Cursor: página de listas (offset), lista dentro de esa página y página de miembros.
        // Cada tramo trae hasta 2.000 miembros de una lista: una lista enorme no pasa el tope de la función.
        let c = { o: 0, i: 0, a: null as string | null, n: 0 };
        try {
          if (cursor) c = { ...c, ...(JSON.parse(cursor) as Partial<typeof c>) };
        } catch {
          c.o = Number(cursor) || 0;
        }
        const res = await request<{ lists?: HsListDef[]; hasMore?: boolean; offset?: number }>(`${base}/crm/v3/lists/search`, {
          method: 'POST',
          body: { count: LISTS_PER_PAGE, offset: c.o },
        });
        const lists = res.lists ?? [];
        const nextPage = res.hasMore ? JSON.stringify({ o: typeof res.offset === 'number' ? res.offset : c.o + LISTS_PER_PAGE, i: 0, a: null, n: 0 }) : null;
        let i = c.i;
        while (i < lists.length && !LIST_OBJECTS[String(lists[i].objectTypeId ?? '')]) i++;
        const l = lists[i];
        if (!l) return { items: [], next: nextPage };
        const entity = LIST_OBJECTS[String(l.objectTypeId ?? '')];
        const memberIds: string[] = [];
        let after: string | undefined = (i === c.i ? c.a : null) ?? undefined;
        const seen = i === c.i ? c.n : 0;
        for (let p = 0; p < MEMBER_PAGES_PER_STEP; p++) {
          const m = await request<{ results?: Array<{ recordId: string | number }>; paging?: { next?: { after?: string } } }>(
            `${base}/crm/v3/lists/${encodeURIComponent(String(l.listId))}/memberships?limit=250${after ? `&after=${encodeURIComponent(after)}` : ''}`,
          );
          for (const r of m.results ?? []) memberIds.push(String(r.recordId));
          after = m.paging?.next?.after;
          if (!after || seen + memberIds.length >= LIST_MAX_MEMBERS) break;
        }
        const ids = memberIds.slice(0, Math.max(0, LIST_MAX_MEMBERS - seen));
        const item: SrcList = {
          kind: 'list',
          id: String(l.listId),
          name: (l.name ?? '').trim().slice(0, 80) || `List ${l.listId}`,
          entity,
          memberIds: ids,
          first: seen === 0 && (i !== c.i || !c.a),
        };
        const more = after && seen + ids.length < LIST_MAX_MEMBERS;
        const next = more
          ? JSON.stringify({ o: c.o, i, a: after, n: seen + ids.length })
          : i + 1 < lists.length
            ? JSON.stringify({ o: c.o, i: i + 1, a: null, n: 0 })
            : nextPage;
        return { items: [item], next };
      }
      const object = OBJECT[phase];
      const entityFields = fields.filter((f) => f.entity === phase).map((f) => f.key);
      const props = [...BASE_PROPS[phase], ...entityFields.slice(0, 200)];
      const res = await request<HsList>(
        `${base}/crm/v3/objects/${object}?limit=${limit}&archived=false&properties=${encodeURIComponent(props.join(','))}${
          cursor ? `&after=${encodeURIComponent(cursor)}` : ''
        }`,
      );
      const results = res.results ?? [];
      const ids = results.map((r) => r.id);
      const assoc: Record<string, Map<string, Array<{ id: string; primary: boolean }>>> = {};
      for (const to of ASSOC[phase] ?? []) {
        assoc[to] = ids.length ? await associations(object, to, ids) : new Map();
      }
      const items: SrcRecord[] = results.map((o) => {
        if (phase === 'companies') return toCompany(o, fields);
        if (phase === 'contacts') return toContact(o, fields, assoc.companies?.get(o.id));
        if (phase === 'deals') return toDeal(o, fields, assoc.contacts?.get(o.id), assoc.companies?.get(o.id));
        return toActivity(phase, o, {
          contacts: assoc.contacts?.get(o.id),
          companies: assoc.companies?.get(o.id),
          deals: assoc.deals?.get(o.id),
        });
      });
      return { items, next: res.paging?.next?.after ?? null };
    },
  };
}
