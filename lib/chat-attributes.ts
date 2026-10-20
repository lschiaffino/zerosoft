/**
 * Chat — atributos de conversación. Cada widget define sus atributos
 * (chat_widgets.conversation_attributes, JSON ChatAttributeDef[]) y cada
 * conversación guarda sus valores (chat_conversations.attributes, JSON
 * id → valor). Un atributo obligatorio sin valor bloquea resolver la
 * conversación: lo chequean el PATCH, la acción en lote y las macros.
 * Este archivo es puro (lo usa también el inbox en el navegador); la
 * lectura y escritura en la base está en lib/chat-attributes-db.ts.
 */
export const CHAT_ATTRIBUTE_TYPES = ['text', 'number', 'select', 'boolean'] as const;
export type ChatAttributeType = (typeof CHAT_ATTRIBUTE_TYPES)[number];

export interface ChatAttributeDef {
  id: string;
  name: string;
  type: ChatAttributeType;
  required: boolean;
  /** Opciones de un 'select' (vacío en los otros tipos). */
  options: string[];
}

export type ChatAttributeValue = string | number | boolean;
export type ChatAttributeValues = Record<string, ChatAttributeValue>;

/** Topes: atributos por widget, opciones por select y largo de un texto. */
export const CHAT_ATTRIBUTES_MAX = 20;
export const CHAT_ATTRIBUTE_OPTIONS_MAX = 30;
export const CHAT_ATTRIBUTE_TEXT_MAX = 500;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Definiciones guardadas en el widget; lo inválido se descarta. */
export function parseAttributeDefs(raw: string | null | undefined): ChatAttributeDef[] {
  if (!raw) return [];
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: ChatAttributeDef[] = [];
  for (const item of list) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id || seen.has(item.id)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    const type = CHAT_ATTRIBUTE_TYPES.includes(item.type as ChatAttributeType) ? (item.type as ChatAttributeType) : 'text';
    const options =
      type === 'select' && Array.isArray(item.options)
        ? [...new Set(item.options.filter((o): o is string => typeof o === 'string').map((o) => o.trim()).filter(Boolean))].slice(
            0,
            CHAT_ATTRIBUTE_OPTIONS_MAX,
          )
        : [];
    // Un select sin opciones no se puede completar: queda como texto.
    seen.add(item.id);
    out.push({ id: item.id, name, type: type === 'select' && options.length === 0 ? 'text' : type, required: item.required === true, options });
    if (out.length >= CHAT_ATTRIBUTES_MAX) break;
  }
  return out;
}

/** Valores guardados en la conversación (solo string, number finito o boolean). */
export function parseAttributeValues(raw: string | null | undefined): ChatAttributeValues {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!isRecord(v)) return {};
    const out: ChatAttributeValues = {};
    for (const [k, val] of Object.entries(v)) {
      if (typeof val === 'string' || typeof val === 'boolean' || (typeof val === 'number' && Number.isFinite(val))) out[k] = val;
    }
    return out;
  } catch {
    return {};
  }
}

/** true si el valor completa el atributo (un boolean cuenta con sí o no). */
export function isAttributeFilled(def: ChatAttributeDef, value: ChatAttributeValue | undefined): boolean {
  if (value === undefined) return false;
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'select':
      return typeof value === 'string' && def.options.includes(value);
    default:
      return typeof value === 'string' && value.trim().length > 0;
  }
}

/** Atributos obligatorios que faltan completar. */
export function missingRequiredAttributes(defs: ChatAttributeDef[], values: ChatAttributeValues): ChatAttributeDef[] {
  return defs.filter((d) => d.required && !isAttributeFilled(d, values[d.id]));
}

export type AttributePatchResult =
  | { ok: true; values: ChatAttributeValues }
  | { ok: false; error: 'unknown_attribute' | 'invalid_attribute'; attributeId: string };

/**
 * Aplica un cambio (id → valor; null o '' borra) sobre los valores actuales.
 * Solo ids definidos en el widget y valores del tipo del atributo. Los
 * valores de atributos que el widget ya no define se descartan al guardar.
 */
export function applyAttributePatch(
  defs: ChatAttributeDef[],
  current: ChatAttributeValues,
  patch: Record<string, unknown>,
): AttributePatchResult {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const next: ChatAttributeValues = {};
  for (const d of defs) if (current[d.id] !== undefined) next[d.id] = current[d.id];
  for (const [id, raw] of Object.entries(patch)) {
    const def = byId.get(id);
    if (!def) return { ok: false, error: 'unknown_attribute', attributeId: id };
    if (raw === null || raw === '') {
      delete next[id];
      continue;
    }
    let value: ChatAttributeValue | null = null;
    if (def.type === 'boolean' && typeof raw === 'boolean') value = raw;
    else if (def.type === 'number') {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
      if (Number.isFinite(n)) value = n;
    } else if (def.type === 'select' && typeof raw === 'string' && def.options.includes(raw)) value = raw;
    else if (def.type === 'text' && typeof raw === 'string') {
      const text = raw.trim();
      if (text.length <= CHAT_ATTRIBUTE_TEXT_MAX) value = text;
    }
    if (value === null) return { ok: false, error: 'invalid_attribute', attributeId: id };
    if (value === '') delete next[id];
    else next[id] = value;
  }
  return { ok: true, values: next };
}
