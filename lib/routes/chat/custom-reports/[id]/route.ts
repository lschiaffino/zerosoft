import { NextResponse } from 'next/server';
import { chatError, chatSession, collabError, readBody } from '@/lib/chat-http';
import { deleteSavedReport, getSavedReport, runReport, updateSavedReport } from '@/lib/chat-custom-reports';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** El reporte con su resultado, sobre los widgets que esta persona ve. ?format=csv lo baja. */
export async function GET(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession();
  if (s instanceof NextResponse) return s;
  const report = await getSavedReport(s.ws, id);
  if (!report) return chatError(404, 'not_found');
  const result = await runReport(report, s.widgets.map((w) => w.id));
  if (new URL(req.url).searchParams.get('format') === 'csv') {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const csv = [['group', 'value', 'conversations'].join(','), ...result.rows.map((r) => [esc(r.label || r.key), r.value == null ? '' : Math.round(r.value * 100) / 100, r.conversations].join(','))].join('\n');
    return new NextResponse(csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="chat-report-${report.id.slice(0, 8)}.csv"` },
    });
  }
  return NextResponse.json({ report, result });
}

export async function PATCH(req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  const body = await readBody(req);
  if (!body) return chatError(400, 'invalid_input');
  if (typeof body.widget_id === 'string' && body.widget_id && !s.widgets.some((w) => w.id === body.widget_id)) return chatError(400, 'invalid_input');
  try {
    const report = await updateSavedReport(s.ws, id, body);
    return report ? NextResponse.json(report) : chatError(404, 'not_found');
  } catch (err) {
    return collabError(err);
  }
}

export async function DELETE(_req: Request, props: Ctx) {
  const { id } = await props.params;
  const s = await chatSession({ write: true });
  if (s instanceof NextResponse) return s;
  return (await deleteSavedReport(s.ws, id)) ? NextResponse.json({ ok: true }) : chatError(404, 'not_found');
}
