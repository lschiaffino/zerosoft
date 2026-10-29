import type { DocsBlock } from './docs-types';
import { blockIndent, listNumbers } from './docs-blocks';
import { databaseTable } from './docs-database';
import { flattenContainers } from './docs-columns';
import { inlineHtmlToText } from './docs-markdown';

/**
 * Bloques de Docs → HTML (export a .html, como el "HTML" de Notion). Puro:
 * el contenido en línea ya es HTML-lite saneado (lo vuelve a sanear quien
 * llama con `sanitize`). El archivo es autónomo: estilos en línea, claro y
 * oscuro con prefers-color-scheme, sin scripts ni recursos de afuera.
 */

export interface BlocksToHtmlOptions {
  /** Sanea el HTML en línea (sanitizeDocsHtml en el servidor). */
  sanitize: (html: string) => string;
  /** URL de un archivo o imagen (relativa dentro del zip o la del proxy con permisos). null: solo el nombre. */
  fileHref?: (block: DocsBlock) => string | null;
  /** Ícono de la página (emoji). */
  icon?: string | null;
  /** Idioma del documento (atributo lang). */
  lang?: string;
  /** Pie (por ejemplo, la fecha del export). */
  footer?: string;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function safeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return /^(https?:|mailto:|tel:|\.{0,2}\/|[A-Za-z0-9 _%().-])/i.test(url) && !/^\s*(javascript|data|vbscript):/i.test(url) ? url : null;
}

/** Slug de un heading (anclas del índice). */
function anchorFor(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}-${i}`;
  used.add(id);
  return id;
}

export const EXPORT_CSS = `:root{color-scheme:light dark;--bg:#fff;--ink:#1a1a1a;--muted:#6b6b6b;--line:#e4e4e4;--soft:#f5f5f4;--link:#1f5fbf}
@media (prefers-color-scheme:dark){:root{--bg:#141414;--ink:#ececec;--muted:#a3a3a3;--line:#2e2e2e;--soft:#1e1e1e;--link:#7aa7ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main{max-width:720px;margin:0 auto;padding:48px 20px 80px}h1.title{font-size:2.2rem;line-height:1.2;margin:0 0 24px}.icon{display:block;font-size:2.6rem;line-height:1;margin-bottom:8px}
h2,h3,h4{line-height:1.3;margin:1.6em 0 .4em}p{margin:.35em 0}a{color:var(--link)}code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--soft);padding:.1em .3em;border-radius:3px}
pre{background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:12px 14px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:.6em 0;padding:0 0 0 14px;border-left:3px solid var(--ink)}.callout{display:flex;gap:10px;background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:12px 14px;margin:.6em 0}
ul,ol{margin:.3em 0;padding-left:1.5em}li{margin:.15em 0}.todo{list-style:none;padding-left:0}.todo li{display:flex;gap:8px}.todo .done{color:var(--muted);text-decoration:line-through}
table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:.92em;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}th{background:var(--soft)}
figure{margin:1em 0}img{max-width:100%;height:auto;border-radius:3px}figcaption{color:var(--muted);font-size:.9em;margin-top:4px}hr{border:0;border-top:1px solid var(--line);margin:1.4em 0}
.toggle::before{content:"▸ ";color:var(--muted)}.file{display:inline-block;border:1px solid var(--line);border-radius:4px;padding:6px 10px;margin:.3em 0;text-decoration:none}
.equation{font-family:ui-monospace,Menlo,monospace;background:var(--soft);padding:8px 12px;border-radius:4px;overflow:auto}.bookmark{display:block;border:1px solid var(--line);border-radius:4px;padding:10px 12px;margin:.5em 0;text-decoration:none;color:inherit}
.bookmark small{display:block;color:var(--muted)}.toc{border-left:2px solid var(--line);padding-left:12px}.subpages{margin-top:32px;border-top:1px solid var(--line);padding-top:12px}footer{color:var(--muted);font-size:.85em;margin-top:48px}
@media print{main{padding:0}a{color:inherit}}`;

type ListKind = 'ul' | 'ol' | 'todo';

/** Cuerpo HTML (sin <html>) de los bloques de una página. */
export function blocksToHtmlBody(input: DocsBlock[], opts: BlocksToHtmlOptions): string {
  const blocks = flattenContainers(input);
  const numbers = listNumbers(blocks);
  const used = new Set<string>();
  const inline = (html: string) => opts.sanitize(html ?? '');
  const headings = blocks
    .filter((b) => b.type === 'heading')
    .map((b) => ({ level: b.level ?? 1, text: inlineHtmlToText(b.content), id: anchorFor(inlineHtmlToText(b.content), used) }));
  let headingIndex = 0;
  const out: string[] = [];
  let open: { kind: ListKind; indent: number } | null = null;
  const closeList = () => {
    if (open) out.push(open.kind === 'ol' ? '</ol>' : '</ul>');
    open = null;
  };
  const pad = (b: DocsBlock) => {
    const d = blockIndent(b);
    return d > 0 ? ` style="margin-left:${d * 24}px"` : '';
  };

  blocks.forEach((b, i) => {
    const listKind: ListKind | null =
      b.type === 'bulleted_list_item' ? 'ul' : b.type === 'numbered_list_item' ? 'ol' : b.type === 'todo' ? 'todo' : null;
    const d = blockIndent(b);
    if (listKind) {
      const cur = open as { kind: ListKind; indent: number } | null;
      if (!cur || cur.kind !== listKind || cur.indent !== d) {
        closeList();
        const style = d > 0 ? ` style="margin-left:${d * 24}px"` : '';
        if (listKind === 'ol') out.push(`<ol start="${numbers[i] || 1}"${style}>`);
        else out.push(`<ul${listKind === 'todo' ? ' class="todo"' : ''}${style}>`);
        open = { kind: listKind, indent: d };
      }
      if (listKind === 'todo') {
        out.push(`<li><input type="checkbox" disabled${b.checked ? ' checked' : ''}><span${b.checked ? ' class="done"' : ''}>${inline(b.content)}</span></li>`);
      } else {
        out.push(`<li>${inline(b.content)}</li>`);
      }
      return;
    }
    closeList();
    const caption = b.caption ? `<figcaption>${inline(b.caption)}</figcaption>` : '';
    switch (b.type) {
      case 'heading': {
        const level = Math.min((b.level ?? 1) + 1, 4);
        const id = headings[headingIndex++]?.id ?? '';
        out.push(`<h${level} id="${id}"${pad(b)}>${inline(b.content)}</h${level}>`);
        break;
      }
      case 'quote':
        out.push(`<blockquote${pad(b)}>${inline(b.content)}</blockquote>`);
        break;
      case 'callout':
        out.push(`<div class="callout"${pad(b)}>${b.icon ? `<span>${escapeHtml(b.icon)}</span>` : ''}<div>${inline(b.content)}</div></div>`);
        break;
      case 'toggle':
        out.push(`<p class="toggle"${pad(b)}>${inline(b.content)}</p>`);
        break;
      case 'code':
        out.push(`<pre${pad(b)}><code${b.language ? ` class="language-${escapeHtml(b.language)}"` : ''}>${escapeHtml(inlineHtmlToText(b.content))}</code></pre>`);
        break;
      case 'divider':
        out.push('<hr>');
        break;
      case 'equation':
        out.push(`<div class="equation"${pad(b)}>${escapeHtml(inlineHtmlToText(b.content))}</div>`);
        break;
      case 'image': {
        const src = opts.fileHref?.(b) ?? null;
        out.push(src ? `<figure${pad(b)}><img src="${escapeHtml(src)}" alt="${escapeHtml(b.name || '')}">${caption}</figure>` : `<p${pad(b)}>${escapeHtml(b.name || '')}</p>`);
        break;
      }
      case 'file':
      case 'video':
      case 'audio':
      case 'pdf': {
        const href = opts.fileHref?.(b) ?? null;
        const name = escapeHtml(b.name || 'file');
        out.push(`<p${pad(b)}>${href ? `<a class="file" href="${escapeHtml(href)}">${name}</a>` : name}</p>${caption}`);
        break;
      }
      case 'bookmark':
      case 'embed': {
        const url = safeUrl(b.link?.url);
        if (url) {
          const desc = b.link?.description ? `<small>${escapeHtml(b.link.description)}</small>` : '';
          out.push(`<a class="bookmark" href="${escapeHtml(url)}"${pad(b)}>${escapeHtml(b.link?.title || url)}${desc}<small>${escapeHtml(url)}</small></a>${caption}`);
        }
        break;
      }
      case 'button': {
        const url = b.button?.action === 'link' ? safeUrl(b.button.url) : null;
        if (url) out.push(`<p${pad(b)}><a href="${escapeHtml(url)}">${escapeHtml(b.button?.label || url)}</a></p>`);
        break;
      }
      case 'toc':
        if (headings.length) {
          out.push(
            `<nav class="toc"${pad(b)}>${headings
              .map((h) => `<div style="margin-left:${(h.level - 1) * 14}px"><a href="#${h.id}">${escapeHtml(h.text)}</a></div>`)
              .join('')}</nav>`,
          );
        }
        break;
      case 'breadcrumb':
      case 'board':
      case 'design':
        break;
      case 'table': {
        const rows = b.rows ?? [];
        if (rows.length) out.push(tableHtml(rows[0], rows.slice(1), true));
        break;
      }
      case 'database': {
        const table = databaseTable(b);
        const title = b.db?.title ? `<h4>${escapeHtml(b.db.title)}</h4>` : '';
        out.push(`${title}${tableHtml(table.header, table.rows, false)}`);
        break;
      }
      default: {
        const html = inline(b.content);
        out.push(html ? `<p${pad(b)}>${html}</p>` : '<p>&nbsp;</p>');
      }
    }
  });
  closeList();
  return out.join('\n');
}

function tableHtml(header: string[], rows: string[][], inlineCells: boolean): string {
  const cell = (v: string | undefined) => (inlineCells ? escapeHtml(inlineHtmlToText(v ?? '')) : escapeHtml(v ?? ''));
  const width = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const head = `<tr>${Array.from({ length: width }, (_, i) => `<th>${cell(header[i])}</th>`).join('')}</tr>`;
  const body = rows.map((r) => `<tr>${Array.from({ length: width }, (_, i) => `<td>${cell(r[i])}</td>`).join('')}</tr>`).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

/** Documento HTML completo de una página. `extra` va después del contenido (lista de subpáginas). */
export function blocksToHtmlDocument(blocks: DocsBlock[], title: string, opts: BlocksToHtmlOptions & { extra?: string }): string {
  const t = title.trim() || 'Untitled';
  return `<!doctype html>
<html lang="${escapeHtml(opts.lang ?? 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(t)}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
<main>
<header>${opts.icon ? `<span class="icon">${escapeHtml(opts.icon)}</span>` : ''}<h1 class="title">${escapeHtml(t)}</h1></header>
<article>
${blocksToHtmlBody(blocks, opts)}
</article>
${opts.extra ?? ''}
${opts.footer ? `<footer>${escapeHtml(opts.footer)}</footer>` : ''}
</main>
</body>
</html>
`;
}
