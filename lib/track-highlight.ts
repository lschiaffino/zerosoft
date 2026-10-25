/**
 * Resaltado de sintaxis liviano para los bloques de código de Track
 * (descripciones y comentarios). Sin dependencias: un tokenizador por regex
 * que marca comentarios, strings, números y palabras clave de los lenguajes
 * más comunes. Todo el texto sale escapado; solo se agregan <span class>.
 */

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) => ESC[c]);
}

const JS_KW =
  'async await break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof interface let new null return static super switch this throw true try type typeof undefined var void while yield enum implements private protected public readonly as of';
const PY_KW =
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self';
const SQL_KW =
  'select from where and or not insert into values update set delete create table index view drop alter add join left right inner outer on group by order having limit offset as distinct union all case when then else end null is in like between exists primary key references default returning with';
const GO_KW =
  'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false';
const SH_KW = 'if then else elif fi for while do done case esac in function return export local echo exit set unset source';
const RB_KW = 'def end class module if elsif else unless while until do return yield nil true false self begin rescue ensure require';
const RS_KW = 'as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self static struct super trait true type unsafe use where while';
const CSS_KW = 'important media import keyframes from to root';

type Lang = { kw: Set<string>; hash: boolean; slash: boolean; caseless?: boolean };

function lang(kw: string, opts: Partial<Omit<Lang, 'kw'>> = {}): Lang {
  return { kw: new Set(kw.split(' ').map((k) => (opts.caseless ? k.toLowerCase() : k))), hash: false, slash: true, ...opts };
}

const LANGS: Record<string, Lang> = {
  js: lang(JS_KW),
  ts: lang(JS_KW),
  python: lang(PY_KW, { hash: true, slash: false }),
  sql: lang(SQL_KW, { caseless: true, slash: false }),
  go: lang(GO_KW),
  sh: lang(SH_KW, { hash: true, slash: false }),
  ruby: lang(RB_KW, { hash: true, slash: false }),
  rust: lang(RS_KW),
  css: lang(CSS_KW),
  json: lang('true false null'),
  generic: lang(`${JS_KW} ${PY_KW}`, { hash: false }),
};

const ALIASES: Record<string, string> = {
  javascript: 'js',
  jsx: 'js',
  mjs: 'js',
  typescript: 'ts',
  tsx: 'ts',
  py: 'python',
  bash: 'sh',
  shell: 'sh',
  zsh: 'sh',
  console: 'sh',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  scss: 'css',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
};

export function resolveLang(raw: string | undefined): string | null {
  const l = (raw ?? '').trim().toLowerCase().split(/\s+/)[0];
  if (!l) return null;
  const key = ALIASES[l] ?? l;
  return LANGS[key] ? key : null;
}

/** Código → HTML escapado con spans tk-c (comentario), tk-s (string), tk-n (número), tk-k (palabra clave). */
export function highlightCode(code: string, rawLang?: string): string {
  const key = resolveLang(rawLang);
  if (!key) return esc(code);
  const L = LANGS[key];
  const parts: string[] = [];
  const comment = [
    L.slash ? '\\/\\/[^\\n]*' : null,
    L.slash ? '\\/\\*[\\s\\S]*?\\*\\/' : null,
    L.hash ? '#[^\\n]*' : null,
    key === 'sql' ? '--[^\\n]*' : null,
  ]
    .filter(Boolean)
    .join('|');
  const re = new RegExp(
    `(${comment || '(?!)'})|("(?:\\\\.|[^"\\\\\\n])*"|'(?:\\\\.|[^'\\\\\\n])*'|\`(?:\\\\.|[^\`\\\\])*\`)|(\\b\\d+(?:\\.\\d+)?\\b)|([A-Za-z_][A-Za-z0-9_]*)`,
    'g',
  );
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) parts.push(esc(code.slice(last, m.index)));
    const [text, c, s, n, w] = m;
    if (c) parts.push(`<span class="tk-c">${esc(text)}</span>`);
    else if (s) parts.push(`<span class="tk-s">${esc(text)}</span>`);
    else if (n) parts.push(`<span class="tk-n">${esc(text)}</span>`);
    else if (w && L.kw.has(L.caseless ? w.toLowerCase() : w)) parts.push(`<span class="tk-k">${esc(text)}</span>`);
    else parts.push(esc(text));
    last = m.index + text.length;
    if (text.length === 0) re.lastIndex++;
  }
  if (last < code.length) parts.push(esc(code.slice(last)));
  return parts.join('');
}
