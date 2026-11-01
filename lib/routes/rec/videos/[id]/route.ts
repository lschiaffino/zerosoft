import { after, NextRequest } from 'next/server';
import { resummarizeForTrim } from '@/lib/rec-ai';
import { recAiForcedOff } from '@/lib/rec-ai-flags';
import { z } from 'zod';
import { deleteVideo, getVideoRow, toDto, updateVideo } from '@/lib/rec';
import { recAudit } from '@/lib/rec-admin';
import { recActor, recFail, recJson } from '@/lib/rec-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const v = await getVideoRow(s.actor, id);
  if (!v) return recJson({ error: 'not_found' }, 404);
  return recJson({ video: toDto(v, s.actor) });
}

const patchSchema = z
  .object({
    title: z.string().max(200),
    description: z.string().max(5000),
    summary: z.string().max(5000),
    chaptersText: z.string().max(10_000),
    folderId: z.string().max(60).nullable(),
    space: z.enum(['personal', 'workspace']),
    spaceId: z.string().max(60).nullable(),
    privacy: z.enum(['link', 'workspace', 'people']),
    allowedEmails: z.array(z.string().max(254)).max(200),
    requireEmail: z.boolean(),
    archived: z.boolean(),
    overlays: z.array(z.unknown()).max(100),
    password: z.string().max(200).nullable(),
    expiresAt: z.string().max(40).nullable(),
    allowDownload: z.boolean(),
    allowComments: z.boolean(),
    notify: z.boolean(),
    ctaLabel: z.string().max(60),
    ctaUrl: z.string().max(2000),
    ctaMode: z.enum(['always', 'end']),
    trimStart: z.number().min(0).max(86_400),
    trimEnd: z.number().min(0).max(86_400).nullable(),
    commentsRequireAccount: z.boolean(),
    tags: z.array(z.string().max(60)).max(40),
    captionStyle: z.object({ size: z.string().max(10), look: z.string().max(10), position: z.string().max(10) }),
  })
  .partial();

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    await updateVideo(s.actor, id, parsed.data);
    // Quién abrió o cerró un video queda en el registro de actividad (sin título: lo ven los admins).
    const d = parsed.data;
    if (d.privacy !== undefined || d.password !== undefined || d.expiresAt !== undefined || d.allowDownload !== undefined || d.allowedEmails !== undefined) {
      await recAudit(s.actor.ws, s.actor.actor, 'share_change', { video: id, privacy: d.privacy ?? null }).catch(() => undefined);
    }
    if (parsed.data.trimStart !== undefined || parsed.data.trimEnd !== undefined) {
      const forceOff = await recAiForcedOff();
      after(() => resummarizeForTrim(id, { forceOff }));
    }
    const v = await getVideoRow(s.actor, id);
    return recJson({ video: toDto(v!, s.actor) });
  } catch (err) {
    return recFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    await deleteVideo(s.actor, id);
    await recAudit(s.actor.ws, s.actor.actor, 'delete_video', { video: id }).catch(() => undefined);
    return new Response(null, { status: 204 });
  } catch (err) {
    return recFail(err);
  }
}
