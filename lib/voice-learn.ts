/**
 * Voice: aprender del historial (como el diccionario de Wispr Flow, que
 * aprende de lo que corregís). Puro: compara el dictado con la versión
 * corregida y devuelve las palabras que cambiaron.
 *
 * - "Zerosof" → "zerosoft": un reemplazo (lo que se oyó → lo que va).
 * - "zerosoft" → "ZeroSoft": solo cambian las mayúsculas: una palabra para
 *   escribir así siempre.
 * Se ignoran los cambios de puntuación, las palabras agregadas o borradas
 * sin reemplazo y los cambios largos (más de tres palabras de cada lado:
 * eso es reescribir, no corregir). Y solo se aprende lo que parece un nombre
 * o un término mal oído: algo con mayúsculas, números o símbolos (ZeroSoft,
 * GPT-5, ana@acme.com), o una palabra de 4 letras o más parecida a la que se
 * oyó ("zerosof" → "zerosoft"). Cambiar "el" por "un" o "reunión" por
 * "llamada" es editar el texto: no se aprende.
 */

export interface LearnedCorrection {
  kind: 'word' | 'replace';
  phrase: string;
  replacement: string;
}

const MAX_RUN = 3;
const MAX_LEARNED = 5;

function tokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}'’._@-]*/gu) ?? [];
}

const strip = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** Diff por palabras (LCS): los tramos donde se sacó algo y se puso otra cosa. */
function replacedRuns(a: string[], b: string[]): Array<{ from: string[]; to: string[] }> {
  const n = a.length;
  const m = b.length;
  if (n * m > 250_000) return [];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const runs: Array<{ from: string[]; to: string[] }> = [];
  let i = 0;
  let j = 0;
  let from: string[] = [];
  let to: string[] = [];
  const flush = () => {
    if (from.length || to.length) runs.push({ from, to });
    from = [];
    to = [];
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      flush();
      i++;
      j++;
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) {
      to.push(b[j++]);
    } else {
      from.push(a[i++]);
    }
  }
  flush();
  return runs;
}

function distance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** ¿Vale la pena aprenderlo? Un término (mayúsculas, números, símbolos) o una palabra mal oída parecida. */
export function looksLearnable(from: string, to: string): boolean {
  if (/[\p{Lu}\p{N}._@-]/u.test(to.replace(/^\p{Lu}/u, '')) || /\p{N}/u.test(to)) return true;
  if (to.length < 4 || from.length < 4) return false;
  const a = from.toLowerCase();
  const b = to.toLowerCase();
  return distance(a, b) / Math.max(a.length, b.length) <= 0.4;
}

export function learnCorrections(before: string, after: string, known: Array<{ kind: string; phrase: string }> = []): LearnedCorrection[] {
  if (!before.trim() || !after.trim() || before === after) return [];
  const have = new Set(known.map((k) => `${k.kind}:${k.phrase.toLowerCase()}`));
  const out: LearnedCorrection[] = [];
  for (const run of replacedRuns(tokens(before), tokens(after))) {
    if (!run.from.length || !run.to.length || run.from.length > MAX_RUN || run.to.length > MAX_RUN) continue;
    const from = strip(run.from.join(' '));
    const to = strip(run.to.join(' '));
    if (!from || !to || from === to || from.length > 60 || to.length > 60) continue;
    // Solo mayúsculas: se aprende si hay mayúsculas por dentro (ZeroSoft, iPhone, GPT), no la primera de una oración.
    if (from.toLowerCase() === to.toLowerCase() ? !/\p{Lu}/u.test(to.slice(1)) : !looksLearnable(from, to)) continue;
    const item: LearnedCorrection =
      from.toLowerCase() === to.toLowerCase() ? { kind: 'word', phrase: to, replacement: '' } : { kind: 'replace', phrase: from, replacement: to };
    const key = `${item.kind}:${item.phrase.toLowerCase()}`;
    if (have.has(key)) continue;
    have.add(key);
    out.push(item);
    if (out.length >= MAX_LEARNED) break;
  }
  return out;
}
