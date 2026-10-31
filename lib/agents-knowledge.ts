/**
 * Agents — conocimiento propio del agente, además de Docs y las URLs:
 * - archivos (PDF, DOCX, TXT, Markdown, CSV): se guarda el texto extraído;
 * - pares de pregunta y respuesta, con variantes y carga por CSV;
 * - sitemaps: cada página que listan entra como URL de conocimiento;
 * - preguntas sin respuesta (corridas que no encontraron nada o derivaron),
 *   para convertirlas en un par de pregunta y respuesta.
 * Archivos y pares no pasan por el borrador (como las URLs y los secretos):
 * se usan apenas se cargan. Server-only.
 */
import { getDb } from './db';
import { agentConversationVisibleSql } from './chat-audience';
import type { AgentRow } from './db';
import { extractDocsText } from './chat-data';
import { parseCsv } from './csv-parse';
import { readTextCapped, safeFetch, UnsafeUrlError } from './safe-fetch';
import { AGENT_SITEMAP_MAX_PAGES } from './agents-config';
import { searchTokens } from './knowledge-search';

export const AGENT_MAX_FILES = 25;
export const AGENT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const FILE_MAX_CHARS = 200_000;
export const AGENT_MAX_QA = 500;
export const AGENT_QA_MAX_VARIANTS = 10;

export const AGENT_FILE_KINDS = ['pdf', 'docx', 'txt', 'md', 'csv'] as const;
export type AgentFileKind = (typeof AGENT_FILE_KINDS)[number];

function nowIso(): string {
  return new Date().toISOString();
}

export class KnowledgeError extends Error {
  constructor(public code: string, public status = 400) {
    super(code);
  }
}

// ---------- Archivos ----------

export interface AgentKnowledgeFileDto {
  id: string;
  name: string;
  kind: AgentFileKind;
  size: number;
  chars: number;
  createdAt: string;
}

export function fileKind(name: string): AgentFileKind | null {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'markdown') return 'md';
  return (AGENT_FILE_KINDS as readonly string[]).includes(ext) ? (ext as AgentFileKind) : null;
}

/** CSV → una línea por fila con "columna: valor" (el modelo entiende de qué es cada dato). */
export function csvToKnowledgeText(text: string): string {
  const rows = parseCsv(text);
  if (rows.length === 0) return '';
  const [head, ...body] = rows;
  if (body.length === 0) return head.join(', ');
  return body
    .map((r) =>
      head
        .map((h, i) => (r[i]?.trim() ? `${h.trim() || `col${i + 1}`}: ${r[i].trim()}` : ''))
        .filter(Boolean)
        .join('; '),
    )
    .filter(Boolean)
    .join('\n');
}

/** Texto de un archivo subido. Tira KnowledgeError con un código para la UI. */
export async function extractFileText(name: string, bytes: Uint8Array): Promise<{ kind: AgentFileKind; text: string }> {
  const kind = fileKind(name);
  if (!kind) throw new KnowledgeError('unsupported_file');
  if (bytes.byteLength > AGENT_FILE_MAX_BYTES) throw new KnowledgeError('file_too_large', 413);
  let text = '';
  if (kind === 'pdf') {
    const { pdfToText, PdfTextError } = await import('./pdf-text');
    try {
      text = pdfToText(bytes);
    } catch (err) {
      if (err instanceof PdfTextError) throw new KnowledgeError(err.code);
      throw new KnowledgeError('invalid_pdf');
    }
  } else if (kind === 'docx') {
    const { docxToBlocks, DocxImportError } = await import('./docs-docx');
    try {
      text = extractDocsText(JSON.stringify(docxToBlocks(bytes)), FILE_MAX_CHARS);
    } catch (err) {
      if (err instanceof DocxImportError) throw new KnowledgeError('invalid_docx');
      throw new KnowledgeError('invalid_docx');
    }
  } else {
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    text = kind === 'csv' ? csvToKnowledgeText(raw) : raw;
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, FILE_MAX_CHARS);
  if (!text) throw new KnowledgeError('empty_file');
  return { kind, text };
}

export async function listKnowledgeFiles(agentId: string): Promise<AgentKnowledgeFileDto[]> {
  const rows = (await getDb()
    .prepare('SELECT id, name, kind, size, length(content) AS chars, created_at FROM agent_knowledge_files WHERE agent_id = ? ORDER BY created_at, rowid')
    .all(agentId)) as Array<{ id: string; name: string; kind: AgentFileKind; size: number; chars: number; created_at: string }>;
  return rows.map((r) => ({ id: r.id, name: r.name, kind: r.kind, size: Number(r.size), chars: Number(r.chars), createdAt: r.created_at }));
}

export async function addKnowledgeFile(
  agent: Pick<AgentRow, 'id' | 'user_id'>,
  file: { name: string; bytes: Uint8Array },
  createdBy: string | null,
): Promise<AgentKnowledgeFileDto> {
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM agent_knowledge_files WHERE agent_id = ?').get(agent.id)) as { c: number };
  if (Number(count.c) >= AGENT_MAX_FILES) throw new KnowledgeError('too_many_files');
  const name = file.name.replace(/[\\/]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 200) || 'file';
  const { kind, text } = await extractFileText(name, file.bytes);
  const id = crypto.randomUUID();
  const ts = nowIso();
  await db
    .prepare('INSERT INTO agent_knowledge_files (id, agent_id, user_id, name, kind, size, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, agent.id, agent.user_id, name, kind, file.bytes.byteLength, text, createdBy, ts);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(agent.user_id, agent.id, createdBy, 'file_added', { name });
  return { id, name, kind, size: file.bytes.byteLength, chars: text.length, createdAt: ts };
}

export async function deleteKnowledgeFile(workspaceId: string, agentId: string, fileId: string, personId: string | null): Promise<boolean> {
  const db = getDb();
  const row = (await db.prepare('SELECT name FROM agent_knowledge_files WHERE id = ? AND agent_id = ? AND user_id = ?').get(fileId, agentId, workspaceId)) as
    | { name: string }
    | undefined;
  if (!row) return false;
  await db.prepare('DELETE FROM agent_knowledge_files WHERE id = ?').run(fileId);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(workspaceId, agentId, personId, 'file_removed', { name: row.name });
  return true;
}

// ---------- Pares de pregunta y respuesta ----------

export interface AgentQaDto {
  id: string;
  question: string;
  variants: string[];
  answer: string;
  createdAt: string;
  updatedAt: string;
}

export interface QaInput {
  question: string;
  variants?: string[];
  answer: string;
}

function cleanQa(input: QaInput): QaInput {
  const question = input.question.replace(/\s+/g, ' ').trim().slice(0, 500);
  const answer = input.answer.trim().slice(0, 4000);
  const seen = new Set([question.toLowerCase()]);
  const variants: string[] = [];
  for (const v of input.variants ?? []) {
    const clean = v.replace(/\s+/g, ' ').trim().slice(0, 500);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    variants.push(clean);
    if (variants.length >= AGENT_QA_MAX_VARIANTS) break;
  }
  return { question, answer, variants };
}

function toQaDto(r: { id: string; question: string; variants: string; answer: string; created_at: string; updated_at: string }): AgentQaDto {
  let variants: string[] = [];
  try {
    const v = JSON.parse(r.variants) as unknown;
    if (Array.isArray(v)) variants = v.filter((x): x is string => typeof x === 'string');
  } catch {
    variants = [];
  }
  return { id: r.id, question: r.question, variants, answer: r.answer, createdAt: r.created_at, updatedAt: r.updated_at };
}

export async function listQa(agentId: string): Promise<AgentQaDto[]> {
  const rows = (await getDb()
    .prepare('SELECT * FROM agent_qa WHERE agent_id = ? ORDER BY created_at, rowid')
    .all(agentId)) as Array<{ id: string; question: string; variants: string; answer: string; created_at: string; updated_at: string }>;
  return rows.map(toQaDto);
}

export async function createQa(agent: Pick<AgentRow, 'id' | 'user_id'>, input: QaInput, createdBy: string | null): Promise<AgentQaDto> {
  const db = getDb();
  const count = (await db.prepare('SELECT COUNT(*) AS c FROM agent_qa WHERE agent_id = ?').get(agent.id)) as { c: number };
  if (Number(count.c) >= AGENT_MAX_QA) throw new KnowledgeError('too_many_qa');
  const qa = cleanQa(input);
  if (!qa.question || !qa.answer) throw new KnowledgeError('invalid_input');
  const id = crypto.randomUUID();
  const ts = nowIso();
  await db
    .prepare('INSERT INTO agent_qa (id, agent_id, user_id, question, variants, answer, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, agent.id, agent.user_id, qa.question, JSON.stringify(qa.variants), qa.answer, createdBy, ts, ts);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(agent.user_id, agent.id, createdBy, 'qa_changed', { action: 'add', question: qa.question.slice(0, 120) });
  return { id, question: qa.question, variants: qa.variants ?? [], answer: qa.answer, createdAt: ts, updatedAt: ts };
}

export async function updateQa(workspaceId: string, agentId: string, id: string, input: QaInput, personId: string | null): Promise<AgentQaDto | null> {
  const qa = cleanQa(input);
  if (!qa.question || !qa.answer) throw new KnowledgeError('invalid_input');
  const ts = nowIso();
  const res = await getDb()
    .prepare('UPDATE agent_qa SET question = ?, variants = ?, answer = ?, updated_at = ? WHERE id = ? AND agent_id = ? AND user_id = ?')
    .run(qa.question, JSON.stringify(qa.variants), qa.answer, ts, id, agentId, workspaceId);
  if (!res.changes) return null;
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(workspaceId, agentId, personId, 'qa_changed', { action: 'edit', question: qa.question.slice(0, 120) });
  const row = (await getDb().prepare('SELECT * FROM agent_qa WHERE id = ?').get(id)) as Parameters<typeof toQaDto>[0];
  return toQaDto(row);
}

export async function deleteQa(workspaceId: string, agentId: string, id: string, personId: string | null): Promise<boolean> {
  const db = getDb();
  const row = (await db.prepare('SELECT question FROM agent_qa WHERE id = ? AND agent_id = ? AND user_id = ?').get(id, agentId, workspaceId)) as
    | { question: string }
    | undefined;
  if (!row) return false;
  await db.prepare('DELETE FROM agent_qa WHERE id = ?').run(id);
  const { recordAgentChange } = await import('./agents');
  await recordAgentChange(workspaceId, agentId, personId, 'qa_changed', { action: 'remove', question: row.question.slice(0, 120) });
  return true;
}

const Q_HEADERS = ['question', 'pregunta', 'pergunta', 'q'];
const A_HEADERS = ['answer', 'respuesta', 'resposta', 'a'];
const V_HEADERS = ['variants', 'variantes', 'variations', 'alternatives', 'alternativas'];

/**
 * CSV de pares: columnas question/answer (o pregunta/respuesta, pergunta/
 * resposta) y opcional variants (separadas por "|" o ";"). Sin encabezado: la
 * primera columna es la pregunta, la segunda la respuesta y el resto variantes.
 */
export function parseQaCsv(text: string): QaInput[] {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const qi = head.findIndex((h) => Q_HEADERS.includes(h));
  const ai = head.findIndex((h) => A_HEADERS.includes(h));
  const hasHeader = qi >= 0 && ai >= 0;
  const vi = hasHeader ? head.findIndex((h) => V_HEADERS.includes(h)) : -1;
  const body = hasHeader ? rows.slice(1) : rows;
  const out: QaInput[] = [];
  for (const r of body) {
    const question = (hasHeader ? r[qi] : r[0])?.trim() ?? '';
    const answer = (hasHeader ? r[ai] : r[1])?.trim() ?? '';
    if (!question || !answer) continue;
    const variants = hasHeader
      ? vi >= 0
        ? (r[vi] ?? '').split(/[|;]/)
        : []
      : r.slice(2).flatMap((c) => c.split(/[|;]/));
    out.push({ question, answer, variants: variants.map((v) => v.trim()).filter(Boolean) });
  }
  return out;
}

/** Carga por CSV: agrega los pares nuevos (no repite preguntas que ya están). */
export async function importQaCsv(
  agent: Pick<AgentRow, 'id' | 'user_id'>,
  text: string,
  createdBy: string | null,
): Promise<{ added: number; skipped: number }> {
  const parsed = parseQaCsv(text);
  if (parsed.length === 0) throw new KnowledgeError('empty_file');
  const existing = new Set((await listQa(agent.id)).map((q) => q.question.toLowerCase()));
  let added = 0;
  let skipped = 0;
  for (const qa of parsed) {
    if (existing.has(qa.question.trim().toLowerCase())) {
      skipped++;
      continue;
    }
    try {
      await createQa(agent, qa, createdBy);
      existing.add(qa.question.trim().toLowerCase());
      added++;
    } catch (err) {
      if (err instanceof KnowledgeError && err.code === 'too_many_qa') {
        skipped += parsed.length - added - skipped;
        break;
      }
      skipped++;
    }
  }
  return { added, skipped };
}

// ---------- Sitemaps ----------

const SITEMAP_MAX_BYTES = 5_000_000;

const XML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };

/**
 * URLs de un sitemap (o de un índice de sitemaps). Lineal: recorre los <loc>
 * con indexOf (nada de regex con retroceso sobre 5 MB de XML ajeno), con tope
 * de entradas. Exportada para tests.
 */
export function parseSitemap(xml: string, max = 50_000): { urls: string[]; sitemaps: string[] } {
  const head = xml.slice(0, 4096).toLowerCase();
  const isIndex = head.includes('<sitemapindex');
  const locs: string[] = [];
  let pos = 0;
  while (locs.length < max) {
    const open = xml.indexOf('<loc', pos);
    if (open < 0) break;
    const gt = xml.indexOf('>', open + 4);
    if (gt < 0) break;
    // <loc> o <loc …>; otra etiqueta que empieza igual (<location>) se saltea.
    const next = xml.charCodeAt(open + 4);
    if (next !== 62 /* > */ && next !== 32 && next !== 9 && next !== 10 && next !== 13) {
      pos = open + 4;
      continue;
    }
    const close = xml.indexOf('</loc>', gt + 1);
    if (close < 0) break;
    const raw = xml.slice(gt + 1, Math.min(close, gt + 1 + 4000)).trim();
    if (raw) locs.push(raw.replace(/&(amp|lt|gt|quot|apos);/g, (m) => XML_ENTITIES[m] ?? m));
    pos = close + 6;
  }
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs, sitemaps: [] };
}

async function fetchText(url: string): Promise<{ text: string; type: string } | null> {
  try {
    const res = await safeFetch(url, { headers: { 'user-agent': 'Zerosoft-Agents/1', accept: 'application/xml,text/xml,text/html' } }, 10_000, { maxRedirects: 3 });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return null;
    }
    // Tope leyendo en streaming (un sitemap de varios GB no se descarga entero).
    return { text: await readTextCapped(res, SITEMAP_MAX_BYTES), type: res.headers.get('content-type') ?? '' };
  } catch (err) {
    if (err instanceof UnsafeUrlError) return null;
    return null;
  }
}

/**
 * Páginas de un sitemap, del mismo host y con el path que empieza con
 * `prefix`. Si la URL no es un sitemap (la raíz del sitio), prueba
 * /sitemap.xml. Sigue un nivel de índice (hasta 10 sitemaps hijos).
 */
export async function expandSitemap(rawUrl: string, prefix = '', max = AGENT_SITEMAP_MAX_PAGES): Promise<{ ok: true; urls: string[] } | { ok: false; error: string }> {
  let base: URL;
  try {
    base = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  let first = await fetchText(base.toString());
  if (!first || !/<(urlset|sitemapindex)\b/i.test(first.text)) {
    const fallback = new URL('/sitemap.xml', base.origin).toString();
    first = fallback === base.toString() ? null : await fetchText(fallback);
  }
  if (!first || !/<(urlset|sitemapindex)\b/i.test(first.text)) return { ok: false, error: 'sitemap_not_found' };
  const out = new Set<string>();
  const cleanPrefix = prefix.trim() ? (prefix.trim().startsWith('/') ? prefix.trim() : `/${prefix.trim()}`) : '';
  const add = (list: string[]) => {
    for (const u of list) {
      if (out.size >= max) return;
      try {
        const url = new URL(u);
        if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
        if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
        if (cleanPrefix && !url.pathname.startsWith(cleanPrefix)) continue;
        url.hash = '';
        out.add(url.toString());
      } catch {
        /* URL inválida en el sitemap */
      }
    }
  };
  const parsed = parseSitemap(first.text);
  add(parsed.urls);
  for (const child of parsed.sitemaps.slice(0, 10)) {
    if (out.size >= max) break;
    const res = await fetchText(child);
    if (res) add(parseSitemap(res.text).urls);
  }
  if (out.size === 0) return { ok: false, error: 'sitemap_empty' };
  return { ok: true, urls: [...out] };
}

/**
 * Encola los sitemaps de la configuración (agent_sitemaps): los que ya no
 * están se borran con sus páginas; los nuevos o con otro filtro quedan
 * pendientes y los lee el cron de cada minuto (processPendingSitemaps). Así
 * guardar no espera a bajar un sitemap ajeno.
 */
export async function syncSitemaps(workspaceId: string, agentId: string, sitemaps: Array<{ url: string; prefix: string }>, opts: { force?: boolean } = {}): Promise<void> {
  const db = getDb();
  const wanted = new Map(sitemaps.map((s) => [s.url, s]));
  const current = (await db.prepare('SELECT url, prefix FROM agent_sitemaps WHERE agent_id = ?').all(agentId)) as Array<{ url: string; prefix: string }>;
  for (const c of current) {
    if (wanted.has(c.url)) continue;
    await db.prepare('DELETE FROM agent_sitemaps WHERE agent_id = ? AND url = ?').run(agentId, c.url);
    await db.prepare('DELETE FROM agent_knowledge_urls WHERE agent_id = ? AND origin = ?').run(agentId, c.url);
  }
  for (const sm of sitemaps) {
    const prev = current.find((c) => c.url === sm.url);
    if (prev && prev.prefix === sm.prefix && !opts.force) continue;
    await db
      .prepare(
        `INSERT INTO agent_sitemaps (agent_id, user_id, url, prefix, status, error, pages, listed_at, claimed_until, created_at)
         VALUES (?, ?, ?, ?, 'pending', NULL, 0, NULL, NULL, ?)
         ON CONFLICT (agent_id, url) DO UPDATE SET prefix = excluded.prefix, status = 'pending', error = NULL, claimed_until = NULL`,
      )
      .run(agentId, workspaceId, sm.url, sm.prefix, nowIso());
  }
}

type SitemapJob = { agent_id: string; user_id: string; url: string; prefix: string };

/** ¿Sigue siendo nuestro el claim y es el mismo filtro? (si guardaron otro prefijo, se vuelve a listar). */
async function stillOurs(job: SitemapJob, token: string): Promise<boolean> {
  const row = await getDb()
    .prepare('SELECT 1 AS x FROM agent_sitemaps WHERE agent_id = ? AND url = ? AND claimed_until = ? AND prefix = ?')
    .get(job.agent_id, job.url, token, job.prefix);
  return Boolean(row);
}

/**
 * Lista un sitemap y deja sus páginas pendientes de descarga. Cada escritura
 * exige que el claim (`token`) y el prefijo sigan iguales: si alguien cambió
 * el filtro mientras se listaba, la fila quedó pendiente y se vuelve a listar.
 * El claim no se limpia al terminar: con status 'ok' y listed_at fresco ningún
 * otro cron la vuelve a tomar.
 */
async function listSitemap(job: SitemapJob, token: string): Promise<void> {
  const db = getDb();
  const res = await expandSitemap(job.url, job.prefix);
  if (!res.ok) {
    await db
      .prepare("UPDATE agent_sitemaps SET status = 'error', error = ?, listed_at = ? WHERE agent_id = ? AND url = ? AND claimed_until = ? AND prefix = ?")
      .run(res.error, nowIso(), job.agent_id, job.url, token, job.prefix);
    return;
  }
  if (!(await stillOurs(job, token))) return;
  const existing = (await db.prepare('SELECT id, url FROM agent_knowledge_urls WHERE agent_id = ? AND origin = ?').all(job.agent_id, job.url)) as Array<{ id: string; url: string }>;
  const keep = new Set(res.urls);
  for (const r of existing) if (!keep.has(r.url)) await db.prepare('DELETE FROM agent_knowledge_urls WHERE id = ?').run(r.id);
  const have = new Set(existing.map((r) => r.url));
  for (const url of res.urls) {
    if (have.has(url)) continue;
    await db
      .prepare("INSERT OR IGNORE INTO agent_knowledge_urls (id, agent_id, user_id, url, status, origin, created_at) VALUES (?, ?, ?, ?, 'pending', ?, ?)")
      .run(crypto.randomUUID(), job.agent_id, job.user_id, url, job.url, nowIso());
  }
  await db
    .prepare("UPDATE agent_sitemaps SET status = 'ok', error = NULL, pages = ?, listed_at = ? WHERE agent_id = ? AND url = ? AND claimed_until = ? AND prefix = ?")
    .run(res.urls.length, nowIso(), job.agent_id, job.url, token, job.prefix);
}

/**
 * Cron de cada minuto: lee los sitemaps pendientes (y los listados hace más
 * de un día, para sumar páginas nuevas). Claim por fila (compare-and-set con
 * las mismas condiciones del SELECT): dos corridas a la vez no listan dos veces.
 */
export async function processPendingSitemaps(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const stale = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const due = `(status = 'pending' OR listed_at IS NULL OR listed_at < ?) AND (claimed_until IS NULL OR claimed_until < ?)`;
  const rows = (await db
    .prepare(`SELECT agent_id, user_id, url, prefix FROM agent_sitemaps WHERE ${due} ORDER BY COALESCE(listed_at, '') ASC LIMIT ?`)
    .all(stale, now.toISOString(), Math.min(Math.max(opts.limit ?? 3, 1), 20))) as SitemapJob[];
  let done = 0;
  for (const r of rows) {
    const token = `${new Date(now.getTime() + 5 * 60_000).toISOString()}|${crypto.randomUUID().slice(0, 8)}`;
    const claimed = await db
      .prepare(`UPDATE agent_sitemaps SET claimed_until = ? WHERE agent_id = ? AND url = ? AND prefix = ? AND ${due}`)
      .run(token, r.agent_id, r.url, r.prefix, stale, now.toISOString());
    if (!claimed.changes) continue;
    await listSitemap(r, token).catch(async () => {
      await db
        .prepare("UPDATE agent_sitemaps SET status = 'error', error = 'sitemap_not_found', listed_at = ? WHERE agent_id = ? AND url = ? AND claimed_until = ?")
        .run(nowIso(), r.agent_id, r.url, token);
    });
    done++;
  }
  return done;
}

export interface AgentSitemapStatusDto {
  url: string;
  status: 'pending' | 'ok' | 'error';
  error: string | null;
  pages: number;
  fetched: number;
  failed: number;
}

/** Estado de cada sitemap: pendiente de leer, con error, o páginas leídas de las listadas. */
export async function sitemapStatus(agentId: string): Promise<AgentSitemapStatusDto[]> {
  const rows = (await getDb()
    .prepare(
      `SELECT s.url, s.status, s.error,
         (SELECT COUNT(*) FROM agent_knowledge_urls k WHERE k.agent_id = s.agent_id AND k.origin = s.url) AS pages,
         (SELECT COUNT(*) FROM agent_knowledge_urls k WHERE k.agent_id = s.agent_id AND k.origin = s.url AND k.status = 'ok') AS fetched,
         (SELECT COUNT(*) FROM agent_knowledge_urls k WHERE k.agent_id = s.agent_id AND k.origin = s.url AND k.status = 'error') AS failed
       FROM agent_sitemaps s WHERE s.agent_id = ?`,
    )
    .all(agentId)) as Array<{ url: string; status: 'pending' | 'ok' | 'error'; error: string | null; pages: number; fetched: number; failed: number }>;
  return rows.map((r) => ({ url: r.url, status: r.status, error: r.error, pages: Number(r.pages), fetched: Number(r.fetched ?? 0), failed: Number(r.failed ?? 0) }));
}

// ---------- Preguntas sin respuesta ----------

export interface AgentSuggestionDto {
  /** Pregunta representativa (la más reciente del grupo). */
  question: string;
  count: number;
  lastAt: string;
  conversationId: string;
  /** Corridas del grupo (para descartarlas). */
  runIds: string[];
}

function suggestionKey(q: string): string {
  return [...new Set(searchTokens(q))].sort().slice(0, 6).join(' ');
}

/**
 * Preguntas de los últimos `days` días que el agente no pudo responder con su
 * conocimiento (la búsqueda no encontró nada o derivó por no saber), agrupadas
 * por palabras clave. Sin el playground ni las descartadas.
 */
export async function listSuggestions(workspaceId: string, agentId: string, days = 30, now = new Date(), viewerId?: string): Promise<AgentSuggestionDto[]> {
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  const visible = viewerId ? agentConversationVisibleSql('conversation_id', viewerId) : null;
  const rows = (await getDb()
    .prepare(
      `SELECT id, conversation_id, question, created_at FROM agent_runs
       WHERE user_id = ? AND agent_id = ? AND unanswered = 1 AND suggestion_dismissed = 0 AND channel != 'playground'
         AND question IS NOT NULL AND question != '' AND created_at >= ?${visible ? ` AND ${visible.sql}` : ''}
       ORDER BY created_at DESC LIMIT 1000`,
    )
    .all(workspaceId, agentId, from, ...(visible?.args ?? []))) as Array<{ id: string; conversation_id: string; question: string; created_at: string }>;
  const groups = new Map<string, AgentSuggestionDto>();
  for (const r of rows) {
    const key = suggestionKey(r.question) || r.question.toLowerCase();
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.runIds.push(r.id);
    } else {
      groups.set(key, { question: r.question, count: 1, lastAt: r.created_at, conversationId: r.conversation_id, runIds: [r.id] });
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 30);
}

export async function dismissSuggestions(workspaceId: string, agentId: string, runIds: string[]): Promise<number> {
  const ids = runIds.slice(0, 500);
  if (ids.length === 0) return 0;
  const res = await getDb()
    .prepare(`UPDATE agent_runs SET suggestion_dismissed = 1 WHERE user_id = ? AND agent_id = ? AND id IN (${ids.map(() => '?').join(', ')})`)
    .run(workspaceId, agentId, ...ids);
  return res.changes;
}

// ---------- Para la búsqueda ----------

/** Archivos y pares del agente como documentos de conocimiento. */
export async function ownKnowledgeDocs(agentId: string, workspaceId: string): Promise<Array<{ kind: 'file' | 'qa'; title: string; text: string; chunk?: boolean }>> {
  const db = getDb();
  const files = (await db
    .prepare('SELECT name, content FROM agent_knowledge_files WHERE agent_id = ? AND user_id = ?')
    .all(agentId, workspaceId)) as Array<{ name: string; content: string }>;
  const qas = await listQa(agentId);
  return [
    ...files.map((f) => ({ kind: 'file' as const, title: f.name, text: f.content })),
    ...qas.map((q) => ({
      kind: 'qa' as const,
      title: q.question,
      text: [q.question, ...q.variants, '', q.answer].join('\n'),
      chunk: false,
    })),
  ];
}
