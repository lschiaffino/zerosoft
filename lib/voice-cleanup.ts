/**
 * Limpieza de un dictado por reglas (puro). Corre siempre después de la IA
 * (reemplazos del diccionario y snippets tienen que quedar exactos) y sola
 * cuando la IA está apagada, sin cuota o en frases cortas de la app de
 * escritorio: saca muletillas, aplica las autocorrecciones dichas ("el lunes,
 * no, quise decir el martes"), convierte la puntuación dicha ("dos puntos",
 * "coma", "abrir paréntesis"...) en el signo, arma listas ("una lista: huevo,
 * carne y leche", "punto uno… punto dos…", "primero… segundo…"), acomoda un
 * mail (saludo, cuerpo y despedida en su línea), mayúscula inicial y punto
 * final. En español, inglés y portugués.
 */
import type { VoiceContext, VoiceDictionaryEntry } from './voice-types';

const FILLERS = [
  // en
  'um+', 'uh+', 'erm+', 'hmm+', 'mm+', 'you know', 'like,',
  // es
  // "em" no: en portugués es "en".
  'eh+', 'emm+', 'este\\.\\.\\.', 'o sea,', 'mmm+',
  // pt
  'tipo,', 'né', 'ahn+', 'éh+',
];

const FILLER_RE = new RegExp(`(^|[\\s,])(?:${FILLERS.join('|')})(?=[\\s,.!?]|$)`, 'giu');
/** En portugués "um" es "un": solo es muletilla seguido de coma ("um, então…"). */
const FILLER_RE_PT = new RegExp(`(^|[\\s,])(?:${FILLERS.filter((f) => f !== 'um+').join('|')}|umm+|um(?=,))(?=[\\s,.!?]|$)`, 'giu');
const PORTUGUESE_HINT_RE = /[ãõç]|(?<![\p{L}])(?:você|não|uma|está|obrigad[oa]|muito|tudo|isso|também|então|agora|amanhã|ontem|preciso|gente)(?![\p{L}])/iu;

/** ¿El dictado está en portugués? (por el idioma que dio la transcripción o por las palabras). */
export function looksPortuguese(text: string, language?: string): boolean {
  const l = (language ?? '').toLowerCase();
  if (l.startsWith('pt') || l.startsWith('portug')) return true;
  if (l && l !== 'auto') return false;
  return PORTUGUESE_HINT_RE.test(text);
}

/** Marcadores de autocorrección: lo que viene después reemplaza lo de antes. */
const BACKTRACK_RE =
  /,?\s*\b(?:no|nah|o sea|perdón|sorry|não|ou melhor)\b,?\s+(?:I mean|I meant|quise decir|quiero decir|mejor|digo|eu quis dizer|quer dizer|melhor)\b,?\s+|,\s*(?:mejor dicho|ou melhor|or rather|digo)\s*,\s*/iu;
const SCRATCH_RE = /\b(?:scratch that|borrá eso|borra eso|apaga isso)\b[.,!]?\s*/iu;

const ORDINALS: Array<RegExp> = [
  /\b(?:first|firstly|primero|en primer lugar|primeiro)\b,?\s*/iu,
  /\b(?:second|secondly|segundo|en segundo lugar)\b,?\s*/iu,
  /\b(?:third|thirdly|tercero|en tercer lugar|terceiro)\b,?\s*/iu,
  /\b(?:fourth|cuarto|quarto)\b,?\s*/iu,
  /\b(?:fifth|quinto)\b,?\s*/iu,
];

const NEW_LINE_RE = /\s*\b(?:new line|nueva línea|nova linha)\b[.,]?\s*/giu;
const NEW_PARAGRAPH_RE = /\s*\b(?:new paragraph|nuevo párrafo|novo parágrafo)\b[.,]?\s*/giu;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function removeFillers(text: string, opts: { language?: string } = {}): string {
  return text
    .replace(looksPortuguese(text, opts.language) ? FILLER_RE_PT : FILLER_RE, (_m, lead: string) => (lead === ',' ? ',' : lead))
    .replace(/\s+,/g, ',')
    .replace(/,\s*,/g, ',')
    .replace(/^\s*,\s*/, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** "on Monday, no, I mean Tuesday" → "on Tuesday"; "…, scratch that" borra la frase anterior. */
export function applyBacktrack(text: string): string {
  let out = text;
  for (let guard = 0; guard < 10; guard++) {
    const m = BACKTRACK_RE.exec(out);
    if (!m) break;
    const before = out.slice(0, m.index);
    const afterAll = out.slice(m.index + m[0].length);
    // La corrección llega hasta un signo o un conector ("y", "and", "pero"…), y como mucho 4 palabras.
    const endIdx = afterAll.search(/[.!?;,\n]|\s(?:and|but|so|then|y|pero|e|mas|después|luego)\s|$/iu);
    const correction = afterAll.slice(0, endIdx).trim();
    const rest = afterAll.slice(endIdx);
    const n = Math.min(4, Math.max(1, correction.split(/\s+/).filter(Boolean).length));
    const words = before.trimEnd().split(/(\s+)/);
    // Si la corrección repite una palabra de lo anterior ("de la tienda, no, quise decir de la web"),
    // se corta desde esa palabra; si no, se sacan las últimas n palabras (sin cruzar un punto).
    const first = correction.split(/\s+/)[0]?.toLowerCase() ?? '';
    const tail = words.filter((w) => w.trim());
    let cutAt = -1;
    for (let i = tail.length - 1; i >= Math.max(0, tail.length - 6); i--) {
      if (/[.!?]$/.test(tail[i])) break;
      if (tail[i].toLowerCase().replace(/[,;:]$/, '') === first) {
        cutAt = tail.length - i;
        break;
      }
    }
    const target = cutAt > 0 ? cutAt : n;
    let removed = 0;
    while (words.length && removed < target) {
      const w = words[words.length - 1];
      if (/[.!?]$/.test(w)) break;
      words.pop();
      if (w.trim()) removed += 1;
    }
    const head = words.join('').trimEnd();
    out = `${head}${head ? ' ' : ''}${correction}${rest}`;
  }
  for (let guard = 0; guard < 10; guard++) {
    const m = SCRATCH_RE.exec(out);
    if (!m) break;
    const before = out.slice(0, m.index).trimEnd();
    const cut = Math.max(before.lastIndexOf('. ', before.length - 2), before.lastIndexOf('? '), before.lastIndexOf('! '));
    const head = cut >= 0 ? before.slice(0, cut + 1) : '';
    out = `${head}${head ? ' ' : ''}${out.slice(m.index + m[0].length)}`.trim();
  }
  return out;
}

/** "primero X, segundo Y y tercero Z" → lista numerada (desde dos puntos). */
export function formatSpokenList(text: string): string {
  const first = ORDINALS[0].exec(text);
  const second = ORDINALS[1].exec(text);
  if (!first || !second || second.index < first.index) return text;
  const intro = text.slice(0, first.index).trim().replace(/[,:]$/, '');
  const items: string[] = [];
  let rest = text.slice(first.index + first[0].length);
  for (let i = 1; i < ORDINALS.length; i++) {
    const m = ORDINALS[i].exec(rest);
    if (!m) break;
    items.push(rest.slice(0, m.index));
    rest = rest.slice(m.index + m[0].length);
  }
  items.push(rest);
  const clean = items
    .map((s) => s.trim().replace(/^[,;:]\s*/, '').replace(/[,;]?\s*\b(?:and|y|e)$/iu, '').replace(/[,;.]+$/, '').trim())
    .filter(Boolean);
  if (clean.length < 2) return text;
  const list = clean.map((s, i) => `${i + 1}. ${capitalize(s)}`).join('\n');
  return intro ? `${capitalize(intro)}:\n${list}` : list;
}

export function applySpokenBreaks(text: string): string {
  return text.replace(NEW_PARAGRAPH_RE, '\n\n').replace(NEW_LINE_RE, '\n');
}

// ---------- Puntuación dicha ----------

/** Límites de palabra que entienden acentos (\b de JS solo mira ASCII). */
const WL = '(?<![\\p{L}\\p{N}])';
const WR = '(?![\\p{L}\\p{N}])';

interface SpokenMark {
  /** Frases (en minúscula, espacios simples). */
  words: string[];
  /** Lo que queda en su lugar. */
  sym: string;
  /** Cómo se pega: al texto anterior (",", ":"), al siguiente ("(", comillas que abren) o un salto. */
  join: 'left' | 'right' | 'break';
  /** Palabra anterior con la que la frase no es un signo ("ganamos por dos puntos"). */
  notAfter?: string[];
  /** Palabra siguiente con la que la frase no es un signo ("dos puntos de ventaja"). */
  notBefore?: string[];
  /** Solo al final del dictado ("…mañana punto"): en el medio, "punto" es una palabra. */
  endOnly?: boolean;
}

const QUANTITY_WORDS_ES = ['por', 'de', 'los', 'unos', 'con', 'a', 'en', 'solo', 'sólo', 'y', 'o', 'sus', 'tus', 'mis', 'nuestros', 'esos', 'estos', 'más', 'mas', 'menos', 'otros', 'primeros', 'últimos', 'ultimos', 'tiene', 'tenía', 'saca', 'sacó', 'subió', 'bajó', 'perdió', 'ganó'];
const QUANTITY_WORDS_PT = ['por', 'de', 'os', 'uns', 'com', 'a', 'em', 'só', 'e', 'ou', 'seus', 'meus', 'mais', 'menos', 'outros', 'primeiros', 'últimos', 'tem', 'tinha', 'subiu', 'caiu', 'perdeu', 'ganhou'];

const SPOKEN_MARKS: SpokenMark[] = [
  // Saltos (antes que "punto" y "coma" sueltos).
  { words: ['punto y aparte', 'punto aparte'], sym: '.\n\n', join: 'break' },
  { words: ['nuevo párrafo', 'nuevo parrafo', 'new paragraph', 'next paragraph', 'novo parágrafo', 'novo paragrafo'], sym: '\n\n', join: 'break' },
  { words: ['nueva línea', 'nueva linea', 'salto de línea', 'salto de linea', 'new line', 'next line', 'line break', 'nova linha', 'quebra de linha'], sym: '\n', join: 'break' },
  // Signos de más de una palabra primero ("punto y coma" antes que "coma").
  { words: ['punto y coma', 'ponto e vírgula', 'ponto e virgula', 'semicolon', 'semi colon', 'semi-colon'], sym: ';', join: 'left' },
  { words: ['punto y seguido', 'punto final', 'ponto final', 'full stop'], sym: '.', join: 'left' },
  { words: ['signo de interrogación', 'signo de interrogacion', 'signo de pregunta', 'ponto de interrogação', 'ponto de interrogacao', 'question mark'], sym: '?', join: 'left' },
  { words: ['signo de exclamación', 'signo de exclamacion', 'ponto de exclamação', 'ponto de exclamacao', 'exclamation mark', 'exclamation point'], sym: '!', join: 'left' },
  { words: ['abrir paréntesis', 'abrir parentesis', 'abre paréntesis', 'abre parentesis', 'abrir parênteses', 'abre parênteses', 'abre parêntese', 'abrir parêntese', 'open paren', 'open parenthesis', 'open parentheses'], sym: '(', join: 'right' },
  { words: ['cerrar paréntesis', 'cerrar parentesis', 'cierra paréntesis', 'cierra parentesis', 'fechar parênteses', 'fecha parênteses', 'fecha parêntese', 'fechar parêntese', 'close paren', 'close parenthesis', 'close parentheses', 'end paren'], sym: ')', join: 'left' },
  { words: ['abrir comillas', 'abre comillas', 'abrir aspas', 'abre aspas', 'open quote', 'open quotes', 'begin quote'], sym: '"', join: 'right' },
  { words: ['cerrar comillas', 'cierra comillas', 'fechar aspas', 'fecha aspas', 'close quote', 'close quotes', 'end quote', 'unquote'], sym: '"', join: 'left' },
  { words: ['dos puntos'], sym: ':', join: 'left', notAfter: QUANTITY_WORDS_ES, notBefore: ['de', 'del', 'más', 'menos', 'porcentuales', 'arriba', 'abajo', 'atrás', 'adelante'] },
  { words: ['dois pontos'], sym: ':', join: 'left', notAfter: QUANTITY_WORDS_PT, notBefore: ['de', 'do', 'da', 'a', 'mais', 'menos', 'percentuais', 'acima', 'abaixo', 'atrás', 'à', 'na', 'no'] },
  { words: ['colon'], sym: ':', join: 'left', notAfter: ['the', 'a', 'his', 'her', 'my', 'your', 'our', 'their', 'sigmoid'] },
  { words: ['coma'], sym: ',', join: 'left', notAfter: ['que', 'un', 'el', 'en', 'al', 'del', 'estado', 'o', 'em', 'um', 'no', 'a', 'the'], notBefore: ['inducido', 'diabético', 'etílico', 'induzido'] },
  { words: ['comma'], sym: ',', join: 'left', notAfter: ['a', 'the', 'oxford', 'no'] },
  { words: ['vírgula', 'virgula'], sym: ',', join: 'left', notAfter: ['a', 'uma', 'sem', 'da', 'na'] },
  // "Punto" suelto solo cierra el dictado (en el medio es una palabra: "en ese punto").
  {
    words: ['punto', 'period', 'ponto'],
    sym: '.',
    join: 'left',
    endOnly: true,
    // "es un buen punto", "the trial period", "um bom ponto": la palabra es contenido.
    notAfter: [
      'un', 'el', 'buen', 'este', 'ese', 'mismo', 'otro', 'al', 'del', 'ningún', 'cada', 'primer', 'último', 'mi', 'tu', 'su', 'de', 'a', 'en', 'hasta', 'ese', 'aquel',
      'the', 'a', 'this', 'that', 'trial', 'grace', 'waiting', 'billing', 'notice', 'probation', 'free', 'test', 'same', 'time', 'cooling', 'sample', 'first', 'second', 'last',
      'um', 'o', 'bom', 'esse', 'outro', 'ao', 'do', 'no', 'primeiro', 'último', 'meu', 'seu', 'em', 'até',
    ],
  },
];

function phraseRe(words: string[]): string {
  return [...words].sort((a, b) => b.length - a.length).map((w) => escapeRe(w).replace(/ /g, '\\s+')).join('|');
}

const SPOKEN_MARK_RES = SPOKEN_MARKS.map((m) => ({
  mark: m,
  // Se come la coma o el punto que el transcriptor puso alrededor de la palabra ("lista, dos puntos, huevo").
  re: new RegExp(`${m.join === 'right' ? '\\s*' : '\\s*[,.]?\\s*'}${WL}(?:${phraseRe(m.words)})${WR}[,.]?\\s*`, 'giu'),
}));

function lastWord(s: string): string {
  return (s.trimEnd().match(/[\p{L}\p{N}]+$/u)?.[0] ?? '').toLowerCase();
}
function firstWord(s: string): string {
  return (s.trimStart().match(/^[\p{L}\p{N}]+/u)?.[0] ?? '').toLowerCase();
}

/**
 * Puntuación y comandos dichos → el signo: "dos puntos", "coma", "punto y
 * coma", "punto y aparte", "nueva línea", "abrir/cerrar paréntesis",
 * "abrir/cerrar comillas", "signo de interrogación" y sus versiones en inglés y
 * portugués. No toca la frase cuando es contenido ("ganamos por dos puntos",
 * "entró en coma", "en ese punto").
 */
export function applySpokenPunctuation(text: string): string {
  let out = text;
  for (const { mark, re } of SPOKEN_MARK_RES) {
    out = out.replace(re, (m: string, offset: number, whole: string) => {
      const before = whole.slice(0, offset);
      const after = whole.slice(offset + m.length);
      if (mark.endOnly && after.trim()) return m;
      if (mark.notAfter?.includes(lastWord(before))) return m;
      if (mark.notBefore?.includes(firstWord(after))) return m;
      if (mark.join === 'break') return mark.sym;
      if (mark.join === 'right') return before.trim() ? ` ${mark.sym}` : mark.sym;
      return after.trim() ? `${mark.sym} ` : mark.sym;
    });
  }
  return out
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\.(\s*)\.(?=\n|$)/g, '.$1')
    .replace(/([,;:])(?:\s*[,;:])+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

const TLDS = 'com|net|org|io|ai|co|dev|app|me|edu|gov|info|ar|br|mx|es|cl|uy|pe|uk|us';
/** TLDs que se juntan sin arroba ("zerosoft punto com"): los que no son palabras comunes. */
const BARE_TLDS = 'com|net|org|io|ai|dev|app';

/** "ana arroba zerosoft punto ai" → "ana@zerosoft.ai"; "zerosoft punto com" → "zerosoft.com". */
export function joinSpokenAddresses(text: string): string {
  const dot = '\\s+(?:punto|dot|ponto)\\s+';
  const email = new RegExp(
    `${WL}([\\p{L}\\p{N}._-]+)\\s+(?:arroba|at)\\s+([\\p{L}\\p{N}-]+)((?:${dot}(?:${TLDS})${WR}){1,2})`,
    'giu',
  );
  const bare = new RegExp(`${WL}([\\p{L}\\p{N}-]+)${dot}(${BARE_TLDS})${WR}`, 'giu');
  const tail = (s: string) => s.replace(new RegExp(dot, 'giu'), '.').trim();
  return text
    .replace(email, (_m, user: string, host: string, rest: string) => `${user}@${host}${tail(rest)}`.toLowerCase())
    .replace(bare, (_m, host: string, tld: string) => `${host}.${tld}`.toLowerCase());
}

// ---------- Listas ----------

const NUMBER_WORDS: string[][] = [
  [],
  ['uno', 'una', 'one', 'um', 'uma', '1'],
  ['dos', 'two', 'dois', 'duas', '2'],
  ['tres', 'três', 'three', '3'],
  ['cuatro', 'four', 'quatro', '4'],
  ['cinco', 'five', '5'],
  ['seis', 'six', '6'],
  ['siete', 'seven', 'sete', '7'],
  ['ocho', 'eight', 'oito', '8'],
  ['nueve', 'nine', 'nove', '9'],
  ['diez', 'ten', 'dez', '10'],
];
const NUMBER_INDEX = new Map(NUMBER_WORDS.flatMap((ws, i) => ws.map((w) => [w, i] as const)));
const NUMBERED_MARK_RE = new RegExp(
  `[\\s,.:;]*${WL}(?:punto|número|numero|number|item|ítem|ponto|paso|step|passo)\\s+(${NUMBER_WORDS.flat().map(escapeRe).join('|')})${WR}[,.:]?\\s*`,
  'giu',
);

function cleanItem(s: string): string {
  return s
    .trim()
    .replace(/^[,;:]\s*/, '')
    .replace(/[,;]?\s*\b(?:and|y|e)$/iu, '')
    .replace(/[,;.]+$/, '')
    .trim();
}

// Sin "do" ni "no": en inglés son "things to do number one", "no number two".
const MARK_ARTICLES = new Set(['el', 'del', 'al', 'la', 'este', 'ese', 'the', 'this', 'that', 'o', 'ao', 'esse']);

/** "punto uno pan punto dos leche" / "number one… number two…" → lista numerada. */
export function formatNumberedMarkers(text: string): string {
  const marks = [...text.matchAll(NUMBERED_MARK_RE)]
    .map((m) => ({ n: NUMBER_INDEX.get(m[1].toLowerCase()) ?? 0, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
    // "el punto uno del contrato": con artículo delante es contenido, no un número de lista.
    .filter((m) => !MARK_ARTICLES.has(lastWord(text.slice(0, m.start))));
  const startAt = marks.findIndex((m) => m.n === 1);
  if (startAt < 0) return text;
  const seq = [marks[startAt]];
  for (const m of marks.slice(startAt + 1)) {
    if (m.n !== seq[seq.length - 1].n + 1) break;
    seq.push(m);
  }
  if (seq.length < 2) return text;
  const items = seq.map((m, i) => cleanItem(text.slice(m.end, i + 1 < seq.length ? seq[i + 1].start : undefined))).filter(Boolean);
  if (items.length < 2) return text;
  const intro = text.slice(0, seq[0].start).trim().replace(/[,:]$/, '');
  const list = items.map((s, i) => `${i + 1}. ${capitalize(s)}`).join('\n');
  return intro ? `${capitalize(intro)}:\n${list}` : list;
}

/** La persona anuncia una lista ("una lista", "a list", "uma lista"). */
export const LIST_WORD_RE = /(?<![\p{L}\p{N}])(?:lista|list|listinha)(?![\p{L}\p{N}])/iu;
const LIST_CONJ_RE = /\s+(?:y|e|and|or|o|ou)\s+/iu;

function splitItems(segment: string, maxWords: number): string[] | null {
  const parts = segment.split(/\s*[,;]\s*/);
  const last = parts.pop() ?? '';
  const tail = last.split(LIST_CONJ_RE);
  // "a, b y c": la conjunción separa los dos últimos; sin comas, "a y b" también.
  const items = [...parts, ...(tail.length === 2 ? tail : [last])].map(cleanItem);
  if (items.some((s) => !s || s.split(/\s+/).length > maxWords)) return null;
  return items;
}

/**
 * "Quiero una lista: huevo, carne y leche" (o "una lista de compras, huevo,
 * carne y leche") → la introducción y una viñeta por cosa. Después de dos
 * puntos hacen falta tres cosas; si se anunció una lista, alcanzan dos.
 */
export function formatInlineList(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(?:-|\d+\.)\s/.test(line)) return line;
      const colon = line.search(/:\s+\S/);
      let introEnd = colon;
      let listed = false;
      if (colon < 0) {
        // Sin dos puntos: "una lista de compras, huevo, carne y leche".
        const m = new RegExp(`${LIST_WORD_RE.source}[^.,:!?]{0,40}?,\\s*`, 'iu').exec(line);
        if (!m) return line;
        introEnd = m.index + m[0].replace(/,\s*$/, '').length;
        listed = true;
      }
      const intro = line.slice(0, introEnd).trim();
      if (!intro) return line;
      const afterIntro = line.slice(introEnd + 1);
      const stop = afterIntro.search(/[.!?](?:\s|$)/);
      const segment = stop >= 0 ? afterIntro.slice(0, stop) : afterIntro;
      const rest = stop >= 0 ? afterIntro.slice(stop + 1).trim() : '';
      const announced = LIST_WORD_RE.test(intro);
      // Sin anunciar una lista, solo cosas cortas ("pan, queso y vino"), no frases ("Nota: el martes llamo a Juan, a Pedro y a Ana").
      const items = splitItems(segment, announced && !listed ? 6 : 4);
      if (!items || items.length < (announced ? 2 : 3)) return line;
      const list = items.map((s) => `- ${capitalize(s)}`).join('\n');
      return `${intro}:\n${list}${rest ? `\n${capitalize(rest)}` : ''}`;
    })
    .join('\n');
}

// ---------- Mail ----------

const GREETING_RE =
  /^(?:hola|hi|hello|hey|dear|querid[oa]s?|estimad[oa]s?|buen(?:os)? d[ií]as?|buenas tardes|buenas noches|buenas|olá|ola|oi|prezad[oa]s?|car[oa]s?|bom dia|boa tarde|boa noite|good morning|good afternoon|good evening)(?![\p{L}\p{N}])/iu;
const SIGNOFF_RE =
  /(^|[.!?]\s+|,\s+)((?:saludos cordiales|saludos|un saludo|un abrazo|abrazos|abrazo|muchas gracias|gracias|atentamente|cordialmente|best regards|kind regards|warm regards|regards|best|many thanks|thanks|thank you|cheers|um abraço|abraços|abraço|atenciosamente|muito obrigad[oa]|obrigad[oa]|beijos))(?:[,.!]\s*|\s+|$)([^.!?\n]*?)[.!]?$/iu;
const NAME_RE = /^(?:\p{Lu}[\p{L}'’.-]*(?:\s+|$)){0,3}$/u;

function splitGreeting(text: string): { greeting: string; body: string } | null {
  const m = GREETING_RE.exec(text);
  if (!m) return null;
  const rest = text.slice(m[0].length);
  // "Hola Juan, te mando…": hasta la primera coma o punto si está cerca.
  const punct = /^([^,.!?:\n]{0,40}?)[,.!:]\s*/u.exec(rest);
  if (punct && punct[1].trim().split(/\s+/).filter(Boolean).length <= 4) {
    return { greeting: `${m[0]}${punct[1]}`.trim(), body: rest.slice(punct[0].length) };
  }
  // Sin puntuación: el saludo se lleva el nombre que sigue si va con mayúscula ("Hola Juan te mando").
  const name = /^\s+((?:\p{Lu}[\p{L}'’-]*\s*){1,2})/u.exec(rest);
  if (name) return { greeting: `${m[0]} ${name[1].trim()}`, body: rest.slice(name[0].length) };
  return null;
}

function splitSignoff(body: string): { body: string; signoff: string; name: string } | null {
  const m = SIGNOFF_RE.exec(body);
  if (!m) return null;
  const name = m[3].trim();
  if (name && !NAME_RE.test(name)) return null;
  const before = body.slice(0, m.index + (m[1]?.trimEnd().length ?? 0)).trim().replace(/,$/, '.');
  return { body: before, signoff: m[2], name };
}

/**
 * Un mail dictado de corrido → saludo en su línea, el cuerpo y la despedida
 * con el nombre abajo. Solo usa el saludo y la despedida que se dijeron. En
 * un mail (context email) alcanza con uno de los dos; en otro lado, hacen
 * falta los dos para que sea claramente un mail. En un chat no se toca.
 */
export function formatEmailLayout(text: string, context?: VoiceContext): string {
  if (context === 'chat' || /\n/.test(text.trim()) && context !== 'email') return text;
  const g = splitGreeting(text.trim());
  const s = splitSignoff((g ? g.body : text).trim());
  if (context !== 'email' && (!g || !s)) return text;
  if (!g && !s) return text;
  const body = capitalize((s ? s.body : g!.body).trim());
  const parts: string[] = [];
  if (g) parts.push(`${capitalize(g.greeting)},`);
  if (body) parts.push(/[.!?…:;)"'»]$/.test(body) || /\n\s*(?:-|\d+\.)\s[^\n]*$/.test(body) ? body : `${body}.`);
  if (s) parts.push(`${capitalize(s.signoff)},${s.name ? `\n${s.name}` : ''}`);
  return parts.join('\n\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** Reemplazos y snippets del diccionario (sin distinguir mayúsculas, palabra entera). */
export function applyDictionary(text: string, entries: Pick<VoiceDictionaryEntry, 'kind' | 'phrase' | 'replacement'>[]): string {
  let out = text;
  const subs = entries
    .filter((e) => (e.kind === 'replace' || e.kind === 'snippet') && e.phrase.trim())
    .sort((a, b) => b.phrase.length - a.phrase.length);
  for (const e of subs) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(e.phrase.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_m, lead: string) => `${lead}${e.replacement}`);
  }
  // Palabras del diccionario: si se transcribió con otra capitalización, queda la guardada.
  for (const e of entries) {
    if (e.kind !== 'word' || !e.phrase.trim()) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(e.phrase.trim())}(?=$|[^\\p{L}\\p{N}])`, 'giu');
    out = out.replace(re, (_m, lead: string) => `${lead}${e.phrase.trim()}`);
  }
  return out;
}

/** Mayúscula al principio de cada oración y punto final si falta. */
export function finishSentences(text: string): string {
  let out = text.trim();
  if (!out) return out;
  out = out.replace(/(^|[.!?]\s+|\n\s*)(\p{Ll})/gu, (_m, lead: string, ch: string) => `${lead}${ch.toLocaleUpperCase()}`);
  const lastLine = out.split('\n').pop() ?? '';
  if (!/^(?:\d+\.|-)\s/.test(lastLine) && !/[.!?…:;)"'»]$/.test(out)) out += '.';
  return out;
}

/**
 * Frases que los modelos de transcripción inventan cuando hay silencio o ruido (vienen de los
 * subtítulos con los que se entrenaron). Las de créditos se sacan donde estén; las de despedida,
 * solo si son todo el texto (alguien las puede decir de verdad).
 */
const HALLUCINATED_ANYWHERE: RegExp[] = [
  /MBC\s*뉴스\s*\S+입니다\.?/gu,
  /(?:subt[ií]tulos|subtitles|legendas|sous-titres)\b[^.\n]{0,60}\bamara\.org\b[^.\n]{0,30}\.?/giu,
  /字幕由\s*Amara\.org\s*社[区區]提供/gu,
  /시청해\s*주셔서 감사합니다\.?/gu,
  /ご視聴ありがとうございました。?/gu,
];
const HALLUCINATED_WHOLE = /^(?:thanks? (?:you )?for watching[.!]?|gracias por ver(?: el video)?[.!]?|obrigado por assistir[.!]?|\.+|you)$/iu;

export function stripHallucinations(text: string): string {
  let out = text;
  for (const re of HALLUCINATED_ANYWHERE) out = out.replace(re, ' ');
  out = out.replace(/[ \t]{2,}/g, ' ').trim();
  return HALLUCINATED_WHOLE.test(out) ? '' : out;
}

/**
 * Limpieza completa por reglas. `context` (de dónde se dicta) decide si se
 * acomoda como mail; un chat queda como se dijo.
 */
export function ruleCleanup(
  raw: string,
  entries: Pick<VoiceDictionaryEntry, 'kind' | 'phrase' | 'replacement'>[] = [],
  opts: { context?: VoiceContext; language?: string } = {},
): string {
  let t = raw.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = removeFillers(t, { language: opts.language });
  t = applyBacktrack(t);
  t = joinSpokenAddresses(t);
  t = applySpokenPunctuation(t);
  t = formatNumberedMarkers(t);
  t = formatSpokenList(t);
  t = formatInlineList(t);
  t = applyDictionary(t, entries);
  t = finishSentences(t);
  return formatEmailLayout(t, opts.context);
}
