import { marked, type Token, type Tokens } from 'marked';
import { DOCS_MAX_INDENT, type DocsBlock } from './docs-types';

/**
 * Markdown → bloques de Docs, para pegar en el editor y para importar .md.
 * Puro: el saneado del HTML en línea lo pone quien llama (en el navegador
 * lib/docs-richtext.ts, en el servidor lib/docs-sanitize.ts), así sirve en
 * los dos lados. Las listas anidadas quedan como bloques con indent.
 */

/** Tope de bloques por pegado/importación (el editor acepta hasta 2000 por página). */
export const DOCS_IMPORT_MAX_BLOCKS = 2000;
/** Tope del archivo importado en una página (.md o .docx). */
export const DOCS_IMPORT_MAX_BYTES = 4 * 1024 * 1024;

export interface MarkdownToBlocksOptions {
  /** Sanea el HTML en línea (subset HTML-lite). */
  sanitize: (html: string) => string;
  newId?: () => string;
  /**
   * Cómo pasan los # a títulos. 'notes' (por defecto, inverso del export de
   * Notes): # y ## → H1, ### → H2. 'direct' (Notion): # → H1, ## → H2, ### → H3.
   */
  headings?: 'notes' | 'direct';
}

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Alertas de GitHub (`> [!NOTE]`) → callout con su emoji. */
const ALERT_ICONS: Record<string, string> = {
  NOTE: '💡',
  TIP: '💡',
  IMPORTANT: '❗',
  WARNING: '⚠️',
  CAUTION: '⚠️',
};

export function markdownToBlocks(md: string, opts: MarkdownToBlocksOptions): DocsBlock[] {
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const out: DocsBlock[] = [];

  const inline = (text: string): string => {
    const html = marked.parseInline(text, { async: false, gfm: true }) as string;
    // Las imágenes quedan como link (no se descargan ni se suben).
    const withLinks = html.replace(/<img\b[^>]*>/gi, (tag) => {
      const src = /\bsrc="([^"]*)"/i.exec(tag)?.[1] ?? '';
      const alt = /\balt="([^"]*)"/i.exec(tag)?.[1] ?? '';
      return src ? `<a href="${src}">${alt || src}</a>` : alt;
    });
    return opts.sanitize(withLinks.replace(/\n/g, '<br>')).trim();
  };

  /** <details> abiertos (toggles de Notion): lo que va adentro anida un nivel más. */
  let detailsDepth = 0;
  const push = (b: Omit<DocsBlock, 'id'>, indent: number) => {
    if (out.length >= DOCS_IMPORT_MAX_BLOCKS) return;
    const d = Math.min(indent + detailsDepth, DOCS_MAX_INDENT);
    out.push({ id: newId(), ...b, ...(d > 0 ? { indent: d } : {}) });
  };

  const walk = (tokens: Token[], indent: number, as: 'paragraph' | 'quote') => {
    for (const tok of tokens) {
      switch (tok.type) {
        case 'heading': {
          const t = tok as Tokens.Heading;
          // Como el import de Notes (inverso del export): # y ## → H1, ### → H2, #### o más → H3.
          const level = (opts.headings === 'direct' ? Math.min(t.depth, 3) : t.depth <= 2 ? 1 : t.depth === 3 ? 2 : 3) as 1 | 2 | 3;
          push({ type: 'heading', level, content: inline(t.text) }, indent);
          break;
        }
        case 'paragraph':
        case 'text': {
          const t = tok as Tokens.Paragraph;
          const html = inline(t.text);
          if (html) push({ type: as, content: html }, indent);
          break;
        }
        case 'list': {
          const t = tok as Tokens.List;
          for (const item of t.items) {
            const first = item.tokens.find((x) => x.type === 'text' || x.type === 'paragraph') as Tokens.Text | undefined;
            const html = first ? inline(first.text) : '';
            if (item.task) push({ type: 'todo', content: html, checked: Boolean(item.checked) }, indent);
            else push({ type: t.ordered ? 'numbered_list_item' : 'bulleted_list_item', content: html }, indent);
            const rest = item.tokens.filter((x) => x !== first && x.type !== 'space' && x.type !== 'checkbox');
            if (rest.length) walk(rest, indent + 1, 'paragraph');
          }
          break;
        }
        case 'blockquote': {
          const t = tok as Tokens.Blockquote;
          const alert = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i.exec(t.text);
          if (alert) {
            const body = t.text.slice(alert[0].length).trim();
            push({ type: 'callout', icon: ALERT_ICONS[alert[1].toUpperCase()], content: inline(body) }, indent);
          } else {
            walk(t.tokens, indent, 'quote');
          }
          break;
        }
        case 'code': {
          const t = tok as Tokens.Code;
          push({ type: 'code', content: esc(t.text), ...(t.lang ? { language: t.lang.slice(0, 40) } : {}) }, indent);
          break;
        }
        case 'hr':
          push({ type: 'divider', content: '' }, indent);
          break;
        case 'table': {
          const t = tok as Tokens.Table;
          const rows = [t.header.map((c) => c.text), ...t.rows.map((r) => r.map((c) => c.text))].slice(0, 200);
          push({ type: 'table', content: '', rows: rows.map((r) => r.slice(0, 20)), header_row: true }, indent);
          break;
        }
        case 'html': {
          const raw = (tok as Tokens.HTML).text;
          // Toggle de Notion: <details><summary>Título</summary> … </details>.
          if (/<\/?details\b/i.test(raw)) {
            const re = /<details\b[^>]*>|<\/details\s*>|<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/gi;
            let m: RegExpExecArray | null;
            let rest = raw;
            while ((m = re.exec(raw))) {
              if (/^<\/details/i.test(m[0])) detailsDepth = Math.max(0, detailsDepth - 1);
              else if (/^<summary/i.test(m[0])) {
                const h = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/i.exec(m[1]);
                const content = inline(esc((h ? h[2] : m[1]).replace(/<[^>]*>/g, '').trim()));
                // El toggle va al nivel de afuera; su contenido, un nivel más adentro.
                detailsDepth = Math.max(0, detailsDepth - 1);
                push(h ? { type: 'heading', level: Number(h[1]) as 1 | 2 | 3, toggle: true, content } : { type: 'toggle', content }, indent);
                detailsDepth += 1;
              } else detailsDepth += 1;
              rest = rest.replace(m[0], '');
            }
            const text = opts.sanitize(rest).replace(/<[^>]*>/g, '').trim();
            if (text) push({ type: as, content: esc(text) }, indent);
            break;
          }
          const text = opts.sanitize(raw).replace(/<[^>]*>/g, '').trim();
          if (text) push({ type: as, content: esc(text) }, indent);
          break;
        }
        default:
          break;
      }
    }
  };

  walk(marked.lexer(md.replace(/^﻿/, ''), { gfm: true }), 0, 'paragraph');
  return out;
}

/**
 * ¿El texto plano pegado tiene sintaxis de bloque de Markdown? (headings,
 * listas, tareas, citas, código, tablas, separadores). Un texto común de
 * varias líneas igual se parte en párrafos, pero sin interpretar marcas.
 */
export function looksLikeMarkdown(text: string): boolean {
  return /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|>\s?|```|~~~|\|.*\||\s*[-*_]{3,}\s*$)/m.test(text);
}

/** Texto plano de varias líneas → un párrafo por línea (sin interpretar Markdown). */
export function plainTextToBlocks(
  text: string,
  newId: () => string = () => crypto.randomUUID(),
  opts: { as?: 'paragraph' | 'bulleted_list_item' | 'numbered_list_item' | 'todo' } = {},
): DocsBlock[] {
  const type = opts.as ?? 'paragraph';
  const lines = text.replace(/\r\n?/g, '\n').split('\n').slice(0, DOCS_IMPORT_MAX_BLOCKS);
  // Sangría de la línea (tabs, o de a 2 espacios si no hay tabs) → nivel de anidado, sin saltar niveles.
  let prev = -1;
  return lines.map((line) => {
    const lead = /^[\t ]*/.exec(line)?.[0] ?? '';
    const tabs = (lead.match(/\t/g) ?? []).length;
    // En párrafos solo cuentan los tabs (un texto con espacios al principio no se anida).
    const spaces = opts.as ? Math.floor(lead.length / 2) : 0;
    const level = Math.min(tabs > 0 ? tabs : spaces, prev + 1, DOCS_MAX_INDENT);
    prev = level;
    const b: DocsBlock = { id: newId(), type, content: esc(level > 0 || opts.as ? line.slice(lead.length) : line) };
    if (type === 'todo') b.checked = false;
    if (level > 0) b.indent = level;
    return b;
  });
}

/** Tipo de archivo importable en una página (por extensión). */
export function docsImportKind(filename: string): 'markdown' | 'docx' | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'md' || ext === 'markdown' || ext === 'txt') return 'markdown';
  if (ext === 'docx') return 'docx';
  return null;
}
