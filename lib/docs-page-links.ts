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

/** Href canónico (sin locale: el middleware de next-intl lo agrega). */
export function pageLinkHref(id: string): string {
  return `/app/docs/${id}`;
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeText(text).replace(/"/g, '&quot;');
}

/** HTML canónico de un link a página (el título se escapa). */
export function pageLinkHtml(id: string, title: string): string {
  return `<a href="${pageLinkHref(id)}" data-page="${id}">${escapeText(title)}</a>`;
}

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const DATA_PAGE_RE = /\bdata-page="([^"]*)"/i;

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
    const label = target.title?.trim() ? escapeText(target.title.trim()) : inner;
    // Sin id (centro de ayuda): la clase mantiene el estilo de mención.
    const dataAttr = target.keepId === false ? ' class="docs-page-link"' : ` data-page="${id}"`;
    return `<a href="${escapeAttr(target.href)}"${dataAttr}>${label}</a>`;
  });
}

/** `resolvePageLinks` sobre el content de cada bloque (las celdas son texto plano). */
export function resolveBlocksPageLinks(
  blocks: DocsBlock[],
  lookup: (id: string) => PageLinkTarget | null,
): DocsBlock[] {
  return blocks.map((b) =>
    b.content && b.content.includes('data-page') ? { ...b, content: resolvePageLinks(b.content, lookup) } : b,
  );
}

/** Resultado del buscador del popover `[[`. */
export interface PageLinkCandidate {
  id: string;
  title: string;
  icon?: string | null;
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
}
