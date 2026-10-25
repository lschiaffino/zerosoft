/**
 * CRM — playbooks y guiones de llamada (puro: lo usan server y client).
 *
 * Un playbook es un texto en Markdown (el guion) más preguntas. Cada pregunta
 * puede guardar su respuesta en una propiedad del registro donde se usa
 * (`contact:jobTitle`, `deal:custom.budget`…): al guardar, la respuesta se
 * escribe en el contacto, la empresa o el deal y el uso queda en el timeline
 * como nota o como llamada registrada.
 */
import { z } from 'zod';
import { LEAD_STATUSES, LIFECYCLE_STAGES, PRIORITIES } from './crm-constants';

export const PLAYBOOK_ENTITIES = ['contact', 'company', 'deal'] as const;
export type PlaybookEntity = (typeof PLAYBOOK_ENTITIES)[number];

export const QUESTION_TYPES = ['text', 'longtext', 'number', 'select', 'date'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Propiedades estándar que una respuesta puede actualizar, por registro. */
export const PLAYBOOK_PROPERTIES: Record<PlaybookEntity, readonly string[]> = {
  contact: ['jobTitle', 'lifecycleStage', 'leadStatus', 'phone', 'city', 'country', 'website'],
  company: ['industry', 'employees', 'phone', 'city', 'country', 'website', 'lifecycleStage'],
  deal: ['amount', 'closeDate', 'priority', 'description'],
};

/** Propiedades con valores fijos: la pregunta es un select con esas opciones. */
export const ENUM_PROPERTIES: Record<string, readonly string[]> = {
  'contact:lifecycleStage': LIFECYCLE_STAGES,
  'contact:leadStatus': LEAD_STATUSES,
  'company:lifecycleStage': LIFECYCLE_STAGES,
  'deal:priority': PRIORITIES,
};

/** Tipo de input que pide cada propiedad estándar (las que no están: texto). */
export const PROPERTY_TYPES: Record<string, QuestionType> = {
  'company:employees': 'number',
  'deal:amount': 'number',
  'deal:closeDate': 'date',
  'deal:description': 'longtext',
};

/** Qué clase de valor guarda una propiedad, para ofrecerla solo a preguntas compatibles. */
export type PropertyKind = 'text' | 'longtext' | 'number' | 'date' | 'enum';

/** Clase de una propiedad estándar ('contact:jobTitle'…). */
export function standardKind(target: string): PropertyKind {
  if (ENUM_PROPERTIES[target]) return 'enum';
  const t = PROPERTY_TYPES[target];
  return t === 'number' || t === 'date' || t === 'longtext' ? t : 'text';
}

/** Clase de una propiedad propia según su tipo (null: ninguna pregunta la llena). */
export function customKind(type: string): PropertyKind | null {
  if (type === 'text' || type === 'url' || type === 'phone') return 'text';
  if (type === 'number' || type === 'currency') return 'number';
  if (type === 'date') return 'date';
  if (type === 'select') return 'enum';
  return null;
}

/** ¿Una pregunta de tipo `q` puede guardar su respuesta en una propiedad de esa clase? */
export function kindFits(kind: PropertyKind, q: QuestionType): boolean {
  switch (kind) {
    case 'text':
      return q === 'text' || q === 'longtext' || q === 'select';
    case 'longtext':
      return q === 'text' || q === 'longtext';
    case 'number':
      return q === 'number';
    case 'date':
      return q === 'date';
    case 'enum':
      return q === 'select';
  }
}

const CUSTOM_NAME = /^[A-Za-z0-9_-]{1,100}$/;

/** ¿`target` es una propiedad válida ('' = la respuesta solo queda en el timeline)? */
export function isPropertyTarget(target: string): boolean {
  if (target === '') return true;
  const m = /^(contact|company|deal):(.+)$/.exec(target);
  if (!m) return false;
  const entity = m[1] as PlaybookEntity;
  const key = m[2];
  if (key.startsWith('custom.')) return CUSTOM_NAME.test(key.slice(7));
  return PLAYBOOK_PROPERTIES[entity].includes(key);
}

export interface PlaybookQuestion {
  id: string;
  label: string;
  type: QuestionType;
  options: string[];
  /** '' = no actualiza nada; si no, 'entity:key' (custom: 'entity:custom.<name>'). */
  property: string;
}

export interface Playbook {
  id: string;
  name: string;
  body: string;
  questions: PlaybookQuestion[];
  entities: PlaybookEntity[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export const questionSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/),
  label: z.string().trim().min(1).max(300),
  type: z.enum(QUESTION_TYPES),
  options: z.array(z.string().trim().min(1).max(120)).max(30).default([]),
  property: z.string().trim().max(120).default('').refine(isPropertyTarget, { message: 'invalid_property' }),
});

export const playbookCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  body: z.string().max(20_000).optional(),
  questions: z.array(questionSchema).max(40).optional(),
  entities: z.array(z.enum(PLAYBOOK_ENTITIES)).min(1).max(3).optional(),
});
export const playbookUpdateSchema = playbookCreateSchema.partial();
export type PlaybookInput = z.infer<typeof playbookCreateSchema>;

export const playbookRunSchema = z.object({
  entity: z.enum(PLAYBOOK_ENTITIES),
  entityId: z.string().trim().min(1).max(100),
  answers: z.record(z.string().max(40), z.string().max(5000)).default({}),
  /** Cómo queda en el timeline: nota, o llamada registrada (con resultado). */
  logAs: z.enum(['note', 'call']).default('note'),
  call: z
    .object({
      outcome: z.string().trim().max(200).optional(),
      durationMin: z.number().int().min(0).max(1440).optional(),
      direction: z.enum(['inbound', 'outbound']).optional(),
      channel: z.enum(['', 'whatsapp']).optional(),
      note: z.string().max(5000).optional(),
    })
    .optional(),
});
export type PlaybookRunInput = z.infer<typeof playbookRunSchema>;

/** Preguntas válidas de un JSON guardado (tolera datos rotos). */
export function parseQuestions(json: string | null | undefined): PlaybookQuestion[] {
  try {
    const raw: unknown = JSON.parse(json || '[]');
    if (!Array.isArray(raw)) return [];
    const out: PlaybookQuestion[] = [];
    for (const q of raw) {
      const p = questionSchema.safeParse(q);
      if (p.success) out.push(p.data);
    }
    return out;
  } catch {
    return [];
  }
}

export function parseEntities(json: string | null | undefined): PlaybookEntity[] {
  try {
    const raw: unknown = JSON.parse(json || '[]');
    const list = Array.isArray(raw) ? raw.filter((e): e is PlaybookEntity => (PLAYBOOK_ENTITIES as readonly string[]).includes(e as string)) : [];
    return list.length ? [...new Set(list)] : [...PLAYBOOK_ENTITIES];
  } catch {
    return [...PLAYBOOK_ENTITIES];
  }
}

/**
 * Las preguntas cuyas respuestas se escriben en el registro donde se usa el
 * playbook: estándar ({ key: valor }) y custom ({ name: valor }). Lo vacío no
 * pisa nada. Los números inválidos se descartan.
 */
export function propertyPatch(
  questions: PlaybookQuestion[],
  answers: Record<string, string>,
  entity: PlaybookEntity,
): { standard: Record<string, string | number>; custom: Record<string, string> } {
  const standard: Record<string, string | number> = {};
  const custom: Record<string, string> = {};
  for (const q of questions) {
    if (!q.property.startsWith(`${entity}:`)) continue;
    const value = (answers[q.id] ?? '').trim();
    if (!value) continue;
    const key = q.property.slice(entity.length + 1);
    if (key.startsWith('custom.')) {
      custom[key.slice(7)] = value;
      continue;
    }
    const allowed = ENUM_PROPERTIES[q.property];
    if (allowed && !allowed.includes(value)) continue;
    if (PROPERTY_TYPES[q.property] === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) continue;
      standard[key] = n;
      continue;
    }
    if (PROPERTY_TYPES[q.property] === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) continue;
    standard[key] = value;
  }
  return { standard, custom };
}

/** Texto del uso para el timeline: una línea por pregunta respondida. */
export function answersText(questions: PlaybookQuestion[], answers: Record<string, string>): string {
  const lines: string[] = [];
  for (const q of questions) {
    const v = (answers[q.id] ?? '').trim();
    if (v) lines.push(`${q.label}\n${v}`);
  }
  return lines.join('\n\n');
}
