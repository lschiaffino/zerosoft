import { NextRequest, NextResponse } from 'next/server';
import en from '@/messages/en/calls.json';
import es from '@/messages/es/calls.json';
import pt from '@/messages/pt/calls.json';
import { getCallDetail } from '@/lib/calls/core';
import { exportCall, type ExportFormat } from '@/lib/calls/export';
import { callsActor, cFail, contentDisposition } from '@/lib/calls/http';
import { sessionScope } from '@/lib/crm-visibility';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FORMATS: ExportFormat[] = ['md', 'txt', 'vtt', 'json'];

/** GET ?format=md|txt|vtt|json&locale=: la llamada (resumen, análisis y transcripción) para bajar. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const a = await callsActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const sp = req.nextUrl.searchParams;
    const format = (FORMATS as string[]).includes(sp.get('format') ?? '') ? (sp.get('format') as ExportFormat) : 'md';
    const msgs = { en, es, pt }[sp.get('locale') ?? ''] ?? en;
    const t = (k: keyof typeof en.call) => String(msgs.call[k]);
    const d = await getCallDetail(a.actor, id, await sessionScope(a.user));
    const out = exportCall(d, format, {
      summary: t('summary'),
      nextSteps: t('nextSteps'),
      topics: t('topics'),
      questions: t('questions'),
      objections: t('objections'),
      competitors: t('competitors'),
      scorecard: t('scorecard'),
      transcript: t('transcript'),
      duration: t('duration'),
      date: t('date'),
    });
    const name = `${(d.title || 'call').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80)}.${out.ext}`;
    return new NextResponse(out.body, { headers: { 'content-type': out.mime, 'content-disposition': contentDisposition('attachment', name), 'cache-control': 'private, no-store' } });
  } catch (err) {
    return cFail(err);
  }
}
