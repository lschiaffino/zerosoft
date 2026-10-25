import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { claimRecorder, closeRecording, deleteSession, getSessionDetail, getSessionRow, saveEnhanced, saveMyNotes, updateSession } from '@/lib/voice';
import { queueNoteAfterResponse } from '@/lib/voice-jobs';
import { renameSpeakersInNote } from '@/lib/voice-speakers';
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
  /** Con status "done": armar la nota con IA en segundo plano (default sí). */
  queueNotes: z.boolean().optional(),
  /** Con status "recording": id de la pestaña que graba (claim de la grabación). */
  recorderId: z.string().min(8).max(64).optional(),
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
    if (p.status === 'recording') {
      // Una sola pestaña o dispositivo graba cada reunión (compare-and-set con latido).
      if (!p.recorderId) return voiceJsonError(400, 'invalid_input');
      if (!(await claimRecorder(id, p.recorderId))) return voiceJsonError(409, 'recording_elsewhere');
    }
    if (p.speakers) {
      // Renombrar a quien habla también cambia la nota con IA ya armada.
      const before = await getSessionDetail(auth.owner, id);
      const renamed = renameSpeakersInNote(before?.enhanced ?? null, before?.speakers ?? {}, p.speakers, row.locale);
      if (renamed) await saveEnhanced(id, renamed);
    }
    await updateSession(auth.owner, id, {
      title: p.title,
      status: undefined,
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
    if (p.status === 'done') {
      // Cortar la grabación cierra la sesión y deja la nota con IA en cola (se arma después de responder).
      const res = await closeRecording(id, { queueNotes: p.queueNotes !== false });
      if (res.queued) await queueNoteAfterResponse(id);
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
