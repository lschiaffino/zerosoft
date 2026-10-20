import type { DocsBlock } from './docs-types';

/**
 * Bloques de Docs → Markdown (export). Puro, sin DB ni DOM: el contenido de
 * los bloques es HTML-lite ya sanitizado (strong/em/u/s/code/a/br), así que
 * alcanza con un reemplazo de tags acotado.
 */

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&(amp|lt|gt|quot|nbsp|#39|#x27);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)));
}

/** HTML-lite en línea → texto plano. */
export function inlineHtmlToText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''));
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

/** HTML-lite en línea → Markdown en línea. */
export function inlineHtmlToMd(html: string): string {
  if (!html) return '';
  let out = '';
  const re = /<(\/?)([a-z]+)([^>]*)>|([^<]+)/gi;
  const linkStack: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      out += escapeMd(decodeEntities(m[4]));
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    switch (tag) {
      case 'strong':
      case 'b':
        out += '**';
        break;
      case 'em':
      case 'i':
        out += '_';
        break;
      case 's':
      case 'strike':
      case 'del':
        out += '~~';
        break;
      case 'code':
        out += '`';
        break;
      case 'br':
        out += '  \n';
        break;
      case 'a': {
        if (!closing) {
          const href = /href="([^"]*)"/i.exec(m[3])?.[1] ?? '';
          linkStack.push(decodeEntities(href));
          out += '[';
        } else {
          out += `](${linkStack.pop() ?? ''})`;
        }
        break;
      }
      default:
        // <u> y cualquier otra marca: Markdown no la tiene, queda el texto.
        break;
    }
  }
  return out;
}

function tableToMd(header: string[], rows: string[][]): string {
  const width = Math.max(header.length, ...rows.map((r) => r.length), 1);
  const cell = (v: string | undefined) => (v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(cells[i])).join(' | ')} |`;
  return [line(header), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

export interface BlocksToMarkdownOptions {
  /** URL de un bloque image/file (la del proxy con permisos, nunca la del storage). Sin esto se exporta solo el nombre. */
  fileHref?: (blockId: string) => string;
}

export function blocksToMarkdown(blocks: DocsBlock[], title?: string, opts: BlocksToMarkdownOptions = {}): string {
  const parts: string[] = [];
  if (title && title.trim()) parts.push(`# ${title.trim()}`);
  let numbered = 0;
  let prevType: string | null = null;
  for (const b of blocks) {
    const listContinues = prevType === b.type && (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item' || b.type === 'todo');
    if (b.type !== 'numbered_list_item') numbered = 0;
    let text: string;
    switch (b.type) {
      case 'heading': {
        const level = Math.min((b.level ?? 1) + 1, 4);
        text = `${'#'.repeat(level)} ${inlineHtmlToMd(b.content)}`;
        break;
      }
      case 'bulleted_list_item':
        text = `- ${inlineHtmlToMd(b.content)}`;
        break;
      case 'numbered_list_item':
        numbered += 1;
        text = `${numbered}. ${inlineHtmlToMd(b.content)}`;
        break;
      case 'todo':
        text = `- [${b.checked ? 'x' : ' '}] ${inlineHtmlToMd(b.content)}`;
        break;
      case 'quote':
        text = inlineHtmlToMd(b.content)
          .split('\n')
          .map((l) => `> ${l}`)
          .join('\n');
        break;
      case 'code':
        text = `\`\`\`${b.language ?? ''}\n${inlineHtmlToText(b.content)}\n\`\`\``;
        break;
      case 'divider':
        text = '---';
        break;
      case 'image':
      case 'file': {
        const name = escapeMd(b.name || 'file');
        const href = opts.fileHref?.(b.id);
        text = href ? `${b.type === 'image' ? '!' : ''}[${name}](${href})` : name;
        break;
      }
      case 'table': {
        const rows = b.rows ?? [];
        text = rows.length ? tableToMd(rows[0], rows.slice(1)) : '';
        break;
      }
      case 'database': {
        const header = (b.columns ?? []).map((c) => c.name);
        text = tableToMd(header, b.rows ?? []);
        break;
      }
      default:
        text = inlineHtmlToMd(b.content);
    }
    prevType = b.type;
    if (!text.trim()) continue;
    if (listContinues && parts.length > 0) parts[parts.length - 1] += `\n${text}`;
    else parts.push(text);
  }
  return `${parts.join('\n\n')}\n`;
}
