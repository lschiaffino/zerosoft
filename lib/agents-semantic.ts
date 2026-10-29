/**
 * Agents — búsqueda semántica del conocimiento (opt-in por agente:
 * settings.semanticSearch).
 *
 * - Cada pasaje (título + trozo de ~900 caracteres, el mismo troceo que
 *   BM25) se convierte en un embedding (lib/ai.ts → AI Gateway, 256
 *   dimensiones) y se guarda en agent_embeddings por workspace y hash del
 *   texto: un pasaje igual en dos agentes se indexa una vez, y un pasaje que
 *   cambia es otro hash.
 * - Al buscar, la pregunta también se convierte en embedding y el ranking
 *   por similitud (coseno) se fusiona con el de palabras clave (Reciprocal
 *   Rank Fusion). Así "¿cuánto sale?" encuentra la página de precios aunque
 *   no comparta palabras.
 * - Indexa el cron de cada minuto (warmAgentEmbeddings, con claim por agente)
 *   y, al buscar, hasta INLINE_MAX pasajes que falten. Si la AI falla o se
 *   agotó la cuota, la búsqueda sigue con palabras clave.
 * Server-only.
 */
import { createHash } from 'crypto';
import { getDb } from './db';
import { aiEmbedMany, aiEmbeddingModelId, AI_EMBEDDING_DIMENSIONS, type EmbedderFn } from './ai';
import { chunkText, rankKnowledge, searchTokens, type KnowledgeDoc } from './knowledge-search';

export const SEMANTIC_FEATURE = 'agents_embeddings';
const INLINE_MAX = 48;
const CRON_PER_AGENT = 256;
const BATCH = 64;
const MAX_CANDIDATES = 5000;
const RRF_K = 60;

type Doc<K extends string> = KnowledgeDoc<K> & { chunk?: boolean; titleExtra?: string };

export interface Passage<K extends string = string> {
  kind: K;
  title: string;
  text: string;
  source?: string;
  hash: string;
}

export function passageHash(title: string, text: string): string {
  return createHash('sha256').update(`${title}\u0000${text}`).digest('hex').slice(0, 40);
}

/** Pasajes de los documentos, con el mismo troceo que rankKnowledge. */
export function passagesOf<K extends string>(docs: Array<Doc<K>>): Array<Passage<K>> {
  const out: Array<Passage<K>> = [];
  for (const d of docs) {
    const pieces = d.chunk === false ? [d.text] : chunkText(d.text);
    for (const text of pieces) {
      if (!text.trim()) continue;
      out.push({ kind: d.kind, title: d.title, text, ...(d.source ? { source: d.source } : {}), hash: passageHash(d.title, text) });
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}

export function encodeVector(v: number[]): string {
  return Buffer.from(new Float32Array(v).buffer).toString('base64');
}

export function decodeVector(raw: string): Float32Array {
  const buf = Buffer.from(raw, 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/**
 * Embedder determinista para e2e (sin Gateway): palabras (y sus primeras 5
 * letras) a dimensiones por hash. No entiende sinónimos; alcanza para probar
 * el índice y la fusión de punta a punta.
 */
export const fakeEmbedder: EmbedderFn = async (values) => ({
  embeddings: values.map((v) => {
    const vec = new Array<number>(AI_EMBEDDING_DIMENSIONS).fill(0);
    for (const w of searchTokens(v)) {
      for (const t of [w, w.slice(0, 5)]) {
        const h = createHash('md5').update(t).digest();
        vec[h.readUInt16BE(0) % AI_EMBEDDING_DIMENSIONS] += 1;
      }
    }
    return vec;
  }),
  tokens: values.reduce((acc, v) => acc + Math.ceil(v.length / 4), 0),
});

function modelKey(fake: boolean): string {
  return fake ? 'embeddings-fake' : `${aiEmbeddingModelId()}@${AI_EMBEDDING_DIMENSIONS}`;
}

async function loadVectors(workspaceId: string, hashes: string[], model: string): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  const db = getDb();
  for (let i = 0; i < hashes.length; i += 400) {
    const slice = hashes.slice(i, i + 400);
    const rows = (await db
      .prepare(`SELECT hash, vector FROM agent_embeddings WHERE user_id = ? AND model = ? AND hash IN (${slice.map(() => '?').join(', ')})`)
      .all(workspaceId, model, ...slice)) as Array<{ hash: string; vector: string }>;
    for (const r of rows) out.set(r.hash, decodeVector(r.vector));
  }
  return out;
}

async function storeVectors(workspaceId: string, model: string, items: Array<{ hash: string; vector: number[] }>): Promise<void> {
  const db = getDb();
  const ts = new Date().toISOString();
  for (const it of items) {
    await db
      .prepare('INSERT OR IGNORE INTO agent_embeddings (user_id, hash, model, vector, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(workspaceId, it.hash, model, encodeVector(it.vector), ts);
  }
}

/** Indexa pasajes que falten (de a BATCH). Devuelve cuántos se indexaron. */
export async function embedPassages(workspaceId: string, passages: Passage[], opts: { fake?: boolean; max?: number } = {}): Promise<number> {
  const model = modelKey(Boolean(opts.fake));
  const have = await loadVectors(workspaceId, [...new Set(passages.map((p) => p.hash))], model);
  const missing = [...new Map(passages.filter((p) => !have.has(p.hash)).map((p) => [p.hash, p])).values()].slice(0, opts.max ?? CRON_PER_AGENT);
  let done = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const slice = missing.slice(i, i + BATCH);
    const vecs = await aiEmbedMany({
      workspaceId,
      feature: SEMANTIC_FEATURE,
      values: slice.map((p) => `${p.title}\n${p.text}`.slice(0, 6000)),
      fake: opts.fake ? fakeEmbedder : null,
    });
    await storeVectors(workspaceId, model, slice.map((p, j) => ({ hash: p.hash, vector: vecs[j] ?? [] })).filter((x) => x.vector.length));
    done += slice.length;
  }
  return done;
}

/** Cuántos pasajes del agente ya tienen embedding. */
export async function semanticStatus(workspaceId: string, docs: Array<Doc<string>>, opts: { fake?: boolean } = {}): Promise<{ indexed: number; total: number }> {
  const hashes = [...new Set(passagesOf(docs).map((p) => p.hash))];
  const have = await loadVectors(workspaceId, hashes, modelKey(Boolean(opts.fake)));
  return { indexed: have.size, total: hashes.length };
}

/** Fusión de rankings (RRF): cada lista suma 1/(K + puesto). Pura, para tests. */
export function fuseRankings(lists: string[][], k = RRF_K): Map<string, number> {
  const out = new Map<string, number>();
  for (const list of lists) list.forEach((key, i) => out.set(key, (out.get(key) ?? 0) + 1 / (k + i + 1)));
  return out;
}

const keyOf = (p: { title: string; text: string }) => passageHash(p.title, p.text);

/** BM25 + embeddings, fusionados. Si los embeddings fallan, solo BM25. */
export async function hybridRank<K extends string>(
  workspaceId: string,
  docs: Array<Doc<K>>,
  query: string,
  k = 5,
  opts: { fake?: boolean } = {},
): Promise<Array<{ kind: K; title: string; text: string; source?: string; score: number }>> {
  const lexical = rankKnowledge(docs, query, 20);
  const q = query.trim();
  if (!q || docs.length === 0) return lexical.slice(0, k);
  try {
    const passages = passagesOf(docs);
    const model = modelKey(Boolean(opts.fake));
    const vectors = await loadVectors(workspaceId, [...new Set(passages.map((p) => p.hash))], model);
    // Lo que falta: primero lo que ya encontró BM25, después el resto, con tope.
    const lexKeys = new Set(lexical.map(keyOf));
    const missing = [...new Map(passages.filter((p) => !vectors.has(p.hash)).map((p) => [p.hash, p])).values()]
      .sort((a, b) => Number(lexKeys.has(b.hash)) - Number(lexKeys.has(a.hash)))
      .slice(0, INLINE_MAX);
    const vecs = await aiEmbedMany({
      workspaceId,
      feature: SEMANTIC_FEATURE,
      values: [q.slice(0, 2000), ...missing.map((p) => `${p.title}\n${p.text}`.slice(0, 6000))],
      fake: opts.fake ? fakeEmbedder : null,
    });
    const qv = vecs[0];
    if (!qv?.length) return lexical.slice(0, k);
    const fresh = missing.map((p, i) => ({ hash: p.hash, vector: vecs[i + 1] ?? [] })).filter((x) => x.vector.length);
    await storeVectors(workspaceId, model, fresh);
    for (const f of fresh) vectors.set(f.hash, new Float32Array(f.vector));
    const byHash = new Map(passages.map((p) => [p.hash, p]));
    const semantic = [...vectors.entries()]
      .filter(([h]) => byHash.has(h))
      .map(([h, v]) => ({ h, s: cosine(qv, v) }))
      .filter((x) => x.s > 0.2)
      .sort((a, b) => b.s - a.s)
      .slice(0, 20)
      .map((x) => x.h);
    const fused = fuseRankings([lexical.map(keyOf), semantic]);
    return [...fused.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, k)
      .flatMap(([h, score]) => {
        const p = byHash.get(h) ?? lexical.find((l) => keyOf(l) === h);
        if (!p) return [];
        return [{ kind: p.kind, title: p.title, text: p.text, ...(p.source ? { source: p.source } : {}), score }];
      });
  } catch (err) {
    console.warn('[agents-semantic] falling back to keywords', err instanceof Error ? err.message : err);
    return lexical.slice(0, k);
  }
}

/**
 * Cron de cada minuto: indexa el conocimiento de los agentes con búsqueda
 * semántica. Claim por agente (embed_claimed_until, compare-and-set).
 */
export async function warmAgentEmbeddings(opts: { limit?: number; now?: Date } = {}): Promise<number> {
  const db = getDb();
  const now = opts.now ?? new Date();
  const rows = (await db
    .prepare(
      `SELECT id FROM agents WHERE settings LIKE '%"semanticSearch":true%' AND (embed_claimed_until IS NULL OR embed_claimed_until < ?)
       ORDER BY COALESCE(embed_claimed_until, '') ASC LIMIT ?`,
    )
    .all(now.toISOString(), Math.min(Math.max(opts.limit ?? 2, 1), 10))) as Array<{ id: string }>;
  let total = 0;
  const { getAgentRowById, toAgentDto } = await import('./agents');
  const { hasDraft, withDraft } = await import('./agents-draft');
  const { collectAgentKnowledgeDocs } = await import('./agent-tools');
  for (const r of rows) {
    // El claim dura 10 minutos: el próximo pase vuelve a mirar si hay pasajes nuevos.
    const until = new Date(now.getTime() + 10 * 60_000).toISOString();
    const claimed = await db
      .prepare('UPDATE agents SET embed_claimed_until = ? WHERE id = ? AND (embed_claimed_until IS NULL OR embed_claimed_until < ?)')
      .run(until, r.id, now.toISOString());
    if (!claimed.changes) continue;
    const row = await getAgentRowById(r.id);
    if (!row) continue;
    try {
      // Lo publicado y el borrador (el playground prueba el borrador).
      const live = toAgentDto(row);
      const draft = toAgentDto(withDraft(row));
      const docs = [...(await collectAgentKnowledgeDocs(live, row.user_id)), ...(hasDraft(row) ? await collectAgentKnowledgeDocs(draft, row.user_id) : [])];
      total += await embedPassages(row.user_id, passagesOf(docs));
    } catch (err) {
      // Cuota agotada o AI apagada: se reintenta en el próximo claim.
      console.warn('[agents-semantic] warm failed', err instanceof Error ? err.message : err);
    }
  }
  return total;
}
