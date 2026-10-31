/**
 * Chat — temas y CX score sin modelo: temas por frecuencia de palabras en lo
 * que escriben los visitantes y un puntaje de experiencia calculado con la
 * primera respuesta, si se resolvió, si volvió a abrirse y el CSAT.
 * Server-only.
 */
import { getDb } from './db';
import { normalizeForMatch, tokenize } from './chat-data';
import type { ReportRange } from './chat-inbox';

export interface InsightTopic {
  term: string;
  conversations: number;
}

export interface ChatInsights {
  analyzed: number;
  /** 0 a 100, null sin datos. */
  cxScore: number | null;
  topics: InsightTopic[];
}

interface ScoreInput {
  firstResponseMinutes: number | null;
  resolved: boolean;
  csat: number | null;
}

/** Con CSAT manda el CSAT (1 a 5 → 0 a 100); sin CSAT, velocidad y resolución. */
export function conversationCxScore(c: ScoreInput): number {
  if (c.csat != null) return Math.round(((c.csat - 1) / 4) * 100);
  const m = c.firstResponseMinutes;
  const speed = m == null ? 0 : m <= 5 ? 50 : m <= 60 ? 40 : m <= 240 ? 25 : 10;
  return speed + (c.resolved ? 50 : 20);
}

const STOP = new Set('hola gracias buenas buenos dias tardes noches quiero tengo puedo necesito ayuda como cuando donde para pero porque esta este esto estoy hello thanks please help need want have with this that what when where from your about would could obrigado obrigada ola preciso quero tenho voces voce para com uma isso'.split(' '));

/** Pura: cuenta cada palabra una vez por conversación. */
export function topTopics(texts: string[], limit = 12): InsightTopic[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const words = new Set(tokenize(normalizeForMatch(text)).filter((w) => w.length >= 4 && !STOP.has(w) && !/^\d+$/.test(w)));
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, conversations]) => ({ term, conversations }));
}

export async function getChatInsights(widgetIds: string[], range: ReportRange): Promise<ChatInsights> {
  if (widgetIds.length === 0) return { analyzed: 0, cxScore: null, topics: [] };
  const marks = widgetIds.map(() => '?').join(', ');
  const rows = (await getDb()
    .prepare(
      `SELECT c.created_at, c.first_response_at, c.resolved_at, c.csat_score,
         (SELECT GROUP_CONCAT(substr(m.body, 1, 300), ' ') FROM chat_messages m WHERE m.conversation_id = c.id AND m.sender_type = 'visitor' AND m.deleted_at IS NULL) AS text
       FROM chat_conversations c
       WHERE c.widget_id IN (${marks}) AND c.created_at >= ? AND c.created_at <= ?
       ORDER BY c.created_at DESC LIMIT 2000`,
    )
    .all(...widgetIds, range.from, range.to)) as Array<{ created_at: string; first_response_at: string | null; resolved_at: string | null; csat_score: number | null; text: string | null }>;
  const ms = (v: string) => Date.parse(v.includes('T') ? v : `${v.replace(' ', 'T')}Z`);
  const scores = rows.map((r) =>
    conversationCxScore({
      firstResponseMinutes: r.first_response_at ? (ms(r.first_response_at) - ms(r.created_at)) / 60_000 : null,
      resolved: Boolean(r.resolved_at),
      csat: r.csat_score == null ? null : Number(r.csat_score),
    }),
  );
  return {
    analyzed: rows.length,
    cxScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    topics: topTopics(rows.map((r) => r.text ?? '')),
  };
}
