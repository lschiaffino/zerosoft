/**
 * CRM — fuente Pipedrive (API v1 con el token personal de Ajustes › Personal
 * preferences › API). Server-only. El token va en el header x-api-token, nunca
 * en la URL.
 *
 * Personas → contactos, organizaciones → empresas, deals, pipelines y etapas,
 * notas y actividades (call, meeting, email; lo demás queda como tarea) y los
 * campos propios (claves hash de 40 caracteres). Pipedrive marca ganado o
 * perdido en el deal, no en la etapa: cada pipeline suma dos etapas "Won" y
 * "Lost" y los deals cerrados caen ahí.
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
  type SrcField,
  type SrcPipeline,
  type SrcRecord,
  ymd,
} from './crm-import-source';
import type { CrmCustomFieldType } from './schema/types';

export const PIPEDRIVE_BASE = 'https://api.pipedrive.com/v1';

const PHASES: ImportPhase[] = ['companies', 'contacts', 'deals', 'notes', 'activities'];

const ENDPOINT: Record<string, string> = {
  companies: '/organizations',
  contacts: '/persons',
  deals: '/deals?status=all_not_deleted',
  notes: '/notes',
  activities: '/activities?user_id=0',
};

const FIELD_ENDPOINT = { contacts: '/personFields', companies: '/organizationFields', deals: '/dealFields' } as const;

/** Etapas sintéticas de cierre por pipeline. */
export const wonStageId = (pipelineId: string) => `${pipelineId}:won`;
export const lostStageId = (pipelineId: string) => `${pipelineId}:lost`;

interface PdList<T> {
  success?: boolean;
  data: T[] | null;
  additional_data?: { pagination?: { more_items_in_collection?: boolean; next_start?: number } };
}

type Ref = number | string | null | { id?: number; value?: number | string; name?: string } | undefined;
type Row = Record<string, unknown>;

/** Los ids relacionados vienen como número o como objeto ({ value } / { id }). */
export function refId(v: Ref): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'object') return String(v.value ?? v.id ?? '');
  return String(v);
}

/** Tipo de campo de Pipedrive → tipo de custom field nuestro. */
export function pipedriveFieldType(t: string): CrmCustomFieldType {
  switch (t) {
    case 'double':
    case 'int':
      return 'number';
    case 'monetary':
      return 'currency';
    case 'date':
      return 'date';
    case 'enum':
      return 'select';
    case 'set':
      return 'multiselect';
    case 'phone':
      return 'phone';
    default:
      return 'text';
  }
}

/** Valor principal de una lista de emails/teléfonos ([{ value, primary }]). */
function primaryValue(v: unknown): string {
  if (typeof v === 'string') return v;
  if (!Array.isArray(v)) return '';
  const list = v as Array<{ value?: string; primary?: boolean }>;
  return ((list.find((x) => x.primary) ?? list[0])?.value ?? '').trim();
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/** "01:30" → 90 minutos. */
function durationMin(v: unknown): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(str(v));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export interface PipedriveOptions {
  fetch?: FetchLike;
  sleep?: SleepFn;
  limiter?: RateLimiter;
  base?: string;
}

export function createPipedriveSource(token: string, opts: PipedriveOptions = {}): CrmSource {
  const base = opts.base ?? PIPEDRIVE_BASE;
  const request: HttpRequest = createHttpClient({
    fetch: opts.fetch,
    sleep: opts.sleep,
    limiter: opts.limiter,
    headers: { 'x-api-token': token },
  });

  async function list<T>(path: string, start: number, limit: number) {
    const sep = path.includes('?') ? '&' : '?';
    return request<PdList<T>>(`${base}${path}${sep}start=${start}&limit=${limit}`);
  }

  async function all<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let start = 0;
    for (let i = 0; i < 1000; i++) {
      const res = await list<T>(path, start, 500);
      out.push(...(res.data ?? []));
      const p = res.additional_data?.pagination;
      if (!p?.more_items_in_collection || p.next_start === undefined) break;
      start = p.next_start;
    }
    return out;
  }

  function custom(row: Row, fields: SrcField[], entity: SrcField['entity']): Record<string, string> {
    const out: Record<string, string> = {};
    for (const f of fields) {
      if (f.entity !== entity) continue;
      const v = row[f.key];
      // Monetario: { value, currency } o el número directo.
      const raw = v && typeof v === 'object' && !Array.isArray(v) ? str((v as Row).value) : str(v);
      if (raw) out[f.key] = raw;
    }
    return out;
  }

  function toRecord(phase: ImportPhase, row: Row, fields: SrcField[]): SrcRecord {
    const id = String(row.id);
    if (phase === 'companies') {
      const website = str(row.website);
      return {
        kind: 'company',
        id,
        name: str(row.name),
        domain: domainFromUrl(website),
        industry: str(row.industry),
        employees: typeof row.employee_count === 'number' ? row.employee_count : null,
        phone: '',
        website,
        city: str(row.address_locality),
        country: str(row.address_country),
        lifecycleStage: '',
        ownerId: refId(row.owner_id as Ref),
        parentId: '',
        custom: custom(row, fields, 'companies'),
      };
    }
    if (phase === 'contacts') {
      const name = str(row.name);
      const first = str(row.first_name) || name.split(/\s+/)[0] || '';
      const last = str(row.last_name) || name.split(/\s+/).slice(1).join(' ');
      const org = refId(row.org_id as Ref);
      return {
        kind: 'contact',
        id,
        firstName: first,
        lastName: last,
        email: primaryValue(row.email).toLowerCase(),
        phone: primaryValue(row.phone),
        jobTitle: str(row.job_title),
        website: '',
        city: '',
        country: '',
        lifecycleStage: '',
        leadStatus: '',
        source: '',
        ownerId: refId(row.owner_id as Ref),
        companies: org ? [{ id: org, primary: true }] : [],
        custom: custom(row, fields, 'contacts'),
      };
    }
    if (phase === 'deals') {
      const pipelineId = refId(row.pipeline_id as Ref);
      const status = str(row.status);
      const stageId =
        status === 'won' ? wonStageId(pipelineId) : status === 'lost' ? lostStageId(pipelineId) : refId(row.stage_id as Ref);
      const person = refId(row.person_id as Ref);
      const org = refId(row.org_id as Ref);
      const amount = typeof row.value === 'number' ? row.value : Number(str(row.value)) || null;
      return {
        kind: 'deal',
        id,
        name: str(row.title),
        pipelineId,
        stageId,
        amount,
        currency: str(row.currency).toUpperCase(),
        closeDate: ymd(str(row.won_time) || str(row.lost_time) || str(row.close_time) || str(row.expected_close_date)),
        ownerId: refId((row.user_id ?? row.owner_id) as Ref),
        description: '',
        lostReason: str(row.lost_reason),
        contactIds: person ? [person] : [],
        companies: org ? [{ id: org, primary: true }] : [],
        custom: custom(row, fields, 'deals'),
      };
    }
    const links = {
      contactIds: refId(row.person_id as Ref) ? [refId(row.person_id as Ref)] : [],
      companyIds: refId(row.org_id as Ref) ? [refId(row.org_id as Ref)] : [],
      dealIds: refId(row.deal_id as Ref) ? [refId(row.deal_id as Ref)] : [],
    };
    if (phase === 'notes') {
      return {
        kind: 'activity',
        id: `note:${id}`,
        type: 'note',
        subject: '',
        body: htmlToText(str(row.content)),
        at: dbTimestamp(str(row.add_time)),
        dueAt: '',
        done: true,
        ownerId: refId(row.user_id as Ref),
        direction: '',
        durationMin: null,
        outcome: '',
        ...links,
      };
    }
    const kind = str(row.type);
    const type: SrcActivity['type'] = kind === 'call' ? 'call' : kind === 'meeting' ? 'meeting' : kind === 'email' ? 'email' : 'task';
    const due = str(row.due_date) ? dbTimestamp(`${str(row.due_date)} ${str(row.due_time) || '00:00'}:00`.slice(0, 19)) : '';
    const done = row.done === true || row.done === 1;
    return {
      kind: 'activity',
      id: `activity:${id}`,
      type,
      subject: str(row.subject),
      body: htmlToText(str(row.note)),
      at: dbTimestamp(str(row.marked_as_done_time)) || due || dbTimestamp(str(row.add_time)),
      dueAt: due,
      done,
      ownerId: refId((row.user_id ?? row.owner_id) as Ref),
      direction: '',
      durationMin: durationMin(row.duration),
      outcome: '',
      ...links,
    };
  }

  return {
    provider: 'pipedrive',
    phases: () => [...PHASES],

    async owners() {
      const res = await request<{ data: Array<{ id: number; name?: string; email?: string }> | null }>(`${base}/users`);
      return (res.data ?? []).map((u) => ({ id: String(u.id), email: (u.email ?? '').toLowerCase(), name: u.name ?? '' }));
    },

    async fields() {
      const out: SrcField[] = [];
      for (const entity of ['contacts', 'companies', 'deals'] as const) {
        const rows = await all<{
          key: string;
          name: string;
          field_type: string;
          edit_flag?: boolean;
          options?: Array<{ id: number | string; label: string }>;
        }>(FIELD_ENDPOINT[entity]);
        for (const f of rows) {
          // Los campos propios tienen clave hash; los de sistema, nombres legibles.
          if (!/^[0-9a-f]{40}$/.test(f.key)) continue;
          const type = pipedriveFieldType(f.field_type);
          const opts = (f.options ?? []).filter((o) => o.label);
          out.push({
            entity,
            key: f.key,
            label: f.name || f.key,
            type,
            options: type === 'select' || type === 'multiselect' ? opts.map((o) => o.label).slice(0, 100) : [],
            optionMap: opts.length ? Object.fromEntries(opts.map((o) => [String(o.id), o.label])) : undefined,
            separator: ',',
          });
        }
      }
      return out;
    },

    async pipelines(): Promise<SrcPipeline[]> {
      const pipes = await all<{ id: number; name: string; order_nr?: number }>('/pipelines');
      const stages = await all<{ id: number; name: string; pipeline_id: number; deal_probability?: number; order_nr?: number }>(
        '/stages',
      );
      return [...pipes]
        .sort((a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0))
        .map((p) => {
          const pid = String(p.id);
          return {
            id: pid,
            name: p.name,
            stages: [
              ...stages
                .filter((s) => String(s.pipeline_id) === pid)
                .sort((a, b) => (a.order_nr ?? 0) - (b.order_nr ?? 0))
                .map((s) => ({
                  id: String(s.id),
                  name: s.name,
                  probability: Math.max(0, Math.min(100, Math.round(s.deal_probability ?? 0))),
                  isWon: false,
                  isLost: false,
                })),
              { id: wonStageId(pid), name: 'Won', probability: 100, isWon: true, isLost: false },
              { id: lostStageId(pid), name: 'Lost', probability: 0, isWon: false, isLost: true },
            ],
          };
        });
    },

    // Pipedrive no da totales baratos: la vista previa muestra la muestra y el avance cuenta lo procesado.
    async count() {
      return null;
    },

    async page(phase, cursor, fields, limit = 100): Promise<SourcePage> {
      const start = Number(cursor ?? 0) || 0;
      const res = await list<Row>(ENDPOINT[phase], start, limit);
      const p = res.additional_data?.pagination;
      return {
        items: (res.data ?? []).map((row) => toRecord(phase, row, fields)),
        next: p?.more_items_in_collection && p.next_start !== undefined ? String(p.next_start) : null,
      };
    },
  };
}
