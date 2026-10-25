/**
 * Talk: formato de los mensajes, como el de Slack. El texto se guarda tal
 * cual lo escribió la persona (con tokens para las menciones) y se convierte
 * en un árbol que el navegador pinta con React: nunca se inserta HTML.
 *
 * Bloques: párrafos (con saltos de línea), ```código```, citas (`> `), listas
 * con viñetas (`- `, `* `, `• `) y numeradas (`1. `).
 * En línea: *negrita* o **negrita**, _itálica_, ~tachado~ o ~~tachado~~,
 * `código`, links (`<url|texto>`, `[texto](url)` o la URL sola), `:emoji:`.
 * Tokens: `<@id>` persona, `<#id>` canal, `<!channel>`, `<!here>`,
 * `<!subteam^id>` grupo del workspace.
 *
 * Puro: lo usan el servidor (menciones, links, texto plano para avisos y
 * búsqueda) y el navegador (el render).
 */
import { emojiFromName } from './talk-emoji';

export type TalkInline =
  | { t: 'text'; v: string }
  | { t: 'br' }
  | { t: 'b' | 'i' | 's'; c: TalkInline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; label: string }
  | { t: 'user'; id: string }
  | { t: 'chan'; id: string }
  | { t: 'special'; v: 'channel' | 'here' }
  | { t: 'group'; id: string }
  | { t: 'emoji'; name: string; char: string };

export type TalkBlock =
  | { t: 'p'; c: TalkInline[] }
  | { t: 'pre'; v: string }
  | { t: 'quote'; c: TalkInline[] }
  | { t: 'ul'; items: TalkInline[][] }
  | { t: 'ol'; start: number; items: TalkInline[][] };

const URL_RE = /^(?:https?:\/\/|mailto:)[^\s<>]+/i;
const TRAILING = /[.,;:!?)\]'"]+$/;

/** Sólo http(s) y mailto: nada de javascript: ni data:. */
export function safeHref(raw: string): string | null {
  const v = raw.trim();
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(v)) return v;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[\p{L}\p{N}]/u.test(ch);
}

/** Busca el cierre de un delimitador (`*`, `**`, `_`, `~`, `~~`) en la misma línea. */
function findClose(s: string, from: number, delim: string): number {
  let i = from;
  while (i < s.length) {
    const j = s.indexOf(delim, i);
    if (j < 0) return -1;
    if (s.slice(from, j).includes('\n')) return -1;
    const before = s[j - 1];
    const after = s[j + delim.length];
    if (j > from && before !== ' ' && !isWordChar(after) && after !== delim[0]) return j;
    i = j + 1;
  }
  return -1;
}

function pushText(out: TalkInline[], v: string) {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** Texto de una línea (o varias: los \n quedan como saltos) a nodos en línea. */
export function parseInline(s: string, depth = 0): TalkInline[] {
  const out: TalkInline[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    const rest = s.slice(i);
    if (ch === '\n') {
      out.push({ t: 'br' });
      i += 1;
      continue;
    }
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i + 1 && !s.slice(i + 1, j).includes('\n')) {
        out.push({ t: 'code', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    if (ch === '<') {
      const tok = /^<(@|#|!subteam\^|!)([A-Za-z0-9_-]{1,64})(?:\|[^>]*)?>/.exec(rest);
      if (tok) {
        const [all, kind, id] = tok;
        if (kind === '@') out.push({ t: 'user', id });
        else if (kind === '#') out.push({ t: 'chan', id });
        else if (kind === '!subteam^') out.push({ t: 'group', id });
        else if (id === 'channel' || id === 'here') out.push({ t: 'special', v: id });
        else pushText(out, all);
        i += all.length;
        continue;
      }
      const link = /^<((?:https?:\/\/|mailto:)[^>|\s]+)(?:\|([^>]{1,300}))?>/i.exec(rest);
      if (link) {
        const href = safeHref(link[1]);
        if (href) out.push({ t: 'link', href, label: link[2] ?? link[1] });
        else pushText(out, link[0]);
        i += link[0].length;
        continue;
      }
    }
    if (ch === '[') {
      const md = /^\[([^\]\n]{1,300})\]\(((?:https?:\/\/|mailto:)[^)\s]+)\)/i.exec(rest);
      if (md) {
        const href = safeHref(md[2]);
        if (href) out.push({ t: 'link', href, label: md[1] });
        else pushText(out, md[0]);
        i += md[0].length;
        continue;
      }
    }
    if ((ch === 'h' || ch === 'H' || ch === 'm' || ch === 'M') && !isWordChar(s[i - 1])) {
      const m = URL_RE.exec(rest);
      if (m) {
        let raw = m[0];
        const trail = TRAILING.exec(raw);
        // Un ")" final es parte del link si abre un "(" adentro (Wikipedia).
        if (trail && !(trail[0] === ')' && raw.includes('('))) raw = raw.slice(0, raw.length - trail[0].length);
        const href = safeHref(raw);
        if (href) {
          out.push({ t: 'link', href, label: raw });
          i += raw.length;
          continue;
        }
      }
    }
    if (ch === ':') {
      const em = /^:([a-z0-9_+-]{1,40}):/i.exec(rest);
      if (em) {
        const char = emojiFromName(em[1]);
        if (char) {
          out.push({ t: 'emoji', name: em[1].toLowerCase(), char });
          i += em[0].length;
          continue;
        }
      }
    }
    if ((ch === '*' || ch === '_' || ch === '~') && depth < 4 && !isWordChar(s[i - 1])) {
      const double = s[i + 1] === ch && ch !== '_';
      const delim = double ? ch + ch : ch;
      const start = i + delim.length;
      if (s[start] && s[start] !== ' ' && s[start] !== ch) {
        const j = findClose(s, start, delim);
        if (j > start) {
          const inner = parseInline(s.slice(start, j), depth + 1);
          out.push({ t: ch === '*' ? 'b' : ch === '_' ? 'i' : 's', c: inner });
          i = j + delim.length;
          continue;
        }
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

/** Texto completo del mensaje a bloques. */
export function parseTalkMarkdown(body: string): TalkBlock[] {
  const src = body.replace(/\r\n?/g, '\n');
  const blocks: TalkBlock[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ t: 'p', c: parseInline(para.join('\n')) });
      para = [];
    }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Bloque de código: ``` hasta el próximo ``` (puede abrir y cerrar en la misma línea).
    if (line.trimStart().startsWith('```')) {
      flush();
      const first = line.trimStart().slice(3);
      const sameLineEnd = first.indexOf('```');
      if (sameLineEnd >= 0) {
        blocks.push({ t: 'pre', v: first.slice(0, sameLineEnd) });
        const after = first.slice(sameLineEnd + 3).trim();
        if (after) para.push(after);
        continue;
      }
      const buf: string[] = first ? [first] : [];
      let j = i + 1;
      let closed = false;
      for (; j < lines.length; j++) {
        const end = lines[j].indexOf('```');
        if (end >= 0) {
          if (end > 0) buf.push(lines[j].slice(0, end));
          closed = true;
          break;
        }
        buf.push(lines[j]);
      }
      if (!closed) {
        // Sin cierre: queda como texto.
        para.push(line);
        continue;
      }
      blocks.push({ t: 'pre', v: buf.join('\n') });
      i = j;
      continue;
    }
    if (/^(>|&gt;) ?/.test(line)) {
      flush();
      const buf: string[] = [];
      let j = i;
      while (j < lines.length && /^(>|&gt;) ?/.test(lines[j])) {
        buf.push(lines[j].replace(/^(>|&gt;) ?/, ''));
        j++;
      }
      blocks.push({ t: 'quote', c: parseInline(buf.join('\n')) });
      i = j - 1;
      continue;
    }
    if (/^\s{0,3}[-*•] \S/.test(line)) {
      flush();
      const items: TalkInline[][] = [];
      let j = i;
      while (j < lines.length && /^\s{0,3}[-*•] \S/.test(lines[j])) {
        items.push(parseInline(lines[j].replace(/^\s{0,3}[-*•] /, '')));
        j++;
      }
      blocks.push({ t: 'ul', items });
      i = j - 1;
      continue;
    }
    const ol = /^\s{0,3}(\d{1,3})[.)] \S/.exec(line);
    if (ol) {
      flush();
      const items: TalkInline[][] = [];
      let j = i;
      while (j < lines.length && /^\s{0,3}\d{1,3}[.)] \S/.test(lines[j])) {
        items.push(parseInline(lines[j].replace(/^\s{0,3}\d{1,3}[.)] /, '')));
        j++;
      }
      blocks.push({ t: 'ol', start: Number(ol[1]), items });
      i = j - 1;
      continue;
    }
    para.push(line);
  }
  flush();
  // Párrafos vacíos (líneas en blanco) no se pintan.
  return blocks.filter((b) => b.t !== 'p' || b.c.some((n) => n.t !== 'br' && !(n.t === 'text' && !n.v.trim())));
}

export interface TalkMentions {
  users: string[];
  groups: string[];
  channel: boolean;
  here: boolean;
}

function walkInline(nodes: TalkInline[], fn: (n: TalkInline) => void) {
  for (const n of nodes) {
    fn(n);
    if (n.t === 'b' || n.t === 'i' || n.t === 's') walkInline(n.c, fn);
  }
}

function walk(blocks: TalkBlock[], fn: (n: TalkInline) => void) {
  for (const b of blocks) {
    if (b.t === 'p' || b.t === 'quote') walkInline(b.c, fn);
    else if (b.t === 'ul' || b.t === 'ol') for (const it of b.items) walkInline(it, fn);
  }
}

/** Personas, grupos y @canal / @aquí mencionados (fuera de bloques de código). */
export function extractMentions(body: string): TalkMentions {
  const out: TalkMentions = { users: [], groups: [], channel: false, here: false };
  walk(parseTalkMarkdown(body), (n) => {
    if (n.t === 'user' && !out.users.includes(n.id)) out.users.push(n.id);
    else if (n.t === 'group' && !out.groups.includes(n.id)) out.groups.push(n.id);
    else if (n.t === 'special') out[n.v] = true;
  });
  return out;
}

/** URLs http(s) del mensaje (para las vistas previas), sin repetir, hasta `max`. */
export function extractUrls(body: string, max = 5): string[] {
  const out: string[] = [];
  walk(parseTalkMarkdown(body), (n) => {
    if (n.t === 'link' && /^https?:/i.test(n.href) && !out.includes(n.href) && out.length < max) out.push(n.href);
  });
  return out;
}

export interface PlainTextNames {
  user?: (id: string) => string | null | undefined;
  channel?: (id: string) => string | null | undefined;
  group?: (id: string) => string | null | undefined;
}

function inlineText(nodes: TalkInline[], names: PlainTextNames): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
          return n.v;
        case 'br':
          return '\n';
        case 'code':
          return n.v;
        case 'b':
        case 'i':
        case 's':
          return inlineText(n.c, names);
        case 'link':
          return n.label;
        case 'user':
          return `@${names.user?.(n.id) ?? n.id}`;
        case 'chan':
          return `#${names.channel?.(n.id) ?? n.id}`;
        case 'group':
          return `@${names.group?.(n.id) ?? n.id}`;
        case 'special':
          return `@${n.v}`;
        case 'emoji':
          return n.char;
      }
    })
    .join('');
}

/** Texto plano del mensaje (avisos, emails, vista previa del sidebar). */
export function talkPlainText(body: string, names: PlainTextNames = {}): string {
  return parseTalkMarkdown(body)
    .map((b) => {
      if (b.t === 'pre') return b.v;
      if (b.t === 'p' || b.t === 'quote') return inlineText(b.c, names);
      return b.items.map((it, i) => `${b.t === 'ol' ? `${b.start + i}.` : '•'} ${inlineText(it, names)}`).join('\n');
    })
    .join('\n')
    .trim();
}

/**
 * Escritura → texto guardado: "@Nombre" de las personas elegidas en el
 * autocompletado pasa a `<@id>`, y @channel/@canal/@here/@aquí a sus tokens.
 * `picked` es nombre visible → id (lo arma el editor al elegir).
 */
export function encodeMentions(
  text: string,
  picked: { users?: Record<string, string>; groups?: Record<string, string>; channels?: Record<string, string> } = {},
): string {
  let out = text;
  const replaceNames = (map: Record<string, string> | undefined, prefix: '@' | '#', token: (id: string) => string) => {
    if (!map) return;
    // Los nombres más largos primero: "@Ana María" antes que "@Ana".
    for (const name of Object.keys(map).sort((a, b) => b.length - a.length)) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}_])${prefix}${esc}(?![\\p{L}\\p{N}_-])`, 'gu'), (_m, pre: string) => `${pre}${token(map[name])}`);
    }
  };
  replaceNames(picked.users, '@', (id) => `<@${id}>`);
  replaceNames(picked.groups, '@', (id) => `<!subteam^${id}>`);
  replaceNames(picked.channels, '#', (id) => `<#${id}>`);
  out = out.replace(/(^|[^\p{L}\p{N}_<])@(channel|canal|everyone|todos)(?![\p{L}\p{N}_-])/giu, (_m, pre: string) => `${pre}<!channel>`);
  out = out.replace(/(^|[^\p{L}\p{N}_<])@(here|aquí|aqui)(?![\p{L}\p{N}_-])/giu, (_m, pre: string) => `${pre}<!here>`);
  return out;
}

/** Texto guardado → lo que se edita: tokens a "@Nombre" / "#canal". Devuelve también el mapa para volver. */
export function decodeMentions(
  body: string,
  names: PlainTextNames,
): { text: string; users: Record<string, string>; groups: Record<string, string>; channels: Record<string, string> } {
  const users: Record<string, string> = {};
  const groups: Record<string, string> = {};
  const channels: Record<string, string> = {};
  const text = body
    .replace(/<@([A-Za-z0-9_-]{1,64})(?:\|[^>]*)?>/g, (_m, id: string) => {
      const name = names.user?.(id) ?? id;
      users[name] = id;
      return `@${name}`;
    })
    .replace(/<!subteam\^([A-Za-z0-9_-]{1,64})(?:\|[^>]*)?>/g, (_m, id: string) => {
      const name = names.group?.(id) ?? id;
      groups[name] = id;
      return `@${name}`;
    })
    .replace(/<#([A-Za-z0-9_-]{1,64})(?:\|[^>]*)?>/g, (_m, id: string) => {
      const name = names.channel?.(id) ?? id;
      channels[name] = id;
      return `#${name}`;
    })
    .replace(/<!channel>/g, '@channel')
    .replace(/<!here>/g, '@here');
  return { text, users, groups, channels };
}

/** Nombre de canal como Slack: minúsculas, sin espacios (guiones), hasta 80. */
export function normalizeChannelName(raw: string): string {
  return raw
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/^#+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_-]/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
