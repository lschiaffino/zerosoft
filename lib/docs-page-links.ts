/**
 * Links a otra página de Docs (`[[` en el editor), estilo mención de Notion.
 *
 * Forma canónica guardada en el HTML-lite de un bloque:
 *   <a href="/app/docs/<id>" data-page="<id>">Título</a>
 * El href se arma siempre desde el id (los sanitizadores lo reescriben), así
 * que un data-page con otra cosa que un id interno no sobrevive. Al servir,
 * `resolvePageLinks` reemplaza cada link por el título actual y el href del
 * contexto (editor, lectura con locale, centro de ayuda) o lo deja en texto
 * plano si la página no se puede mostrar ahí. Puro: sin DB ni DOM.
 */
import type { DocsBlock } from './docs-types';

/** Ids de página (UUID o ids cortos de seeds): nada de '/', ':' ni comillas. */
export const PAGE_LINK_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isPageLinkId(id: unknown): id is string {
  return typeof id === 'string' && PAGE_LINK_ID_RE.test(id);
}

/**
 * Href canónico (sin locale: el middleware de next-intl lo agrega). Con `row`,
 * una fila de una base de esa página abierta como página completa.
 */
export function pageLinkHref(id: string, row?: string | null): string {
  return row && isPageLinkId(row) ? `/app/docs/${id}?row=${row}` : `/app/docs/${id}`;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** HTML canónico de un link a página, o a una fila de una base (el título se escapa). */
export function pageLinkHtml(id: string, title: string, row?: string | null): string {
  const rowAttr = row && isPageLinkId(row) ? ` data-row="${row}"` : '';
  return `<a href="${pageLinkHref(id, row)}" data-page="${id}"${rowAttr}>${escapeText(title)}</a>`;
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const DATA_PAGE_RE = /\bdata-page="([^"]*)"/i;
const DATA_ROW_RE = /\bdata-row="([^"]*)"/i;

/** Ids de página linkeados en un HTML-lite (sin repetir, en orden). */
export function pageLinkIds(html: string): string[] {
  const out: string[] = [];
  if (!html || !html.includes('data-page')) return out;
  for (const m of html.matchAll(ANCHOR_RE)) {
    const id = DATA_PAGE_RE.exec(m[1])?.[1];
    if (isPageLinkId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

export interface PageLinkTarget {
  href: string;
  /** Título actual; si falta, queda el guardado. */
  title?: string | null;
  /** false: no se emite data-page, solo class="docs-page-link" (centro de ayuda). */
  keepId?: boolean;
}

/**
 * Reescribe los links a página de un HTML-lite ya sanitizado. `lookup` null →
 * el link se baja a texto plano (sin id ni href: no filtra nada).
 */
export function resolvePageLinks(html: string, lookup: (id: string) => PageLinkTarget | null): string {
  if (!html || !html.includes('data-page')) return html;
  return html.replace(ANCHOR_RE, (whole, attrs: string, inner: string) => {
    const id = DATA_PAGE_RE.exec(attrs)?.[1];
    if (!isPageLinkId(id)) return whole;
    const target = lookup(id);
    // Texto plano: se sacan las marcas internas, el texto ya viene escapado.
    if (!target) return inner.replace(/<[^>]*>/g, '');
    const row = DATA_ROW_RE.exec(attrs)?.[1];
    const rowId = isPageLinkId(row) ? row : null;
    // Link a una fila: queda el título con que se insertó (el de la página es otro).
    const label = !rowId && target.title?.trim() ? escapeText(target.title.trim()) : inner;
    // Sin id (centro de ayuda): la clase mantiene el estilo de mención y la fila no se abre.
    if (target.keepId === false) return `<a href="${escapeAttr(target.href)}" class="docs-page-link">${label}</a>`;
    const href = rowId ? `${target.href}${target.href.includes('?') ? '&' : '?'}row=${rowId}` : target.href;
    return `<a href="${escapeAttr(href)}" data-page="${id}"${rowId ? ` data-row="${rowId}"` : ''}>${label}</a>`;
  });
}

/** `resolvePageLinks` sobre el content de cada bloque y del cuerpo de cada fila de sus bases (las celdas son texto plano). */
export function resolveBlocksPageLinks(
  blocks: DocsBlock[],
  lookup: (id: string) => PageLinkTarget | null,
): DocsBlock[] {
  return blocks.map((b) => {
    let out = b.content && b.content.includes('data-page') ? { ...b, content: resolvePageLinks(b.content, lookup) } : b;
    if (b.type === 'database' && b.db?.rows?.some((r) => r.body?.length)) {
      out = {
        ...out,
        db: {
          ...b.db,
          rows: b.db.rows.map((r) => (r.body?.length ? { ...r, body: resolveBlocksPageLinks(r.body, lookup) } : r)),
        },
      };
    }
    return out;
  });
}

/** Resultado del buscador del popover `[[`. */
export interface PageLinkCandidate {
  id: string;
  title: string;
  icon?: string | null;
  /** Fila de una base de la página `id` (el link abre la fila). */
  row_id?: string | null;
  /** Título de la página que tiene la fila (se muestra como contexto). */
  page_title?: string | null;
}

/**
 * De dónde salen los links `[[` del editor cuando no son páginas de Docs
 * (Notes linkea notas): buscador, href (sin locale) y cómo abrir uno.
 */
export interface PageLinkSource {
  search: (query: string) => Promise<PageLinkCandidate[]>;
  href: (id: string) => string;
  /** Abrir sin navegar (Notes abre la nota en su panel). Sin esto, se navega al href. */
  open?: (id: string) => void;
  /**
   * Crear el destino con la query como título (Notes: "Crear nota «x»").
   * null si falló. Con esto el popover ofrece la opción al final de la lista.
   */
  create?: (title: string) => Promise<PageLinkCandidate | null>;
  /** Textos propios del popover: la opción de crear y la lista vacía. */
  labels?: { create: (query: string) => string; empty: string };
  /** Los links pueden apuntar a filas de bases de Docs (data-row): el cuerpo de una fila en Docs. */
  rows?: boolean;
}
