import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { deleteSession, getSessionDetail, getSessionRow, saveMyNotes, updateSession } from '@/lib/voice';
import { voiceAuth } from '@/lib/voice-route';
import { voiceErrorResponse, voiceJsonError } from '@/lib/voice-http';
import { canSeeEntity, sessionScope } from '@/lib/crm-visibility';
import { contactLabel } from '@/lib/voice-integrations';
import { VOICE_NOTES_MAX, VOICE_TITLE_MAX } from '@/lib/voice-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth();
  if (auth.res) return auth.res;
  const detail = await getSessionDetail(auth.owner, id);
  if (!detail) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ...detail, contact: await contactLabel(auth.owner.workspaceId, detail.contactId) });
}

const patchSchema = z.object({
  title: z.string().max(VOICE_TITLE_MAX).optional(),
  status: z.enum(['recording', 'done']).optional(),
  text: z.string().max(VOICE_NOTES_MAX).optional(),
  myNotes: z.string().max(VOICE_NOTES_MAX).optional(),
  templateKey: z.string().max(64).optional(),
  capture: z.enum(['mic', 'mic_tab', 'file', 'desktop']).optional(),
  contactId: z.string().max(64).nullable().optional(),
  calBookingId: z.null().optional(),
  speakers: z.record(z.string().max(40), z.string().max(80)).optional(),
});

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write', limit: 240 });
  if (auth.res) return auth.res;
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const row = await getSessionRow(auth.owner, id);
  if (!row) return voiceJsonError(404, 'not_found');
  const p = parsed.data;
  try {
    if (p.contactId) {
      if (!(await canSeeEntity(auth.owner.workspaceId, 'contact', p.contactId, await sessionScope(auth.user)))) {
        return voiceJsonError(404, 'contact_not_found');
      }
    }
    if (p.myNotes !== undefined) {
      if (row.kind !== 'meeting') return voiceJsonError(400, 'invalid_input');
      await saveMyNotes(id, p.myNotes);
    }
    await updateSession(auth.owner, id, {
      title: p.title,
      status: p.status,
      text: row.kind === 'dictation' ? p.text : undefined,
      templateKey: p.templateKey,
      contactId: p.contactId,
      calBookingId: p.calBookingId,
      speakers: p.speakers,
      // Si cambia el contacto, la próxima nota crea una actividad nueva en su timeline.
      crmActivityId: p.contactId !== undefined && p.contactId !== row.contact_id ? null : undefined,
    });
    if (p.capture) {
      const { getDb } = await import('@/lib/db');
      await getDb().prepare('UPDATE voice_sessions SET capture = ? WHERE id = ?').run(p.capture, id);
    }
    const detail = await getSessionDetail(auth.owner, id);
    return NextResponse.json({ ...detail, contact: await contactLabel(auth.owner.workspaceId, detail?.contactId ?? null) });
  } catch (err) {
    return voiceErrorResponse(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'write' });
  if (auth.res) return auth.res;
  if (!(await deleteSession(auth.owner, id))) return voiceJsonError(404, 'not_found');
  return NextResponse.json({ ok: true });
}
