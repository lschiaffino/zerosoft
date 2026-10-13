/**
 * Búsqueda léxica en memoria (Okapi BM25) sobre piezas de conocimiento:
 * páginas de Docs, canned responses, URLs. La usan el bot AI de Chat
 * (lib/chat-bot-ai.ts) y los agentes (lib/agents.ts). Sin dependencias de DB.
 */

const STOPWORDS = new Set(
  (
    'the and for are but not you your with this that what how can from have has was were will would ' +
    'que los las del por para con una uno unos unas como mas pero sus esta este esto son hay ' +
    'qual quais como mais mas seu sua nao sim uma com para pelo pela dos das isso este esta'
  ).split(' '),
);

export const CHUNK_CHARS = 900;

export function searchTokens(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOPWORDS.has(w));
}

/** Parte un texto en trozos de ~CHUNK_CHARS respetando oraciones. */
export function chunkText(text: string, size = CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    if (current && current.length + s.length + 1 > size) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current} ${s}` : s;
    while (current.length > size * 1.5) {
      chunks.push(current.slice(0, size));
      current = current.slice(size);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

export interface KnowledgeDoc<K extends string = string> {
  kind: K;
  title: string;
  text: string;
  /** Origen opcional (URL, id de página) para citar. */
  source?: string;
}

export interface RankedChunk<K extends string = string> extends KnowledgeDoc<K> {
  score: number;
}

/**
 * Trocea los documentos (título contado doble) y devuelve los `k` trozos más
 * relevantes para `query` con score > 0.
 */
export function rankKnowledge<K extends string>(
  docs: Array<KnowledgeDoc<K> & { chunk?: boolean; titleExtra?: string }>,
  query: string,
  k = 5,
): Array<RankedChunk<K>> {
  const queryTokens = [...new Set(searchTokens(query))];
  if (queryTokens.length === 0 || docs.length === 0) return [];

  const candidates: Array<KnowledgeDoc<K> & { tokens: string[] }> = [];
  for (const d of docs) {
    const titleTokens = searchTokens(`${d.titleExtra ?? ''} ${d.title}`);
    const pieces = d.chunk === false ? [d.text] : chunkText(d.text);
    for (const piece of pieces) {
      candidates.push({
        kind: d.kind,
        title: d.title,
        text: piece,
        source: d.source,
        tokens: [...titleTokens, ...titleTokens, ...searchTokens(piece)],
      });
    }
  }
  if (candidates.length === 0) return [];

  const n = candidates.length;
  const avgdl = candidates.reduce((acc, c) => acc + c.tokens.length, 0) / n || 1;
  const df = new Map<string, number>();
  const tfs = candidates.map((c) => {
    const tf = new Map<string, number>();
    for (const t of c.tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const q of queryTokens) if (tf.has(q)) df.set(q, (df.get(q) ?? 0) + 1);
    return tf;
  });
  const k1 = 1.2;
  const b = 0.75;
  const scored = candidates.map((c, i) => {
    let score = 0;
    for (const q of queryTokens) {
      const f = tfs[i].get(q) ?? 0;
      if (!f) continue;
      const d = df.get(q) ?? 0;
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.tokens.length) / avgdl));
    }
    const out: RankedChunk<K> = { kind: c.kind, title: c.title, text: c.text, score };
    if (c.source) out.source = c.source;
    return out;
  });
  return scored
    .filter((c) => c.score > 0)
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k);
}
