/**
 * Voice, analítica con el kit (el formato de Lines): las reuniones y los
 * dictados de quien mira (Voice es privado de cada persona), cuánto grabó,
 * cuántas palabras dictó y a qué ritmo, cuándo y en qué apps, en un período
 * contra el anterior.
 *
 * Solo números y los títulos de sus propias reuniones: nunca el texto de un
 * dictado ni de una transcripción. Las grabaciones con error no cuentan.
 */
import { getDb } from './db';
import type { VoiceOwner } from './voice';
import { appOf } from './voice-library';
import { heatAdd, stampMs } from './analytics-kit/stamps';
import { analyticsRange, daySeries, rangeInfo, localDay, type AnalyticsRange, type Kpi, type RangeInfo, type RangeInput } from './analytics-kit/period';
import { shortCache } from './analytics-kit/cache';

export type VoiceKindFilter = 'meeting' | 'dictation';

export interface VoiceSessionIn {
  id: string;
  kind: VoiceKindFilter;
  title: string;
  /** Nombre corto de la app donde se dictó (appOf), o 'desktop'. */
  app: string;
  duration_ms: number;
  words: number;
  /** La nota con IA quedó hecha. */
  notes: boolean;
  /** Vinculada a una reserva de Cal o a un contacto del CRM. */
  linked: boolean;
  at: number;
}

export interface VoiceDay {
  day: string;
  meetings: number;
  dictations: number;
}

export interface VoiceAppStat {
  app: string;
  dictations: number;
  words: number;
  prevWords: number;
}

export interface VoiceMeetingStat {
  id: string;
  title: string;
  at: number;
  minutes: number;
  words: number;
  notes: boolean;
  linked: boolean;
}

export interface VoiceAnalytics {
  range: RangeInfo;
  kpis: { meetings: Kpi; meetingMinutes: Kpi; dictations: Kpi; words: Kpi; wpm: Kpi; notes: Kpi };
  perDay: VoiceDay[];
  heat: number[][];
  apps: VoiceAppStat[];
  meetings: VoiceMeetingStat[];
  /** Grabaciones de la persona (cualquier fecha): sin ninguna, el vacío invita a empezar. */
  sessionCount: number;
}

/** Palabras por minuto (null sin tiempo dictado). */
const rate = (words: number, ms: number) => (ms >= 1000 ? Math.round(words / (ms / 60_000)) : null);

/** Agrega lo leído (puro: lo prueban los tests). `kind` deja solo reuniones o solo dictados. */
export function aggregateVoice(range: AnalyticsRange, sessions: VoiceSessionIn[], sessionCount: number, kind?: VoiceKindFilter): VoiceAnalytics {
  const since = Date.parse(range.since);
  const until = Date.parse(range.until);
  const prevSince = Date.parse(range.prevSince);
  const byDay = new Map<string, Omit<VoiceDay, 'day'>>();
  const heat = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const apps = new Map<string, VoiceAppStat>();
  const meetings: VoiceMeetingStat[] = [];
  const c = { meetings: 0, meetingMs: 0, dictations: 0, words: 0, dictMs: 0, notes: 0 };
  const p = { meetings: 0, meetingMs: 0, dictations: 0, words: 0, dictMs: 0, notes: 0 };
  for (const s of sessions) {
    if ((kind && s.kind !== kind) || !(s.at >= prevSince && s.at < until)) continue;
    const day = localDay(s.at, range.tz);
    const v = byDay.get(day) ?? { meetings: 0, dictations: 0 };
    if (s.kind === 'meeting') v.meetings += 1;
    else v.dictations += 1;
    byDay.set(day, v);
    const cur = s.at >= since;
    const acc = cur ? c : p;
    if (s.kind === 'meeting') {
      acc.meetings += 1;
      acc.meetingMs += s.duration_ms;
      if (s.notes) acc.notes += 1;
    } else {
      acc.dictations += 1;
      acc.words += s.words;
      acc.dictMs += s.duration_ms;
      const a = apps.get(s.app) ?? { app: s.app, dictations: 0, words: 0, prevWords: 0 };
      if (cur) {
        a.dictations += 1;
        a.words += s.words;
      } else a.prevWords += s.words;
      apps.set(s.app, a);
    }
    if (!cur) continue;
    heatAdd(heat, s.at, range.tz);
    if (s.kind === 'meeting') {
      meetings.push({ id: s.id, title: s.title, at: s.at, minutes: Math.round(s.duration_ms / 60_000), words: s.words, notes: s.notes, linked: s.linked });
    }
  }
  const { cur: perDay } = daySeries(range, byDay, () => ({ meetings: 0, dictations: 0 }));
  return {
    range: rangeInfo(range),
    kpis: {
      meetings: { value: c.meetings, prev: p.meetings },
      meetingMinutes: { value: Math.round(c.meetingMs / 60_000), prev: Math.round(p.meetingMs / 60_000) },
      dictations: { value: c.dictations, prev: p.dictations },
      words: { value: c.words, prev: p.words },
      wpm: { value: rate(c.words, c.dictMs), prev: rate(p.words, p.dictMs) },
      notes: { value: c.notes, prev: p.notes },
    },
    perDay,
    heat,
    apps: [...apps.values()].filter((a) => a.words + a.dictations > 0).sort((a, b) => b.words - a.words || b.dictations - a.dictations || a.app.localeCompare(b.app)),
    meetings: meetings.sort((a, b) => b.at - a.at).slice(0, 50),
    sessionCount,
  };
}

/** La analítica de Voice de quien mira (solo sus grabaciones). */
export async function voiceAnalytics(owner: VoiceOwner, kind: VoiceKindFilter | undefined, query: RangeInput = {}, now = new Date()): Promise<VoiceAnalytics> {
  const range = analyticsRange(query, now);
  const db = getDb();
  const from = new Date(Date.parse(range.prevSince) - 86_400_000).toISOString();
  const [rows, count] = await Promise.all([
    db
      .prepare(
        `SELECT id, kind, title, capture, source_app, duration_ms, words, notes_status, cal_booking_id, contact_id, started_at FROM voice_sessions
         WHERE workspace_id = ? AND person_id = ? AND status != 'error' AND started_at >= ? LIMIT 50000`,
      )
      .all(owner.workspaceId, owner.personId, from) as Promise<
      Array<{ id: string; kind: VoiceKindFilter; title: string; capture: string; source_app: string; duration_ms: number; words: number; notes_status: string; cal_booking_id: string | null; contact_id: string | null; started_at: string }>
    >,
    db.prepare("SELECT COUNT(*) AS n FROM voice_sessions WHERE workspace_id = ? AND person_id = ? AND status != 'error'").get(owner.workspaceId, owner.personId) as Promise<{ n: number } | undefined>,
  ]);
  const sessions = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    app: appOf(r.source_app ?? '', r.capture ?? ''),
    duration_ms: Math.max(0, Number(r.duration_ms) || 0),
    words: Math.max(0, Number(r.words) || 0),
    notes: r.notes_status === 'done',
    linked: !!(r.cal_booking_id || r.contact_id),
    at: stampMs(r.started_at),
  }));
  return aggregateVoice(range, sessions, Number(count?.n) || 0, kind);
}

export function isVoiceAnalyticsEmpty(d: VoiceAnalytics): boolean {
  const k = d.kpis;
  return d.sessionCount === 0 || !(k.meetings.value || k.dictations.value || k.meetings.prev || k.dictations.prev);
}

const cache = shortCache<VoiceAnalytics>();

/** Con la caché corta del kit. La clave lleva el workspace, la persona, el tipo y el rango. */
export function cachedVoiceAnalytics(owner: VoiceOwner, kind: VoiceKindFilter | undefined, query: RangeInput = {}): Promise<VoiceAnalytics> {
  const now = new Date();
  const r = analyticsRange(query, now);
  return cache.get(JSON.stringify([owner.workspaceId, owner.personId, kind ?? '', r.since, r.until, r.tz]), () => voiceAnalytics(owner, kind, query, now));
}

export function clearVoiceAnalyticsCache(): void {
  cache.clear();
}
