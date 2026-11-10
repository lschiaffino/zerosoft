import { NextRequest } from 'next/server';
import { z } from 'zod';
import { getManageableVideo, toDto } from '@/lib/rec';
import { recActor, recFail, recJson, recPeople } from '@/lib/rec-http';
import { recBaseUrl } from '@/lib/rec-page';
import { addPeople, inviteByEmail, listPeople, removePerson, setPersonRole } from '@/lib/rec-share';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** Personas con acceso al video (con rol y si ya miraron) y miembros del workspace para sugerir. Solo quien lo administra. */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  try {
    const members = await recPeople(s.user);
    const people = await listPeople(s.actor, id, members);
    return recJson({ people, members: members.filter((m) => m.id !== s.actor.actor).map((m) => ({ name: m.name, email: m.email })) });
  } catch (err) {
    return recFail(err);
  }
}

const addSchema = z.object({
  emails: z.array(z.string().max(254)).min(1).max(100),
  role: z.enum(['viewer', 'commenter']),
  notify: z.boolean().optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
});

/** Invitar por email (miembros del workspace o de afuera). Con aviso: mail con link mágico. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    const { added, video } = await addPeople(s.actor, id, parsed.data.emails, parsed.data.role);
    const members = await recPeople(s.user);
    let sent = 0;
    if (parsed.data.notify !== false && added.length && video.status === 'ready') {
      sent = await inviteByEmail(s.actor, video, added, { base: recBaseUrl(), locale: parsed.data.locale ?? 'en', members });
    }
    const people = await listPeople(s.actor, id, members);
    return recJson({ people, added, sent, video: toDto(await getManageableVideo(s.actor, id), s.actor) }, 201);
  } catch (err) {
    return recFail(err);
  }
}

const roleSchema = z.object({ email: z.string().max(254), role: z.enum(['viewer', 'commenter']) });

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const parsed = roleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return recJson({ error: 'invalid_input' }, 400);
  try {
    await setPersonRole(s.actor, id, parsed.data.email, parsed.data.role);
    return recJson({ people: await listPeople(s.actor, id, await recPeople(s.user)) });
  } catch (err) {
    return recFail(err);
  }
}

/** Sacar a una persona: pierde el acceso al toque (página, archivos y comentarios). */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const s = await recActor();
  if ('res' in s) return s.res;
  const { id } = await ctx.params;
  const email = req.nextUrl.searchParams.get('email') ?? '';
  if (!email || email.length > 254) return recJson({ error: 'invalid_input' }, 400);
  try {
    await removePerson(s.actor, id, email);
    return recJson({ people: await listPeople(s.actor, id, await recPeople(s.user)), video: toDto(await getManageableVideo(s.actor, id), s.actor) });
  } catch (err) {
    return recFail(err);
  }
}
