/**
 * Carpetas desde un JSON (asistente): leer lo que la persona pega o adjunta,
 * llevarlo a una forma única, buscar sus chats y armar el plan. Todo puro
 * (sin base): lo usa lib/assistant/tools-folders.ts, que lee lo que hay y
 * escribe recién cuando la persona confirma.
 *
 * Formas aceptadas (también anidadas entre sí):
 * - La exportación de inbox-zero (`format: "inbox-zero-export"`): el mismo
 *   esquema que importa Inbox (lib/inbox/import.ts, metaSchema).
 * - Árbol: [{ name, chats: [...], subfolders|children|folders: [...] }].
 * - Mapa: { "Clientes": { "VIP": ["Juan", ...] }, "Proveedores": [...] }.
 * - Lista plana con rutas: [{ folder|path: "Clientes/VIP", chats: [...] }]
 *   o { "Clientes/VIP": [...] }.
 * - Carpetas con id y padre: { folders: [{ id, name, parentId }], chats:
 *   [{ name, folderId | folder | folders }] }.
 * - Filas: [{ chat|name|phone, folder: "Clientes > VIP" }].
 * Un chat puede ser un nombre, un teléfono, un id de WhatsApp (JID) o un
 * email, suelto o como objeto { name, phone, jid, email }.
 */
import { metaSchema, EXPORT_FORMAT } from '../inbox/import';
import { foldText, normalizeWaJid, waPhoneOf } from '../inbox/types';

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface ChatRef {
  /** Cómo venía en el JSON (para mostrarlo en el plan). */
  label: string;
  name?: string;
  phone?: string;
  jid?: string;
  email?: string;
}

export interface FolderSpec {
  path: string[];
  chats: ChatRef[];
  color?: string;
}

export interface NormalizedFolders {
  /** inbox-zero, ids, árbol, mapa, rutas, filas (o varias). */
  shapes: string[];
  folders: FolderSpec[];
  /** Partes que no se entendieron (se cuentan en el plan, no se adivinan). */
  skipped: string[];
}

export type FoldersJsonErrorCode = 'invalid_json' | 'no_folders' | 'too_large' | 'no_json_found';

export class FoldersJsonError extends Error {
  constructor(
    public code: FoldersJsonErrorCode,
    public hint?: string,
  ) {
    super(code);
  }
}

export const FOLDERS_JSON_LIMITS = {
  /** Texto del JSON (5 MB). */
  bytes: 5 * 1024 * 1024,
  folders: 300,
  chats: 20_000,
  nameLength: 60,
} as const;

// ---------------------------------------------------------------------------
// Texto → JSON
// ---------------------------------------------------------------------------

/**
 * JSON de un texto pegado: sin las cercas de código (```json), con lo que
 * haya antes del primer { o [ (un "acá va:"), y tolerando comas finales y
 * comentarios // de una línea. null si no hay JSON.
 */
export function parseLooseJson(text: string): unknown {
  if (text.length > FOLDERS_JSON_LIMITS.bytes) throw new FoldersJsonError('too_large');
  let s = text.replace(/^﻿/, '').trim();
  const fence = /```(?:json|JSON|jsonc)?\s*\n([\s\S]*?)```/.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.search(/[[{]/);
  if (start < 0) return null;
  const open = s[start];
  const close = open === '{' ? '}' : ']';
  const end = s.lastIndexOf(close);
  if (end <= start) return null;
  const body = s.slice(start, end + 1);
  try {
    return JSON.parse(body);
  } catch {
    // Comas finales y comentarios de línea fuera de las comillas.
    const relaxed = stripComments(body).replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(relaxed);
    } catch {
      return null;
    }
  }
}

function stripComments(s: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += s[++i] ?? '';
      } else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

/** Minúsculas, sin tildes, sin emoji ni signos, espacios simples: para comparar nombres. */
export function foldName(s: string): string {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}@.+]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Clave de un nombre de carpeta: sin mayúsculas ni tildes y con espacios simples (la misma que usa upsertInboxFolders). */
export function folderKey(s: string): string {
  return foldText(String(s ?? '').trim().replace(/\s+/g, ' '));
}

/** Nombre de carpeta limpio (como lo guarda la app: espacios simples y hasta 60). */
export function cleanFolderName(s: string): string {
  return String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, FOLDERS_JSON_LIMITS.nameLength);
}

/** "Clientes/VIP", "Clientes > VIP", "Clientes › VIP" → ["Clientes", "VIP"]. */
export function splitPath(raw: string): string[] {
  return String(raw ?? '')
    .split(/\s*(?:\/|\\|>|›|»)\s*/)
    .map(cleanFolderName)
    .filter(Boolean);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Primer valor presente entre varias claves (sin distinguir mayúsculas ni _ o -). */
function pickKey(o: Record<string, unknown>, keys: readonly string[]): unknown {
  const want = new Set(keys.map((k) => k.toLowerCase().replace(/[_-]/g, '')));
  for (const [k, v] of Object.entries(o)) {
    if (want.has(k.toLowerCase().replace(/[_-]/g, '')) && v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

const NAME_KEYS = ['name', 'title', 'label', 'nombre', 'nome', 'displayName'] as const;
const FOLDER_NAME_KEYS = [...NAME_KEYS, 'folder', 'folderName', 'carpeta', 'pasta'] as const;
const PATH_KEYS = ['path', 'folderPath', 'fullPath', 'ruta', 'caminho'] as const;
const CHILD_KEYS = ['subfolders', 'children', 'folders', 'subcarpetas', 'subpastas', 'carpetas', 'pastas', 'items', 'nodes'] as const;
const CHATS_KEYS = ['chats', 'conversations', 'contacts', 'threads', 'members', 'contactos', 'contatos', 'conversaciones', 'conversas'] as const;
const CHAT_NAME_KEYS = ['name', 'chatName', 'title', 'displayName', 'pushname', 'contact', 'contactName', 'nombre', 'nome', 'subject'] as const;
const PHONE_KEYS = ['phone', 'phoneNumber', 'number', 'tel', 'telefono', 'teléfono', 'telefone', 'mobile', 'cel', 'celular', 'whatsapp', 'wa'] as const;
const JID_KEYS = ['jid', 'chatId', 'waId', 'whatsappId', 'remoteJid', 'wid', 'serialized', '_serialized'] as const;
const EMAIL_KEYS = ['email', 'mail', 'correo', 'e-mail'] as const;
const FOLDER_REF_KEYS = ['folder', 'folders', 'folderPath', 'path', 'carpeta', 'carpetas', 'pasta', 'pastas', 'folderId', 'folderIds', 'folder_id', 'parentFolder'] as const;
const PARENT_KEYS = ['parentId', 'parent', 'parent_id', 'parentFolderId', 'padre', 'pai'] as const;

const JID_RE = /^[^\s@]+@(s\.whatsapp\.net|c\.us|g\.us|lid|broadcast|newsletter)$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function digitsOf(s: string): string {
  return String(s ?? '').replace(/\D+/g, '');
}

function looksLikePhone(s: string): boolean {
  const t = s.trim();
  return /^[+\d\s().\-]+$/.test(t) && digitsOf(t).length >= 7 && digitsOf(t).length <= 16;
}

/** Un chat suelto (texto o número) → referencia. */
export function chatFromPrimitive(v: string | number): ChatRef | null {
  const s = String(v).trim().slice(0, 300);
  if (!s) return null;
  if (JID_RE.test(s)) {
    const jid = normalizeWaJid(s);
    const phone = waPhoneOf(jid);
    return { label: s, jid, ...(phone ? { phone } : {}) };
  }
  if (EMAIL_RE.test(s)) return { label: s, email: s.toLowerCase() };
  if (typeof v === 'number' || looksLikePhone(s)) return { label: s, phone: digitsOf(s) };
  return { label: s, name: s };
}

/** ¿Este objeto describe un chat (y no una carpeta)? */
function hasChatIdentity(o: Record<string, unknown>): boolean {
  if (pickKey(o, PHONE_KEYS) !== undefined || pickKey(o, JID_KEYS) !== undefined || pickKey(o, EMAIL_KEYS) !== undefined) return true;
  const id = pickKey(o, ['id']);
  return typeof id === 'string' && (JID_RE.test(id) || EMAIL_RE.test(id));
}

export function chatFromObject(o: Record<string, unknown>): ChatRef | null {
  const chatField = pickKey(o, ['chat']);
  if (typeof chatField === 'string' || typeof chatField === 'number') {
    const base = chatFromPrimitive(chatField);
    if (base) return mergeChat(base, chatFromObject(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'chat'))));
  }
  if (isObj(chatField)) return chatFromObject(chatField);
  const out: ChatRef = { label: '' };
  const name = pickKey(o, CHAT_NAME_KEYS);
  if (typeof name === 'string' && name.trim()) out.name = name.trim().slice(0, 300);
  const phone = pickKey(o, PHONE_KEYS);
  if ((typeof phone === 'string' || typeof phone === 'number') && digitsOf(String(phone)).length >= 7) out.phone = digitsOf(String(phone));
  let jid = pickKey(o, JID_KEYS);
  if (isObj(jid)) jid = pickKey(jid, ['_serialized', 'serialized']);
  const idField = pickKey(o, ['id']);
  if (jid === undefined && typeof idField === 'string' && JID_RE.test(idField)) jid = idField;
  if (typeof jid === 'string' && JID_RE.test(jid.trim())) {
    out.jid = normalizeWaJid(jid.trim());
    const p = waPhoneOf(out.jid);
    if (p && !out.phone) out.phone = p;
  } else if (typeof jid === 'string' && looksLikePhone(jid) && !out.phone) out.phone = digitsOf(jid);
  const email = pickKey(o, EMAIL_KEYS) ?? (typeof idField === 'string' && EMAIL_RE.test(idField) ? idField : undefined);
  if (typeof email === 'string' && EMAIL_RE.test(email.trim())) out.email = email.trim().toLowerCase();
  if (!out.name && !out.phone && !out.jid && !out.email) return null;
  out.label = out.name ?? out.jid ?? out.email ?? out.phone ?? '';
  if (out.name && (out.phone || out.email)) out.label = `${out.name} (${out.phone ? `+${out.phone}` : out.email})`;
  return out;
}

function mergeChat(a: ChatRef, b: ChatRef | null): ChatRef {
  if (!b) return a;
  return { label: a.label, name: a.name ?? b.name, phone: a.phone ?? b.phone, jid: a.jid ?? b.jid, email: a.email ?? b.email };
}

function chatOf(v: unknown): ChatRef | null {
  if (typeof v === 'string' || typeof v === 'number') return chatFromPrimitive(v);
  if (isObj(v)) return chatFromObject(v);
  return null;
}

function chatKey(c: ChatRef): string {
  return c.jid ? `j:${c.jid}` : c.phone ? `p:${c.phone}` : c.email ? `e:${c.email}` : `n:${foldName(c.name ?? c.label)}`;
}

// ---------------------------------------------------------------------------
// Normalización
// ---------------------------------------------------------------------------

class Builder {
  private map = new Map<string, FolderSpec>();
  private chatKeys = new Map<string, Set<string>>();
  shapes = new Set<string>();
  skipped: string[] = [];
  chatCount = 0;

  folder(path: string[], color?: string): FolderSpec | null {
    const clean = path.map(cleanFolderName).filter(Boolean);
    if (!clean.length) return null;
    // Las carpetas padre también existen (aunque el JSON no las liste solas).
    for (let i = 1; i < clean.length; i++) this.folder(clean.slice(0, i));
    const key = pathKey(clean);
    let f = this.map.get(key);
    if (!f) {
      if (this.map.size >= FOLDERS_JSON_LIMITS.folders) throw new FoldersJsonError('too_large', `More than ${FOLDERS_JSON_LIMITS.folders} folders.`);
      f = { path: clean, chats: [] };
      this.map.set(key, f);
      this.chatKeys.set(key, new Set());
    }
    if (color && /^#[0-9a-f]{6}$/i.test(color) && !f.color) f.color = color.toLowerCase();
    return f;
  }

  chat(path: string[], ref: ChatRef | null, raw?: unknown) {
    if (!ref) {
      if (raw !== undefined) this.skip(raw);
      return;
    }
    const f = this.folder(path);
    if (!f) {
      this.skip(raw ?? ref.label);
      return;
    }
    const key = pathKey(f.path);
    const seen = this.chatKeys.get(key)!;
    const k = chatKey(ref);
    if (seen.has(k)) return;
    if (++this.chatCount > FOLDERS_JSON_LIMITS.chats) throw new FoldersJsonError('too_large', `More than ${FOLDERS_JSON_LIMITS.chats} chats.`);
    seen.add(k);
    f.chats.push(ref);
  }

  skip(raw: unknown) {
    if (this.skipped.length >= 50) return;
    let s: string;
    try {
      s = typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch {
      s = String(raw);
    }
    this.skipped.push(String(s).slice(0, 80));
  }

  result(): NormalizedFolders {
    return { shapes: [...this.shapes], folders: [...this.map.values()], skipped: this.skipped };
  }
}

function folderNameOf(o: Record<string, unknown>): string[] | null {
  const path = pickKey(o, PATH_KEYS);
  if (typeof path === 'string' && splitPath(path).length) return splitPath(path);
  if (Array.isArray(path) && path.every((p) => typeof p === 'string')) return (path as string[]).map(cleanFolderName).filter(Boolean);
  const name = pickKey(o, FOLDER_NAME_KEYS);
  if (typeof name === 'string' && name.trim()) return splitPath(name).length > 1 ? splitPath(name) : [cleanFolderName(name)];
  return null;
}

/** Carpeta con nombre y, opcionalmente, chats y subcarpetas. */
function isFolderNode(o: Record<string, unknown>): boolean {
  const hasChats0 = CHATS_KEYS.some((k) => Array.isArray(pickKey(o, [k])));
  // { name, phone, folders: ["A", "B"] } es un chat con sus carpetas, no una carpeta.
  if (!hasChats0 && hasChatIdentity(o)) return false;
  const hasKids = CHILD_KEYS.some((k) => Array.isArray(pickKey(o, [k])) || isObj(pickKey(o, [k])));
  const hasChats = CHATS_KEYS.some((k) => Array.isArray(pickKey(o, [k])));
  if (hasKids || hasChats) return folderNameOf(o) !== null || pickKey(o, PATH_KEYS) !== undefined;
  return false;
}

/** Fila "chat → carpeta": un chat con la carpeta (o las carpetas) a la que va. */
function isAssignmentRow(o: Record<string, unknown>): boolean {
  if (CHATS_KEYS.some((k) => Array.isArray(pickKey(o, [k])))) return false;
  const ref = pickKey(o, ['folder', 'folders', 'folderPath', 'path', 'carpeta', 'carpetas', 'pasta', 'pastas', 'folderName']);
  if (ref === undefined) return false;
  const okRef = typeof ref === 'string' || (Array.isArray(ref) && ref.every((r) => typeof r === 'string' || Array.isArray(r)));
  if (!okRef) return false;
  return hasChatIdentity(o) || pickKey(o, ['chat', ...CHAT_NAME_KEYS]) !== undefined;
}

function walkNode(b: Builder, o: Record<string, unknown>, parent: string[]) {
  const own = folderNameOf(o) ?? [];
  const path = [...parent, ...own];
  const color = pickKey(o, ['color', 'colour']);
  b.folder(path, typeof color === 'string' ? color : undefined);
  for (const k of CHATS_KEYS) {
    const list = pickKey(o, [k]);
    if (Array.isArray(list)) for (const c of list) b.chat(path, chatOf(c), c);
  }
  for (const k of CHILD_KEYS) {
    const kids = pickKey(o, [k]);
    if (Array.isArray(kids) || isObj(kids)) walkValue(b, kids, path, 'tree');
  }
}

function walkValue(b: Builder, v: unknown, parent: string[], via: string) {
  if (Array.isArray(v)) {
    for (const item of v) {
      if (isObj(item)) {
        if (isFolderNode(item)) {
          b.shapes.add(via === 'map' ? 'map' : 'tree');
          walkNode(b, item, parent);
        } else if (isAssignmentRow(item)) {
          b.shapes.add('rows');
          assignRow(b, item, parent);
        } else if (hasChatIdentity(item) && parent.length) {
          b.chat(parent, chatFromObject(item), item);
        } else if (folderNameOf(item) && !hasChatIdentity(item) && !parent.length) {
          // Carpeta sola, sin chats: [{ name: "Clientes" }].
          b.shapes.add('tree');
          walkNode(b, item, parent);
        } else if (parent.length) {
          b.chat(parent, chatFromObject(item), item);
        } else b.skip(item);
      } else if ((typeof item === 'string' || typeof item === 'number') && parent.length) {
        b.chat(parent, chatFromPrimitive(item), item);
      } else if (typeof item === 'string' && !parent.length) {
        // ["Clientes", "Clientes/VIP"]: solo carpetas.
        b.shapes.add('paths');
        b.folder(splitPath(item));
      } else b.skip(item);
    }
    return;
  }
  if (!isObj(v)) {
    b.skip(v);
    return;
  }
  if (isFolderNode(v)) {
    b.shapes.add('tree');
    walkNode(b, v, parent);
    return;
  }
  // Mapa: cada clave es una carpeta (o una ruta "A/B").
  for (const [k, val] of Object.entries(v)) {
    const path = [...parent, ...splitPath(k)];
    if (!splitPath(k).length) continue;
    b.shapes.add(splitPath(k).length > 1 ? 'paths' : 'map');
    b.folder(path);
    if (Array.isArray(val) || isObj(val)) {
      if (isObj(val) && hasChatIdentity(val) && !isFolderNode(val)) b.chat(path, chatFromObject(val), val);
      else walkValue(b, val, path, 'map');
    } else if (typeof val === 'string') b.chat(path, chatFromPrimitive(val), val);
    else b.skip(val);
  }
}

function folderRefs(raw: unknown): string[][] {
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((r) => (Array.isArray(r) ? r.map((x) => cleanFolderName(String(x))).filter(Boolean) : splitPath(String(r ?? ''))))
    .filter((p) => p.length);
}

function assignRow(b: Builder, o: Record<string, unknown>, parent: string[]) {
  const ref = pickKey(o, ['folder', 'folders', 'folderPath', 'path', 'carpeta', 'carpetas', 'pasta', 'pastas', 'folderName']);
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !/^(folders?|folderpath|path|carpetas?|pastas?|foldername)$/i.test(k.replace(/[_-]/g, ''))));
  const chat = chatFromObject(rest);
  for (const p of folderRefs(ref)) b.chat([...parent, ...p], chat, o);
}

/** Carpetas con id y padre ({ folders: [{ id, name, parentId }] }) y chats que las nombran por id, nombre o ruta. */
function fromIdList(b: Builder, root: Record<string, unknown>): boolean {
  const folders = pickKey(root, ['folders', 'carpetas', 'pastas']);
  if (!Array.isArray(folders) || !folders.length) return false;
  const withIds = folders.filter(isObj).filter((f) => pickKey(f, ['id']) !== undefined && folderNameOf(f));
  if (withIds.length !== folders.length) return false;
  // Si alguna trae chats o hijos adentro, es un árbol (se camina como árbol).
  if (folders.some((f) => isObj(f) && isFolderNode(f))) return false;
  const byId = new Map<string, Record<string, unknown>>(withIds.map((f) => [String(pickKey(f, ['id'])), f]));
  const pathCache = new Map<string, string[]>();
  const pathOf = (id: string, seen = new Set<string>()): string[] => {
    const hit = pathCache.get(id);
    if (hit) return hit;
    const f = byId.get(id);
    if (!f) return [];
    const own = folderNameOf(f) ?? [];
    const parent = pickKey(f, PARENT_KEYS);
    const pid = parent === undefined ? null : String(parent);
    // Un ciclo (dato roto) corta en esta carpeta.
    const path = pid && byId.has(pid) && !seen.has(pid) ? [...pathOf(pid, new Set([...seen, id])), ...own] : own;
    pathCache.set(id, path);
    return path;
  };
  for (const id of byId.keys()) {
    const f = byId.get(id)!;
    const color = pickKey(f, ['color']);
    b.folder(pathOf(id), typeof color === 'string' ? color : undefined);
  }
  const resolve = (ref: unknown): string[] | null => {
    if (ref === undefined || ref === null || ref === '') return null;
    const key = String(ref);
    if (byId.has(key)) return pathOf(key);
    const p = splitPath(key);
    return p.length ? p : null;
  };
  // Asignaciones: chatFolders [{ chatId, folderId }] o chats con su carpeta.
  const names = new Map<string, string>();
  const chats = pickKey(root, ['chats', 'conversations', 'contacts', 'threads']);
  if (Array.isArray(chats)) {
    for (const c of chats) {
      if (!isObj(c)) continue;
      const cid = pickKey(c, [...JID_KEYS, 'id']);
      const n = pickKey(c, CHAT_NAME_KEYS);
      if (cid !== undefined && typeof n === 'string') names.set(String(cid), n);
      const ref = pickKey(c, FOLDER_REF_KEYS);
      if (ref === undefined) continue;
      const refs = Array.isArray(ref) ? ref : [ref];
      for (const r of refs) {
        const path = resolve(r);
        if (path) b.chat(path, chatFromObject(c), c);
        else b.skip(c);
      }
    }
  }
  const links = pickKey(root, ['chatFolders', 'assignments', 'chat_folders', 'memberships']);
  if (Array.isArray(links)) {
    for (const l of links) {
      if (!isObj(l)) continue;
      const path = resolve(pickKey(l, ['folderId', 'folder', 'folder_id']));
      const cid = pickKey(l, ['chatId', 'chat', 'chat_id', 'jid', 'threadId']);
      if (!path || cid === undefined) {
        b.skip(l);
        continue;
      }
      const base = chatFromPrimitive(String(cid));
      const name = names.get(String(cid));
      b.chat(path, base && name ? { ...base, name, label: name } : base, l);
    }
  }
  return true;
}

/** La exportación de inbox-zero, con el mismo esquema que el importador de Inbox. */
function fromInboxZero(b: Builder, root: Record<string, unknown>): boolean {
  if (root.format !== EXPORT_FORMAT) return false;
  const parsed = metaSchema.safeParse({ ...root, part: 'meta' });
  if (!parsed.success) return false;
  const meta = parsed.data;
  b.shapes.add('inbox-zero');
  const names = new Map(meta.chats.map((c) => [normalizeWaJid(c.chatId), c.name]));
  const byId = new Map(meta.folders.map((f) => [String(f.id), f]));
  const pathOf = (id: string, depth = 0): string[] => {
    const f = byId.get(id);
    if (!f) return [];
    const parent = f.parentId === null || f.parentId === undefined ? null : String(f.parentId);
    return parent && byId.has(parent) && depth < 8 ? [...pathOf(parent, depth + 1), f.name] : [f.name];
  };
  for (const f of [...meta.folders].sort((a, c) => a.position - c.position)) b.folder(pathOf(String(f.id)), f.color);
  for (const cf of meta.chatFolders) {
    const path = pathOf(String(cf.folderId));
    const base = chatFromPrimitive(cf.chatId);
    const name = names.get(normalizeWaJid(cf.chatId));
    b.chat(path, base && name ? { ...base, name, label: name } : base, cf);
  }
  return true;
}

const WRAPPER_KEYS = ['data', 'export', 'result', 'inbox', 'tree', 'structure', 'estructura', 'estrutura'];

/** Cualquier JSON razonable → carpetas (ruta) con sus chats. Sin carpetas: FoldersJsonError('no_folders'). */
export function normalizeFoldersJson(raw: unknown): NormalizedFolders {
  const b = new Builder();
  let root = raw;
  // Envoltorios: { "data": {...} } con una sola clave.
  for (let i = 0; i < 3 && isObj(root); i++) {
    const keys = Object.keys(root);
    if (keys.length === 1 && WRAPPER_KEYS.includes(keys[0].toLowerCase()) && (isObj(root[keys[0]]) || Array.isArray(root[keys[0]]))) root = root[keys[0]];
    else break;
  }
  if (isObj(root) && fromInboxZero(b, root)) return finish(b);
  if (isObj(root) && fromIdList(b, root)) {
    b.shapes.add('ids');
    return finish(b);
  }
  if (isObj(root)) {
    // { folders: [...] } o { carpetas: {...} }: el contenido es la lista.
    const inner = pickKey(root, ['folders', 'carpetas', 'pastas']);
    const keys = Object.keys(root);
    if ((Array.isArray(inner) || isObj(inner)) && keys.every((k) => /^(folders|carpetas|pastas|version|format|exported_?at|source|name|title)$/i.test(k))) {
      walkValue(b, inner, [], 'tree');
      return finish(b);
    }
  }
  if (Array.isArray(root) || isObj(root)) walkValue(b, root, [], 'root');
  return finish(b);
}

function finish(b: Builder): NormalizedFolders {
  const out = b.result();
  if (!out.folders.length) throw new FoldersJsonError('no_folders');
  // Ningún chat y cosas que no se entienden: probablemente no es un JSON de carpetas. Mejor preguntar.
  if (!b.chatCount && out.skipped.length) throw new FoldersJsonError('no_folders');
  return out;
}

// ---------------------------------------------------------------------------
// Buscar los chats
// ---------------------------------------------------------------------------

export interface ChatCandidate {
  id: string;
  name: string;
  phone?: string;
  jid?: string;
  email?: string;
  /** Carpetas donde ya está (Inbox: varias; Lines: una). */
  folderIds: string[];
}

export type MatchResult =
  | { status: 'matched'; id: string; by: 'jid' | 'phone' | 'email' | 'name' }
  | { status: 'ambiguous'; candidates: ChatCandidate[] }
  | { status: 'unmatched'; closest: ChatCandidate[] };

/**
 * Variantes de un teléfono para comparar: completo, los últimos 10 dígitos
 * (cubre +54 9 / 54 / 0 en Argentina y 52 1 en México) y, en Brasil, con y
 * sin el 9 que se agregó a los celulares (WhatsApp guarda los viejos sin él).
 */
export function phoneKeys(raw: string): string[] {
  let d = digitsOf(raw);
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length < 7) return [];
  const keys = new Set<string>([d]);
  if (d.length >= 10) keys.add(`~${d.slice(-10)}`);
  // Argentina: 54 9 11 xxxx xxxx (WhatsApp) = 54 11 xxxx xxxx = 54 11 15 xxxx xxxx.
  if (d.startsWith('54') && d.length >= 12) {
    const rest = d.startsWith('549') ? d.slice(3) : d.slice(2);
    keys.add(`~${rest.slice(-10)}`);
    const m15 = /^(\d{2,4})15(\d{6,8})$/.exec(rest);
    if (m15 && (m15[1] + m15[2]).length === 10) keys.add(`~${m15[1]}${m15[2]}`);
  }
  // Brasil: 55 DD 9XXXX XXXX ↔ 55 DD XXXX XXXX.
  if (d.startsWith('55') && d.length === 13 && d[4] === '9') keys.add(`~${(d.slice(0, 4) + d.slice(5)).slice(-10)}`);
  if (d.startsWith('55') && d.length === 12) keys.add(`~${(d.slice(0, 4) + '9' + d.slice(4)).slice(-10)}`);
  return [...keys];
}

export interface ChatIndex {
  all: ChatCandidate[];
  byJid: Map<string, ChatCandidate[]>;
  byPhone: Map<string, ChatCandidate[]>;
  byEmail: Map<string, ChatCandidate[]>;
  byName: Map<string, ChatCandidate[]>;
  byLoose: Map<string, ChatCandidate[]>;
}

function push<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const list = m.get(k);
  if (list) {
    if (!list.includes(v)) list.push(v);
  } else m.set(k, [v]);
}

/** Nombre sin espacios ni signos: "Juan  Pérez." ≈ "juanperez". */
const loose = (s: string) => foldName(s).replace(/[^\p{L}\p{N}]+/gu, '');

export function buildChatIndex(chats: ChatCandidate[]): ChatIndex {
  const idx: ChatIndex = { all: chats, byJid: new Map(), byPhone: new Map(), byEmail: new Map(), byName: new Map(), byLoose: new Map() };
  for (const c of chats) {
    if (c.jid) push(idx.byJid, normalizeWaJid(c.jid).toLowerCase(), c);
    const phone = c.phone || (c.jid ? waPhoneOf(normalizeWaJid(c.jid)) : '');
    if (phone) for (const k of phoneKeys(phone)) push(idx.byPhone, k, c);
    if (c.email) push(idx.byEmail, c.email.toLowerCase(), c);
    if (c.name) {
      push(idx.byName, foldName(c.name), c);
      if (loose(c.name)) push(idx.byLoose, loose(c.name), c);
    }
  }
  return idx;
}

function one(list: ChatCandidate[] | undefined): ChatCandidate[] {
  return list ? [...new Map(list.map((c) => [c.id, c])).values()] : [];
}

function bigrams(s: string): string[] {
  const t = ` ${s} `;
  const out: string[] = [];
  for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
  return out;
}

/** Parecido entre dos nombres (0 a 1): bigramas (Dice) y palabras en común. */
export function nameSimilarity(a: string, b: string): number {
  const x = foldName(a);
  const y = foldName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bx = bigrams(x);
  const by = bigrams(y);
  const pool = new Map<string, number>();
  for (const g of by) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hit = 0;
  for (const g of bx) {
    const n = pool.get(g) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(g, n - 1);
    }
  }
  const dice = (2 * hit) / (bx.length + by.length);
  const wx = new Set(x.split(' '));
  const wy = new Set(y.split(' '));
  const common = [...wx].filter((w) => wy.has(w) && w.length > 1).length;
  const words = common / Math.max(1, Math.min(wx.size, wy.size));
  return Math.max(dice, words * 0.9);
}

/** Los más parecidos por nombre (para "¿quisiste decir…?"). */
export function closestByName(name: string, idx: ChatIndex, limit = 3): ChatCandidate[] {
  if (!name) return [];
  return idx.all
    .map((c) => ({ c, s: nameSimilarity(name, c.name) }))
    .filter((r) => r.s >= 0.45)
    .sort((a, b) => b.s - a.s || a.c.name.localeCompare(b.c.name))
    .slice(0, limit)
    .map((r) => r.c);
}

/** Busca un chat del JSON entre los de la persona: JID, teléfono, email y por último el nombre. */
export function matchChat(ref: ChatRef, idx: ChatIndex): MatchResult {
  if (ref.jid) {
    const hit = one(idx.byJid.get(ref.jid.toLowerCase()));
    if (hit.length === 1) return { status: 'matched', id: hit[0].id, by: 'jid' };
    if (hit.length > 1) return { status: 'ambiguous', candidates: hit };
  }
  if (ref.phone) {
    const keys = phoneKeys(ref.phone);
    const exact = one(idx.byPhone.get(keys[0]));
    const hit = exact.length ? exact : one(keys.slice(1).flatMap((k) => idx.byPhone.get(k) ?? []));
    if (hit.length === 1) return { status: 'matched', id: hit[0].id, by: 'phone' };
    if (hit.length > 1) return { status: 'ambiguous', candidates: hit.slice(0, 5) };
    // Un número local corto (sin código de país): termina igual que uno solo.
    const d = digitsOf(ref.phone);
    if (d.length >= 7 && d.length < 10) {
      const tail = idx.all.filter((c) => {
        const p = c.phone || (c.jid ? waPhoneOf(normalizeWaJid(c.jid)) : '');
        return p && p.endsWith(d);
      });
      if (tail.length === 1) return { status: 'matched', id: tail[0].id, by: 'phone' };
      if (tail.length > 1) return { status: 'ambiguous', candidates: tail.slice(0, 5) };
    }
  }
  if (ref.email) {
    const hit = one(idx.byEmail.get(ref.email.toLowerCase()));
    if (hit.length === 1) return { status: 'matched', id: hit[0].id, by: 'email' };
    if (hit.length > 1) return { status: 'ambiguous', candidates: hit.slice(0, 5) };
  }
  const name = ref.name ?? (ref.jid || ref.phone || ref.email ? '' : ref.label);
  if (name) {
    const exact = one(idx.byName.get(foldName(name)));
    if (exact.length === 1) return { status: 'matched', id: exact[0].id, by: 'name' };
    if (exact.length > 1) return { status: 'ambiguous', candidates: exact.slice(0, 5) };
    const near = one(idx.byLoose.get(loose(name)));
    if (near.length === 1) return { status: 'matched', id: near[0].id, by: 'name' };
    if (near.length > 1) return { status: 'ambiguous', candidates: near.slice(0, 5) };
  }
  return { status: 'unmatched', closest: closestByName(name || ref.label, idx) };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export interface ExistingFolder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface FolderPlanRow {
  path: string[];
  /** Carpeta que ya existe con esa ruta (se reusa) o null (se crea). */
  existingId: string | null;
  color?: string;
  /** Chats a sumar (ids de la app). */
  add: string[];
  /** Chats que ya estaban en esta carpeta. */
  already: number;
  /** Más hondo de lo que deja la app: no se crea. */
  tooDeep?: boolean;
}

export interface PlanIssue {
  folder: string;
  chat: string;
  /** Nombres más parecidos o candidatos empatados. */
  candidates: string[];
  /** No encontrados: el chat del JSON y su carpeta (para sumarlo como chat nuevo). */
  ref?: ChatRef;
  path?: string[];
}

export interface FoldersPlan {
  target: 'inbox' | 'lines';
  folders: FolderPlanRow[];
  toCreate: number;
  reused: number;
  /** Asignaciones nuevas (sin contar las que ya estaban). */
  assign: number;
  alreadyAssigned: number;
  unmatched: PlanIssue[];
  ambiguous: PlanIssue[];
  /** Lines: el JSON pone un mismo chat en dos carpetas (un chat va en una sola). */
  conflicts: PlanIssue[];
  /** Chats que están en otra carpeta: se mueven solo si la persona lo pidió. */
  moves: Array<{ chatId: string; chat: string; from: string; to: string }>;
  /** Inbox con "sacar de las demás": cuántas asignaciones viejas se quitan. */
  removals: Array<{ chatId: string; folderId: string }>;
  /** Carpetas que no entran (límite de cantidad o de profundidad). */
  tooDeep: string[];
  overLimit: string[];
  removeFromOthers: boolean;
  skipped: string[];
  shapes: string[];
}

export function pathLabel(path: string[]): string {
  return path.join(' / ');
}

/** Ruta → id de las carpetas que ya existen (por nombre sin mayúsculas ni tildes dentro del mismo padre). */
export function existingPaths(existing: ExistingFolder[]): Map<string, string> {
  const byId = new Map(existing.map((f) => [f.id, f]));
  const out = new Map<string, string>();
  const keyOf = (f: ExistingFolder, seen = new Set<string>()): string | null => {
    if (seen.has(f.id)) return null;
    seen.add(f.id);
    const parent = f.parentId ? byId.get(f.parentId) : undefined;
    const pk = parent ? keyOf(parent, seen) : '';
    if (pk === null) return null;
    return pk ? `${pk}/${folderKey(f.name)}` : folderKey(f.name);
  };
  // Si hay dos con la misma ruta, se queda la primera (la de menor posición: vienen ordenadas).
  for (const f of existing) {
    const k = keyOf(f);
    if (k !== null && !out.has(k)) out.set(k, f.id);
  }
  return out;
}

export const pathKey = (path: string[]) => path.map(folderKey).join('/');

export function buildFoldersPlan(opts: {
  target: 'inbox' | 'lines';
  normalized: NormalizedFolders;
  existing: ExistingFolder[];
  chats: ChatCandidate[];
  removeFromOthers: boolean;
  /** Niveles debajo del primero (MAX_FOLDER_DEPTH). */
  maxDepth: number;
  /** Carpetas que todavía se pueden crear. */
  room: number;
}): FoldersPlan {
  const { normalized, target } = opts;
  const idx = buildChatIndex(opts.chats);
  const byId = new Map(opts.chats.map((c) => [c.id, c]));
  const known = existingPaths(opts.existing);
  const folderName = new Map(opts.existing.map((f) => [f.id, f.name]));
  const plan: FoldersPlan = {
    target,
    folders: [],
    toCreate: 0,
    reused: 0,
    assign: 0,
    alreadyAssigned: 0,
    unmatched: [],
    ambiguous: [],
    conflicts: [],
    moves: [],
    removals: [],
    tooDeep: [],
    overLimit: [],
    removeFromOthers: opts.removeFromOthers,
    skipped: normalized.skipped,
    shapes: normalized.shapes,
  };
  // Padres antes que hijos.
  const specs = [...normalized.folders].sort((a, b) => a.path.length - b.path.length);
  let room = opts.room;
  const rows = new Map<string, FolderPlanRow>();
  for (const spec of specs) {
    const key = pathKey(spec.path);
    const existingId = known.get(key) ?? null;
    const row: FolderPlanRow = { path: spec.path, existingId, add: [], already: 0, ...(spec.color ? { color: spec.color } : {}) };
    const parentRow = spec.path.length > 1 ? rows.get(pathKey(spec.path.slice(0, -1))) : undefined;
    if (spec.path.length - 1 > opts.maxDepth || parentRow?.tooDeep) {
      row.tooDeep = true;
      plan.tooDeep.push(pathLabel(spec.path));
    } else if (!existingId) {
      if (room <= 0 || (parentRow && !parentRow.existingId && plan.overLimit.includes(pathLabel(parentRow.path)))) {
        row.tooDeep = true;
        plan.overLimit.push(pathLabel(spec.path));
      } else {
        room--;
        plan.toCreate++;
      }
    } else plan.reused++;
    rows.set(key, row);
    plan.folders.push(row);
  }
  // Cada chat: dónde lo pone el JSON.
  const wanted = new Map<string, { rows: FolderPlanRow[]; label: string }>();
  for (const spec of specs) {
    const row = rows.get(pathKey(spec.path))!;
    for (const ref of spec.chats) {
      const m = matchChat(ref, idx);
      const where = pathLabel(spec.path);
      if (m.status === 'unmatched') {
        plan.unmatched.push({ folder: where, chat: ref.label, candidates: m.closest.map((c) => c.name).filter(Boolean), ref, path: spec.path });
        continue;
      }
      if (m.status === 'ambiguous') {
        plan.ambiguous.push({ folder: where, chat: ref.label, candidates: m.candidates.map((c) => c.name || '?') });
        continue;
      }
      if (row.tooDeep) continue;
      const w = wanted.get(m.id) ?? { rows: [], label: ref.label };
      if (!w.rows.includes(row)) w.rows.push(row);
      wanted.set(m.id, w);
    }
  }
  for (const [chatId, w] of wanted) {
    const chat = byId.get(chatId)!;
    if (target === 'lines' && w.rows.length > 1) {
      plan.conflicts.push({ folder: w.rows.map((r) => pathLabel(r.path)).join(', '), chat: chat.name || w.label, candidates: [] });
      continue;
    }
    const targetIds = new Set(w.rows.map((r) => r.existingId).filter(Boolean) as string[]);
    for (const row of w.rows) {
      if (row.existingId && chat.folderIds.includes(row.existingId)) {
        row.already++;
        plan.alreadyAssigned++;
        continue;
      }
      if (target === 'lines' && chat.folderIds.length) {
        // Lines: un chat va en una sola carpeta. Moverlo lo saca de la otra.
        const from = chat.folderIds[0];
        plan.moves.push({ chatId, chat: chat.name || w.label, from: folderName.get(from) ?? from, to: pathLabel(row.path) });
        if (!opts.removeFromOthers) continue;
      }
      row.add.push(chatId);
      plan.assign++;
    }
    if (target === 'inbox' && opts.removeFromOthers) {
      for (const fid of chat.folderIds) if (!targetIds.has(fid)) plan.removals.push({ chatId, folderId: fid });
    }
  }
  return plan;
}
