import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { voiceAuth } from '@/lib/voice-route';
import { meetingLabels, voiceErrorResponse, voiceJsonError, voiceMessages } from '@/lib/voice-http';
import { getSessionDetail, saveEnhanced, saveVoiceSettings } from '@/lib/voice';
import { logMeetingToContact, meetingMarkdown, sendToDocs, sendToNotes, tasksToCrm, tasksToTrack } from '@/lib/voice-integrations';
import { sessionScope } from '@/lib/crm-visibility';
import { notionPageId, sendToNotion, sendToSlack, shareLinkFor, VoiceSendError } from '@/lib/voice-send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  target: z.enum(['docs', 'notes', 'track', 'crm', 'contact', 'markdown', 'slack', 'notion']),
  /** Slack: canal público. */
  channelId: z.string().max(40).optional(),
  /** Notion: página padre (URL o id) y credencial de Flow. */
  parent: z.string().max(400).optional(),
  credentialId: z.string().max(64).optional(),
  locale: z.string().max(5).optional(),
  items: z.array(z.string().max(500)).max(40).optional(),
  projectId: z.string().max(64).optional(),
  /** Docs: sumar la transcripción a la página (la ve todo el workspace). Por defecto no. */
  includeTranscript: z.boolean().optional(),
  /** Docs: si no hay teamspace privado posible, crear la página a la vista de todo el workspace (confirmado en la UI). */
  allowWorkspace: z.boolean().optional(),
});

/**
 * Mandar la reunión a otra app: docs | notes (página o nota nueva), track
 * (issues con los próximos pasos elegidos), crm (tareas), contact (actividad
 * en el timeline del contacto vinculado), markdown (para copiar), slack
 * (un canal público con la app de Slack del workspace) o notion (página hija
 * con una credencial de Notion de Flow). La transcripción no va a Slack ni a
 * Notion.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const auth = await voiceAuth({ bucket: 'send', limit: 30 });
  if (auth.res) return auth.res;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return voiceJsonError(400, 'invalid_input');
  const { target, items = [], projectId } = parsed.data;
  const locale = parsed.data.locale ?? 'en';
  const labels = meetingLabels(locale);
  const d = await getSessionDetail(auth.owner, id);
  if (!d || d.kind !== 'meeting') return voiceJsonError(404, 'not_found');
  try {
    if (target === 'markdown') return NextResponse.json({ markdown: meetingMarkdown(d, labels, { transcript: true }) });
    if (target === 'docs') return NextResponse.json(await sendToDocs(auth.owner, d, labels, { includeTranscript: parsed.data.includeTranscript, allowWorkspace: parsed.data.allowWorkspace }), { status: 201 });
    if (target === 'notes') return NextResponse.json(await sendToNotes(auth.owner, d, labels), { status: 201 });
    if (target === 'slack') {
      const channelId = parsed.data.channelId ?? '';
      if (!/^[A-Z0-9_]{1,40}$/.test(channelId)) return voiceJsonError(400, 'invalid_input');
      const link = await shareLinkFor(d.id, new URL(req.url).origin, locale);
      const res = await sendToSlack({ workspaceId: auth.owner.workspaceId, channelId, detail: d, labels, link });
      await saveVoiceSettings(auth.owner, { slackChannel: channelId });
      return NextResponse.json({ ok: true, ...res }, { status: 201 });
    }
    if (target === 'notion') {
      const res = await sendToNotion({
        workspaceId: auth.owner.workspaceId,
        credentialId: parsed.data.credentialId ?? '',
        parent: parsed.data.parent ?? '',
        detail: d,
        labels,
      });
      await saveVoiceSettings(auth.owner, { notionParent: notionPageId(parsed.data.parent ?? '') ?? '', notionCredentialId: parsed.data.credentialId ?? '' });
      return NextResponse.json({ ok: true, ...res }, { status: 201 });
    }
    const scope = await sessionScope(auth.user);
    if (target === 'contact') {
      const res = await logMeetingToContact({ owner: auth.owner, scope, detail: d, labels });
      if (!res.ok) return voiceJsonError(404, res.code);
      return NextResponse.json(res, { status: 201 });
    }
    // Los próximos pasos se mandan una vez por destino: un segundo clic devuelve lo ya creado.
    const already = d.enhanced?.sent?.[target];
    if (already?.length) return NextResponse.json({ ok: true, created: already, already: true });
    const meetingUrl = `${new URL(req.url).origin}/${locale}/app/voice/meetings/${d.id}`;
    const res =
      target === 'track'
        ? await tasksToTrack({
            owner: auth.owner,
            teamId: auth.user.team?.id ?? null,
            projectId: projectId ?? '',
            items,
            meetingTitle: d.title || labels.fromVoice,
            meetingUrl,
            fromLabel: voiceMessages(locale).export.fromMeeting,
          })
        : await tasksToCrm({
            owner: auth.owner,
            scope,
            contactId: d.contactId,
            items,
            body: `${voiceMessages(locale).export.fromMeeting}: ${d.title || labels.fromVoice} (${meetingUrl})`,
          });
    if (!res.ok) return voiceJsonError(res.code === 'nothing_to_send' ? 400 : 404, res.code);
    if (d.enhanced) await saveEnhanced(d.id, { ...d.enhanced, sent: { ...(d.enhanced.sent ?? {}), [target]: res.created } });
    return NextResponse.json(res, { status: 201 });
  } catch (err) {
    if (err instanceof VoiceSendError) return voiceJsonError(err.code.endsWith('_failed') ? 502 : 409, err.code);
    return voiceErrorResponse(err);
  }
}
