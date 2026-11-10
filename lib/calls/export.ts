/**
 * Calls: exportar una llamada (Markdown, texto, WebVTT o JSON) y la
 * biblioteca (CSV). Puro salvo los tipos.
 */
import { clock } from './types';
import { toVtt, transcriptLines } from './metrics';
import type { CallDetail, CallListItem } from './core';

export type ExportFormat = 'md' | 'txt' | 'vtt' | 'json';

export interface ExportLabels {
  summary: string;
  nextSteps: string;
  topics: string;
  questions: string;
  objections: string;
  competitors: string;
  scorecard: string;
  transcript: string;
  duration: string;
  date: string;
}

export function exportCall(d: CallDetail, format: ExportFormat, l: ExportLabels): { body: string; mime: string; ext: string } {
  if (format === 'vtt') return { body: toVtt(d.transcript, d.speakers), mime: 'text/vtt; charset=utf-8', ext: 'vtt' };
  if (format === 'json') {
    const body = JSON.stringify(
      {
        id: d.id,
        title: d.title,
        startedAt: d.startedAt,
        durationMs: d.durationMs,
        owner: d.ownerName,
        deal: d.deal,
        attendees: d.attendees,
        speakers: d.speakers,
        transcript: d.transcript.map((u) => ({ speaker: u.s, text: u.t, startMs: u.a, endMs: u.b })),
        analysis: d.analysis,
        metrics: d.metrics,
        comments: d.comments.map((c) => ({ author: c.authorName, atMs: c.atMs, body: c.body, createdAt: c.createdAt })),
        clips: d.clips.map((c) => ({ title: c.title, startMs: c.startMs, endMs: c.endMs })),
      },
      null,
      2,
    );
    return { body, mime: 'application/json; charset=utf-8', ext: 'json' };
  }
  const lines = transcriptLines(d.transcript, d.speakers);
  if (format === 'txt') return { body: [d.title, '', ...lines, ''].join('\n'), mime: 'text/plain; charset=utf-8', ext: 'txt' };
  const a = d.analysis;
  const out: string[] = [`# ${d.title}`, '', `${l.date}: ${(d.startedAt ?? d.at).slice(0, 16).replace('T', ' ')} · ${l.duration}: ${clock(d.durationMs)}`, ''];
  if (a) {
    if (a.summary) out.push(`## ${l.summary}`, '', a.summary, '');
    if (a.nextSteps.length) out.push(`## ${l.nextSteps}`, '', ...a.nextSteps.map((n) => `- [ ] ${n.text}${n.owner ? ` (${n.owner}${n.due ? `, ${n.due}` : ''})` : ''}`), '');
    if (a.topics.length) out.push(`## ${l.topics}`, '', ...a.topics.map((t) => `- ${clock(t.startMs)} ${t.name}`), '');
    if (a.questions.length) out.push(`## ${l.questions}`, '', ...a.questions.map((q) => `- ${clock(q.atMs)} ${q.text}`), '');
    if (a.objections.length) out.push(`## ${l.objections}`, '', ...a.objections.map((o) => `- ${clock(o.atMs)} ${o.text}${o.response ? ` → ${o.response}` : ''}`), '');
    if (a.competitors.length) out.push(`## ${l.competitors}`, '', ...a.competitors.map((c) => `- ${clock(c.atMs)} ${c.name}: ${c.quote}`), '');
    if (a.scorecard.items.length) out.push(`## ${l.scorecard} (${a.scorecard.total}%)`, '', ...a.scorecard.items.map((i) => `- ${i.label}: ${i.score}/5. ${i.evidence}`), '');
  }
  out.push(`## ${l.transcript}`, '', ...lines, '');
  return { body: out.join('\n'), mime: 'text/markdown; charset=utf-8', ext: 'md' };
}

function csvCell(v: string | number | null): string {
  const s = v === null ? '' : String(v);
  // Fórmulas: una celda que empieza con =, +, - o @ se abre como texto.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function libraryCsv(items: CallListItem[]): string {
  const head = ['id', 'title', 'date', 'owner', 'duration_min', 'deal', 'status', 'talk_ratio', 'summary'];
  const rows = items.map((c) => [c.id, c.title, c.at, c.ownerName, Math.round(c.durationMs / 60_000), c.deal?.name ?? '', c.status, c.talkRatio === null ? '' : Math.round(c.talkRatio * 100), c.summary]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
