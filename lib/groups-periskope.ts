/**
 * Groups: traer lo de Periskope por CSV. Server-only salvo las funciones
 * puras de lectura (encabezados y filas), que prueban los tests.
 *
 * Lo que Periskope documenta (docs.periskope.app/features/export-data):
 * - Analytics › Data Exports baja CSV de chats, miembros, mensajes, notas,
 *   tickets, teléfonos y logs, sin publicar las columnas.
 * - El export en masa de la lista de chats (XLSX) nombra "Chat ID", "Chat
 *   Name", "Chat Type" y "Org Phone" "y otros detalles".
 * - Etiquetas y respuestas rápidas no tienen export documentado: se cargan
 *   desde una planilla propia (Nombre/Color y Comando/Mensaje, los campos
 *   que muestra su interfaz).
 *
 * Como las columnas no están publicadas, los encabezados se leen con alias
 * (mayúsculas, espacios y guiones no importan) y lo que no se reconoce se
 * informa. Los chats ya tienen que estar en Groups (se traen al conectar la
 * línea por QR): este import les pone encima etiquetas, asignado,
 * propiedades y nombre. Es una importación parcial: los mensajes vienen de
 * WhatsApp, no del CSV.
 */
import { getDb } from './db';
import { parseCsv } from './csv-parse';
import {
  GroupsError,
  LABEL_COLORS,
  createLabel,
  createQuickReply,
  listLabels,
  listPeople,
  listPropertyDefs,
  listQuickReplies,
  setChatLabels,
  updateChat,
  type ChatRow,
} from './groups';
import { recordAudit } from './groups-audit';
import { phoneDigits } from './groups-provider';

export const PERISKOPE_KINDS = ['chats', 'contacts', 'labels', 'quick_replies'] as const;
export type PeriskopeKind = (typeof PERISKOPE_KINDS)[number];

const MAX_ROWS = 5000;
const MAX_CHAT_ROWS = 1500;
/** Tope del archivo: lo que entra en un request (más grande, se divide en partes). */
export const MAX_CSV_BYTES = 4 * 1024 * 1024;

/** Encabezado normalizado: "Chat ID" → "chatid". */
export const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Columnas conocidas por tipo de archivo (alias en inglés y castellano). */
const ALIASES: Record<string, string[]> = {
  chatId: ['chatid', 'id', 'groupid', 'jid', 'chatjid'],
  chatName: ['chatname', 'name', 'groupname', 'contactname', 'nombre'],
  chatType: ['chattype', 'type', 'tipo'],
  orgPhone: ['orgphone', 'orgphonenumber', 'phonenumber', 'orgnumber', 'linea', 'line'],
  labels: ['labels', 'label', 'chatlabels', 'tags', 'etiquetas', 'contactlabels'],
  assignee: ['assignedto', 'assignee', 'assigned', 'owner', 'asignado'],
  phone: ['phone', 'contactphone', 'number', 'contactnumber', 'contactid', 'mobile', 'telefono'],
  labelName: ['name', 'label', 'labelname', 'nombre', 'etiqueta'],
  color: ['color', 'colour'],
  command: ['command', 'shortcut', 'comando', 'atajo', 'quickreply'],
  message: ['message', 'body', 'text', 'compose', 'mensaje', 'texto'],
};

/** Índice de cada columna conocida en el encabezado (el primer alias que aparece). */
export function mapHeader(header: string[], fields: string[]): { cols: Record<string, number>; extra: Array<{ index: number; name: string }> } {
  const norm = header.map(normHeader);
  const cols: Record<string, number> = {};
  const used = new Set<number>();
  for (const f of fields) {
    for (const alias of ALIASES[f] ?? []) {
      const i = norm.findIndex((h, idx) => h === alias && !used.has(idx));
      if (i >= 0) {
        cols[f] = i;
        used.add(i);
        break;
      }
    }
  }
  const extra = header.map((name, index) => ({ index, name: name.trim() })).filter((c) => !used.has(c.index) && c.name);
  return { cols, extra };
}

/** "VIP, Soporte; Ventas" → ['VIP', 'Soporte', 'Ventas']. */
export function splitList(v: string): string[] {
  return [...new Set(v.split(/[,;|]/).map((x) => x.trim()).filter(Boolean))].slice(0, 20);
}

/** Color de Periskope (nombre o hex) → uno de nuestros nombres de color. */
export function labelColorFrom(v: string): string {
  const s = v.trim().toLowerCase();
  if ((LABEL_COLORS as readonly string[]).includes(s)) return s;
  const m = /^#?([0-9a-f]{6})$/.exec(s);
  if (!m) return 'gray';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 30) return 'gray';
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) * 60;
  else if (max === g) h = (2 + (b - r) / (max - min)) * 60;
  else h = (4 + (r - g) / (max - min)) * 60;
  h = (h + 360) % 360;
  if (h < 15 || h >= 345) return 'red';
  if (h < 40) return 'orange';
  if (h < 65) return 'yellow';
  if (h < 160) return 'green';
  if (h < 195) return 'teal';
  if (h < 255) return 'blue';
  if (h < 300) return 'purple';
  return 'pink';
}

export interface ImportIssue {
  line: number;
  reason: string;
}

export interface PeriskopeResult {
  kind: PeriskopeKind;
  dryRun: boolean;
  rows: number;
  /** Filas aplicadas (o que se aplicarían en la vista previa). */
  applied: number;
  created: { labels: number; quickReplies: number };
  /** Columnas del archivo que no se usaron. */
  ignoredColumns: string[];
  issues: ImportIssue[];
}

const FIELDS: Record<PeriskopeKind, string[]> = {
  chats: ['chatId', 'chatName', 'chatType', 'orgPhone', 'labels', 'assignee'],
  contacts: ['phone', 'chatName', 'labels'],
  labels: ['labelName', 'color'],
  quick_replies: ['command', 'message'],
};

/** Columna obligatoria de cada tipo. */
const REQUIRED: Record<PeriskopeKind, string[]> = {
  chats: ['chatId'],
  contacts: ['phone'],
  labels: ['labelName'],
  quick_replies: ['command', 'message'],
};

/**
 * Importa un CSV exportado de Periskope (o armado con sus columnas).
 * `dryRun`: no escribe, devuelve lo que haría (para la vista previa).
 */
export async function importPeriskope(ws: string, actor: string, kind: PeriskopeKind, csv: string, opts: { dryRun?: boolean } = {}): Promise<PeriskopeResult> {
  const dryRun = opts.dryRun === true;
  if (Buffer.byteLength(csv) > MAX_CSV_BYTES) throw new GroupsError('file_too_large', 413);
  const rows = parseCsv(csv).filter((r) => r.some((c) => c.trim()));
  const result: PeriskopeResult = { kind, dryRun, rows: 0, applied: 0, created: { labels: 0, quickReplies: 0 }, ignoredColumns: [], issues: [] };
  if (rows.length === 0) {
    result.issues.push({ line: 1, reason: 'empty_file' });
    return result;
  }
  const [header, ...body] = rows;
  const { cols, extra } = mapHeader(header, FIELDS[kind]);
  const missing = REQUIRED[kind].filter((f) => cols[f] === undefined);
  if (missing.length) {
    result.issues.push({ line: 1, reason: `missing_column:${missing.join(',')}` });
    return result;
  }
  // Chats y contactos tocan varias tablas por fila: menos filas por archivo para que termine dentro del request.
  const maxRows = kind === 'chats' || kind === 'contacts' ? MAX_CHAT_ROWS : MAX_ROWS;
  const data = body.slice(0, maxRows);
  result.rows = data.length;
  if (body.length > maxRows) result.issues.push({ line: maxRows + 2, reason: `too_many_rows:${maxRows}` });
  const cell = (r: string[], f: string) => (cols[f] === undefined ? '' : (r[cols[f]] ?? '').trim());

  // ---------- Etiquetas ----------
  const labels = new Map((await listLabels(ws)).map((l) => [l.name.toLowerCase(), l.id]));
  const ensureLabel = async (name: string, color = 'gray'): Promise<string | null> => {
    const key = name.trim().slice(0, 40).toLowerCase();
    if (!key) return null;
    const hit = labels.get(key);
    if (hit) return hit;
    result.created.labels++;
    if (dryRun) {
      labels.set(key, `new:${key}`);
      return `new:${key}`;
    }
    const l = await createLabel(ws, { name: name.trim(), color }).catch(() => null);
    if (!l) return null;
    labels.set(key, l.id);
    return l.id;
  };

  if (kind === 'labels') {
    for (const [i, r] of data.entries()) {
      const name = cell(r, 'labelName');
      if (!name) {
        result.issues.push({ line: i + 2, reason: 'empty_name' });
        continue;
      }
      if (labels.has(name.slice(0, 40).toLowerCase())) {
        result.issues.push({ line: i + 2, reason: 'exists' });
        continue;
      }
      if (await ensureLabel(name, labelColorFrom(cell(r, 'color')))) result.applied++;
    }
    return finish(ws, actor, result, extra.map((e) => e.name));
  }

  if (kind === 'quick_replies') {
    const existing = new Set((await listQuickReplies(ws)).map((q) => q.shortcut));
    for (const [i, r] of data.entries()) {
      const shortcut = cell(r, 'command').replace(/^\//, '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
      const body = cell(r, 'message');
      if (!shortcut || !body) {
        result.issues.push({ line: i + 2, reason: !shortcut ? 'invalid_shortcut' : 'empty_message' });
        continue;
      }
      if (existing.has(shortcut)) {
        result.issues.push({ line: i + 2, reason: 'exists' });
        continue;
      }
      existing.add(shortcut);
      if (!dryRun) await createQuickReply(ws, { shortcut, body });
      result.created.quickReplies++;
      result.applied++;
    }
    return finish(ws, actor, result, extra.map((e) => e.name));
  }

  // ---------- Chats y contactos: sobre los chats que ya están en Groups ----------
  const db = getDb();
  const numbers = (await db.prepare('SELECT id, phone FROM groups_numbers WHERE user_id = ?').all(ws)) as Array<{ id: string; phone: string }>;
  const people = await listPeople(ws);
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p.id]));
  const byName = new Map(people.filter((p) => p.name).map((p) => [p.name.toLowerCase(), p.id]));
  // Propiedades propias: una columna con el nombre o la clave de la propiedad.
  const defs = await listPropertyDefs(ws);
  const propCols = kind === 'chats' ? extra.flatMap((e) => {
    const d = defs.find((x) => normHeader(x.label) === normHeader(e.name) || normHeader(x.key) === normHeader(e.name));
    return d ? [{ index: e.index, key: d.key, type: d.type }] : [];
  }) : [];
  const usedExtra = new Set(propCols.map((p) => p.index));

  for (const [i, r] of data.entries()) {
    const line = i + 2;
    let chats: ChatRow[] = [];
    if (kind === 'chats') {
      const rawId = cell(r, 'chatId');
      const orgPhone = phoneDigits(cell(r, 'orgPhone'));
      const number = orgPhone ? numbers.find((n) => n.phone && phoneDigits(n.phone) === orgPhone) : undefined;
      if (orgPhone && !number) {
        result.issues.push({ line, reason: 'unknown_line' });
        continue;
      }
      const isGroup = /@g\.us$/.test(rawId) || /group/i.test(cell(r, 'chatType'));
      const phone = isGroup ? '' : phoneDigits(rawId.replace(/@.*$/, ''));
      // Un 1:1 sin teléfono no se cruza con nada (nunca con los chats sin teléfono).
      if (!isGroup && phone.length < 6) {
        result.issues.push({ line, reason: 'invalid_phone' });
        continue;
      }
      if (isGroup && !/^[0-9-]+@g\.us$/.test(rawId)) {
        result.issues.push({ line, reason: 'chat_not_found' });
        continue;
      }
      chats = (await db
        .prepare(
          `SELECT * FROM groups_chats WHERE user_id = ? AND ${isGroup ? 'provider_chat_id = ?' : "kind = 'dm' AND (phone = ? OR provider_chat_id = ?)"}${number ? ' AND number_id = ?' : ''}`,
        )
        .all(ws, ...(isGroup ? [rawId] : [phone, rawId]), ...(number ? [number.id] : []))) as ChatRow[];
    } else {
      const phone = phoneDigits(cell(r, 'phone').replace(/@.*$/, ''));
      if (phone.length < 6) {
        result.issues.push({ line, reason: 'invalid_phone' });
        continue;
      }
      chats = (await db.prepare("SELECT * FROM groups_chats WHERE user_id = ? AND kind = 'dm' AND phone = ?").all(ws, phone)) as ChatRow[];
    }
    if (chats.length === 0) {
      result.issues.push({ line, reason: 'chat_not_found' });
      continue;
    }
    // Asignado: email o nombre de alguien del workspace.
    const who = cell(r, 'assignee');
    const assignee = who ? (byEmail.get(who.toLowerCase()) ?? byName.get(who.toLowerCase()) ?? null) : null;
    if (who && !assignee) result.issues.push({ line, reason: 'unknown_assignee' });
    const labelIds: string[] = [];
    for (const name of splitList(cell(r, 'labels'))) {
      const id = await ensureLabel(name);
      if (id) labelIds.push(id);
    }
    const props: Record<string, unknown> = {};
    for (const p of propCols) {
      const v = (r[p.index] ?? '').trim();
      if (!v) continue;
      props[p.key] = p.type === 'multiselect' ? splitList(v) : p.type === 'number' ? Number(v) : p.type === 'checkbox' ? /^(true|yes|si|sí|1|x)$/i.test(v) : v;
    }
    const name = cell(r, 'chatName');
    result.applied++;
    if (dryRun) continue;
    for (const chat of chats) {
      if (labelIds.length) {
        const current = ((await db.prepare('SELECT label_id FROM groups_chat_labels WHERE chat_id = ?').all(chat.id)) as Array<{ label_id: string }>).map((x) => x.label_id);
        await setChatLabels(ws, chat.id, [...new Set([...current, ...labelIds])]);
      }
      const patch: Parameters<typeof updateChat>[2] = {};
      if (Object.keys(props).length) patch.properties = { ...(JSON.parse(chat.properties || '{}') as Record<string, unknown>), ...props };
      if (assignee && !chat.assigned_to) patch.assignedTo = assignee;
      try {
        if (Object.keys(patch).length) await updateChat(ws, chat.id, patch, actor);
      } catch {
        result.issues.push({ line, reason: 'not_applied' });
      }
      // El nombre solo si no tenía (no se pisa lo que vino de WhatsApp).
      if (name && !chat.name) await db.prepare("UPDATE groups_chats SET name = ? WHERE id = ? AND name = ''").run(name.slice(0, 200), chat.id);
    }
  }
  return finish(ws, actor, result, extra.filter((e) => !usedExtra.has(e.index)).map((e) => e.name));
}

async function finish(ws: string, actor: string, result: PeriskopeResult, ignored: string[]): Promise<PeriskopeResult> {
  result.ignoredColumns = ignored.slice(0, 50);
  result.issues = result.issues.slice(0, 200);
  if (!result.dryRun && result.applied > 0) {
    await recordAudit(ws, {
      chatId: null,
      chatName: 'Periskope',
      actorId: actor,
      action: 'imported',
      detail: { source: 'periskope', kind: result.kind, applied: result.applied, labels: result.created.labels, quickReplies: result.created.quickReplies },
    });
  }
  return result;
}
