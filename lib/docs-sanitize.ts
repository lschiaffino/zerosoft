import sanitizeHtml from 'sanitize-html';
import type { DbAction, DbAutomation, DbFile, DbProperty, DbRow, DbValue, DbViewConfig, DocsBlock, DocsDatabase } from './docs-types';
import { isPageLinkId, pageLinkHref } from './docs-page-links';
import { DB_MAX_BODY_BLOCKS, isComputedType, isOptionType, isTextType, normalizeDatabase } from './docs-database';
import { cleanFileName, isDocsUploadUrl, sanitizeFileFields } from './docs-files';

/**
 * Sanitización de Docs en el servidor. El editor ya sanitiza en el navegador
 * (lib/docs-richtext.ts), pero la API acepta cualquier JSON: sin esto se podía
 * guardar HTML arbitrario que luego se renderiza con innerHTML (XSS almacenado).
 * Mismo subset que el editor: strong/em/u/s/code y links http(s)/mailto/tel/relativos.
 * Links a página (`[[`): <a data-page="<id>">; el href se rehace desde el id
 * (lib/docs-page-links.ts), así que nunca queda otro destino que /app/docs/<id>.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'code', 'a', 'br'],
  allowedAttributes: { a: ['href', 'target', 'rel', 'data-page', 'data-row'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    a: (tagName, attribs): sanitizeHtml.Tag => {
      const page = attribs['data-page'];
      if (isPageLinkId(page)) {
        // Link a una fila de una base: data-row con el id de la fila.
        const row = attribs['data-row'];
        if (isPageLinkId(row)) return { tagName, attribs: { href: pageLinkHref(page, row), 'data-page': page, 'data-row': row } };
        return { tagName, attribs: { href: pageLinkHref(page), 'data-page': page } };
      }
      return { tagName, attribs: { href: attribs.href ?? '', target: '_blank', rel: 'noopener noreferrer' } };
    },
  },
};

export function sanitizeDocsHtml(html: string): string {
  if (!html || !/[<&]/.test(html)) return html;
  return sanitizeHtml(html, OPTIONS);
}

function plainCell(cell: unknown): string {
  return String(cell ?? '').replace(/<[^>]*>?/g, '').slice(0, 5000);
}

/** Id de pizarra aceptable en un bloque board (UUID o id corto, sin otros caracteres). */
const BOARD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function sanitizeBoardField(block: DocsBlock): DocsBlock {
  const { board_id, ...rest } = block;
  if (block.type !== 'board' || typeof board_id !== 'string' || !BOARD_ID_RE.test(board_id)) return rest;
  return { ...rest, board_id };
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Valor de una celda según el tipo de su propiedad; undefined = se descarta. */
function sanitizeDbValue(prop: DbProperty, v: DbValue): DbValue | undefined {
  if (prop.type === 'unique_id') return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
  if (isComputedType(prop.type)) return undefined;
  if (prop.type === 'relation') {
    // El espejo de una relación de dos vías no guarda valores (se calcula del otro lado).
    if (prop.relation?.mirror_of || !Array.isArray(v)) return undefined;
    const ids = [...new Set(v.filter((id) => ID_RE.test(id)))];
    return prop.relation?.limit === 1 ? ids.slice(-1) : ids.slice(0, 100);
  }
  if (prop.type === 'files') return undefined;
  if (isTextType(prop.type)) return typeof v === 'string' ? plainCell(v) : undefined;
  switch (prop.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
    case 'checkbox':
      return typeof v === 'boolean' ? v : undefined;
    case 'date':
      return typeof v === 'string' && DAY_RE.test(v) ? v : undefined;
    case 'select':
    case 'status':
      return typeof v === 'string' && prop.options?.some((o) => o.id === v) ? v : undefined;
    case 'multi_select':
      return Array.isArray(v) ? [...new Set(v.filter((id) => prop.options?.some((o) => o.id === id)))] : undefined;
    case 'person':
      return Array.isArray(v) ? [...new Set(v.filter((id) => ID_RE.test(id)))].slice(0, 50) : undefined;
    default:
      return undefined;
  }
}

function isoOr(v: unknown, fallback: string): string {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : fallback;
}

/**
 * Base de un bloque database: textos planos, valores que coinciden con el
 * tipo de su propiedad (opciones que existen, fechas YYYY-MM-DD), vistas que
 * solo nombran propiedades que existen y cuerpos de fila saneados como
 * bloques (sin bases adentro).
 */
export function sanitizeDatabase(db: DocsDatabase): DocsDatabase {
  const now = new Date().toISOString();
  const fixed = normalizeDatabase({ id: 'db', type: 'database', content: '', db });
  const seen = new Set<string>();
  const properties = fixed.properties
    .filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)))
    .map((p) => {
      const out: DbProperty = { id: p.id, name: plainCell(p.name).slice(0, 500), type: p.type };
      if (isOptionType(p.type)) {
        out.options = (p.options ?? []).map((o) => ({
          id: o.id,
          name: plainCell(o.name).slice(0, 500),
          ...(p.type === 'status' ? { group: o.group ?? 'todo' } : {}),
        }));
      }
      sanitizePropertyConfig(p, out);
      return out;
    });
  const byId = new Map(properties.map((p) => [p.id, p]));
  const rows = fixed.rows.map((r) => {
    const values: Record<string, DbValue> = {};
    for (const [key, v] of Object.entries(r.values ?? {})) {
      const prop = byId.get(key);
      if (!prop) continue;
      const clean = sanitizeDbValue(prop, v);
      if (clean !== undefined) values[key] = clean;
    }
    const body = r.body?.length
      ? sanitizeBlocks(r.body.filter((b) => b.type !== 'database').slice(0, DB_MAX_BODY_BLOCKS))
      : undefined;
    const files = sanitizeRowFiles(r.files, byId);
    const out: DbRow = {
      id: r.id,
      values,
      ...(body ? { body } : {}),
      ...(files ? { files } : {}),
      created_at: isoOr(r.created_at, now),
      updated_at: isoOr(r.updated_at, now),
    };
    if (r.created_by && ID_RE.test(r.created_by)) out.created_by = r.created_by;
    if (r.updated_by && ID_RE.test(r.updated_by)) out.updated_by = r.updated_by;
    return out;
  });
  repairUniqueIds(properties, rows);
  const views = fixed.views.map((v) => sanitizeView(v, byId));
  const active = views.some((v) => v.id === fixed.active_view) ? fixed.active_view : views[0]?.id;
  return {
    properties,
    rows,
    views,
    ...(active ? { active_view: active } : {}),
    ...(fixed.title ? { title: plainCell(fixed.title).slice(0, 500) } : {}),
    ...(fixed.automations?.length ? { automations: sanitizeAutomations(fixed.automations, byId, views) } : {}),
  };
}

/** Configuración de los tipos nuevos (fórmula, relación, rollup, ID único, botón, IA). */
function sanitizePropertyConfig(p: DbProperty, out: DbProperty): void {
  if (p.type === 'formula') out.formula = String(p.formula ?? '').slice(0, 4000);
  if (p.type === 'relation' && p.relation && ID_RE.test(p.relation.page_id) && ID_RE.test(p.relation.block_id)) {
    out.relation = {
      page_id: p.relation.page_id,
      block_id: p.relation.block_id,
      ...(p.relation.limit === 1 ? { limit: 1 as const } : {}),
      ...(p.relation.synced_prop && ID_RE.test(p.relation.synced_prop) ? { synced_prop: p.relation.synced_prop } : {}),
      ...(p.relation.mirror_of && ID_RE.test(p.relation.mirror_of) ? { mirror_of: p.relation.mirror_of } : {}),
    };
  }
  if (p.type === 'rollup' && p.rollup && ID_RE.test(p.rollup.relation) && ID_RE.test(p.rollup.property)) {
    out.rollup = { relation: p.rollup.relation, property: p.rollup.property, fn: p.rollup.fn };
  }
  if (p.type === 'unique_id') {
    const prefix = plainCell(p.prefix ?? '').replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 20);
    if (prefix) out.prefix = prefix;
    if (typeof p.next_id === 'number' && p.next_id >= 1) out.next_id = Math.floor(p.next_id);
  }
  if (p.type === 'button') {
    out.button = { label: plainCell(p.button?.label ?? p.name).slice(0, 200), actions: sanitizeActions(p.button?.actions ?? []) };
  }
  if (p.ai && (p.type === 'text' || p.type === 'select' || p.type === 'multi_select')) {
    out.ai = {
      mode: p.ai.mode,
      ...(p.ai.prompt ? { prompt: plainCell(p.ai.prompt).slice(0, 2000) } : {}),
      ...(p.ai.language ? { language: plainCell(p.ai.language).slice(0, 40) } : {}),
      ...(p.ai.auto ? { auto: true } : {}),
    };
  }
}

/** Vista: solo propiedades que existen (con `byId` null, de una vista vinculada: no se pueden chequear). */
function sanitizeView(v: DbViewConfig, byId: Map<string, DbProperty> | null): DbViewConfig {
  const has = (id: string | null | undefined): id is string => Boolean(id) && (!byId || byId.has(id!));
  const out: DbViewConfig = {
    ...v,
    name: plainCell(v.name).slice(0, 500),
    filters: v.filters?.filter((f) => has(f.property)),
    sorts: v.sorts?.filter((x) => has(x.property)),
    group_by: has(v.group_by) ? v.group_by : null,
    hidden: v.hidden?.filter((h) => has(h)),
    widths: v.widths ? Object.fromEntries(Object.entries(v.widths).filter(([k]) => has(k))) : undefined,
  };
  for (const k of ['sub_group_by', 'date_by', 'end_by'] as const) {
    if (v[k] !== undefined) out[k] = has(v[k]) ? v[k] : null;
  }
  return out;
}

const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/;

function sanitizeRowFiles(files: Record<string, DbFile[]> | undefined, byId: Map<string, DbProperty>): Record<string, DbFile[]> | undefined {
  if (!files || typeof files !== 'object') return undefined;
  const out: Record<string, DbFile[]> = {};
  for (const [propId, list] of Object.entries(files)) {
    if (byId.get(propId)?.type !== 'files' || !Array.isArray(list)) continue;
    const clean = list
      .filter((f) => f && ID_RE.test(f.id) && isDocsUploadUrl(f.url))
      .slice(0, 20)
      .map((f) => {
        const file: DbFile = { id: f.id, url: f.url, name: cleanFileName(f.name) || 'file' };
        if (typeof f.size === 'number' && Number.isFinite(f.size) && f.size >= 0) file.size = Math.round(f.size);
        if (typeof f.mime === 'string' && MIME_RE.test(f.mime) && f.mime.length <= 255) file.mime = f.mime.toLowerCase();
        return file;
      });
    if (clean.length) out[propId] = clean;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * IDs únicos: cada fila con un número distinto; las que no tienen (filas que
 * llegaron por la API o de una copia) toman el próximo. El contador nunca
 * baja.
 */
function repairUniqueIds(properties: DbProperty[], rows: DbRow[]): void {
  for (const p of properties) {
    if (p.type !== 'unique_id') continue;
    const seen = new Set<number>();
    let max = 0;
    for (const r of rows) {
      const v = r.values[p.id];
      if (typeof v === 'number' && v > max) max = v;
    }
    let next = Math.max(p.next_id ?? 1, max + 1);
    for (const r of rows) {
      const v = r.values[p.id];
      if (typeof v === 'number' && !seen.has(v)) {
        seen.add(v);
        continue;
      }
      r.values[p.id] = next;
      seen.add(next);
      next++;
    }
    p.next_id = next;
  }
}

const SAFE_URL_RE = /^https?:\/\/\S+$/i;

export function sanitizeActions(actions: DbAction[]): DbAction[] {
  const out: DbAction[] = [];
  for (const a of actions.slice(0, 10)) {
    if (!a || !ID_RE.test(a.id)) continue;
    switch (a.type) {
      case 'set_prop':
        if (ID_RE.test(a.prop)) out.push({ id: a.id, type: 'set_prop', prop: a.prop, value: a.value ?? null, ...(a.mode ? { mode: a.mode } : {}) });
        break;
      case 'add_row':
        if (ID_RE.test(a.target?.page_id ?? '') && ID_RE.test(a.target?.block_id ?? '')) {
          out.push({
            id: a.id,
            type: 'add_row',
            target: { page_id: a.target.page_id, block_id: a.target.block_id },
            ...(a.title ? { title: plainCell(a.title).slice(0, 500) } : {}),
            ...(a.values ? { values: a.values } : {}),
          });
        }
        break;
      case 'notify':
        out.push({
          id: a.id,
          type: 'notify',
          ...(a.people?.length ? { people: a.people.filter((x) => ID_RE.test(x)).slice(0, 20) } : {}),
          ...(a.person_prop && ID_RE.test(a.person_prop) ? { person_prop: a.person_prop } : {}),
          ...(a.message ? { message: plainCell(a.message).slice(0, 1000) } : {}),
        });
        break;
      case 'webhook':
      case 'open_url':
        // open_url también acepta rutas de la app ("/app/docs/…"); un webhook solo http(s).
        if (SAFE_URL_RE.test(a.url) || (a.type === 'open_url' && /^\/[^/\\]/.test(a.url))) out.push({ id: a.id, type: a.type, url: a.url.slice(0, 2048) });
        break;
    }
  }
  return out;
}

function sanitizeAutomations(list: DbAutomation[], byId: Map<string, DbProperty>, views: DbViewConfig[]): DbAutomation[] {
  return list.slice(0, 20).flatMap((a) => {
    if (!a || !ID_RE.test(a.id)) return [];
    const trigger = a.trigger?.type === 'prop_changed' ? (byId.has(a.trigger.prop) ? a.trigger : null) : { type: 'row_added' as const };
    if (!trigger) return [];
    return [
      {
        id: a.id,
        name: plainCell(a.name).slice(0, 200),
        enabled: a.enabled === true,
        trigger,
        view: a.view && views.some((v) => v.id === a.view) ? a.view : null,
        actions: sanitizeActions(a.actions ?? []).filter((x) => x.type !== 'open_url'),
      },
    ];
  });
}

/** Vista vinculada: ids válidos y vistas saneadas (las propiedades se validan al leer la base de origen). */
function sanitizeLinked(linked: NonNullable<DocsBlock['linked']>): DocsBlock['linked'] | undefined {
  if (!ID_RE.test(linked.page_id ?? '') || !ID_RE.test(linked.block_id ?? '')) return undefined;
  const views = (linked.views ?? []).slice(0, 20).map((v) => sanitizeView(v, null));
  if (!views.length) return undefined;
  const active = views.some((v) => v.id === linked.active_view) ? linked.active_view : views[0].id;
  return { page_id: linked.page_id, block_id: linked.block_id, views, active_view: active };
}

export function sanitizeBlocks(blocks: DocsBlock[]): DocsBlock[] {
  return blocks.map((b) => ({
    // image/file: URL solo del storage de Docs, nombre/MIME saneados.
    // board: solo un id de pizarra válido.
    ...sanitizeBoardField(sanitizeFileFields(b)),
    content: sanitizeDocsHtml(b.content),
    // Las celdas de tablas/bases son texto plano (se renderizan en <input> y
    // como texto, nunca con innerHTML): escaparlas como HTML mostraba "&amp;"
    // y lo duplicaba en cada guardado.
    // Igual se sacan las etiquetas (defensa por si algún cliente de la API las renderiza).
    ...(b.rows ? { rows: b.rows.map((row) => row.map(plainCell)) } : {}),
    // La base solo vive en bloques database.
    ...(b.db ? { db: b.type === 'database' ? sanitizeDatabase(b.db) : undefined } : {}),
    ...(b.linked ? { linked: b.type === 'database' ? sanitizeLinked(b.linked) : undefined } : {}),
  }));
}
