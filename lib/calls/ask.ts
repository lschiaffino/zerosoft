/**
 * Calls: "preguntale a tus llamadas". Busca las llamadas que hablan de lo
 * preguntado (palabras de la pregunta en el título, el resumen o la
 * transcripción), toma las mejores ocho con sus fragmentos y le pide la
 * respuesta a la IA citando cada llamada. Solo llamadas que la persona ve.
 */
import { getDb } from '../db';
import { askAcross, type AskSource } from './ai';
import { getSettings } from './settings';
import { clock, parseJson, type CallAnalysis, type CallsActor, type Speaker, type Utterance } from './types';

const STOP = new Set(
  'what which when where who whom whose why how does did have has had with from that this there their about into over than then them they were will would could should your our you are was the and for not but all any can may per que qué cual cuál cuando cuándo donde dónde quien quién como cómo para por con una uno unos unas los las del ellos ellas este esta esto sus son fue fueron hay mas más sobre entre desde hasta nos nuestros nuestras quais quando onde quem como para com uma umas uns dos das isso essa esse foram eles elas nosso nossa sobre'.split(
    ' ',
  ),
);

export function keywordsOf(question: string): string[] {
  const words = question
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  return [...new Set(words)].slice(0, 6);
}

export async function askAllCalls(actor: CallsActor, question: string, locale: string): Promise<{ answer: string; sources: AskSource[] }> {
  const settings = await getSettings(actor.ws);
  const words = keywordsOf(question);
  const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const match = words.length ? `AND (${words.map(() => `(c.title LIKE ? ESCAPE '\\' OR c.transcript_text LIKE ? ESCAPE '\\' OR c.analysis LIKE ? ESCAPE '\\')`).join(' OR ')})` : '';
  const rows = (await getDb()
    .prepare(
      `SELECT c.id, c.title, COALESCE(c.started_at, c.created_at) AS at, c.analysis, c.transcript, c.speakers, u.name AS owner
       FROM calls c LEFT JOIN users u ON u.id = c.owner_id
       WHERE c.workspace_id = ? AND c.deleted_at IS NULL AND c.status = 'ready' AND (? = 1 OR c.owner_id = ? OR ? = 'team') ${match}
       ORDER BY at DESC LIMIT 40`,
    )
    .all(actor.ws, actor.admin ? 1 : 0, actor.person, settings.visibility, ...words.flatMap((w) => [like(w), like(w), like(w)]))) as Array<{
    id: string;
    title: string;
    at: string;
    analysis: string | null;
    transcript: string | null;
    speakers: string;
    owner: string | null;
  }>;
  const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const scored = rows
    .map((r) => {
      const utterances = parseJson<Utterance[]>(r.transcript, []);
      const speakers = new Map(parseJson<Speaker[]>(r.speakers, []).map((s) => [s.id, s.name]));
      const hits = utterances.filter((u) => words.some((w) => norm(u.t).includes(w)));
      const analysis = parseJson<CallAnalysis | null>(r.analysis, null);
      const score = hits.length + (words.some((w) => norm(r.title).includes(w)) ? 3 : 0) + (analysis && words.some((w) => norm(analysis.summary).includes(w)) ? 2 : 0);
      return {
        score,
        call: {
          id: r.id,
          title: r.title,
          at: r.at,
          owner: r.owner ?? '',
          summary: analysis?.summary ?? '',
          snippets: hits.slice(0, 6).map((u) => `[${clock(u.a)}] ${speakers.get(u.s) ?? ''}: ${u.t.slice(0, 400)}`),
        },
      };
    })
    .filter((x) => !words.length || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (!scored.length) return { answer: '', sources: [] };
  const answer = await askAcross({ ws: actor.ws, question, calls: scored.map((s) => s.call), locale });
  return { answer, sources: scored.map((s) => ({ id: s.call.id, title: s.call.title, at: s.call.at })) };
}
