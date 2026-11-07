import { NextRequest } from 'next/server';
import { deleteLink, linkDto, requireEditLink, updateLink } from '@/lib/send/core';
import { assertNdaTemplate } from '@/lib/send/templates';
import { userCanUseApp } from '@/lib/workspace';
import { linkSchema } from '@/lib/send/schema';
import { parseBody, sendActor, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH: reglas del link, también deshabilitarlo. Cambiar una regla de acceso hace pasar de nuevo a quien ya entró. */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, linkSchema);
    const cur = await requireEditLink(a.actor, id);
    await assertNdaTemplate(a.actor, userCanUseApp(a.user, 'sign'), input.ndaTemplateId, cur.nda_template_id);
    return sJson({ link: linkDto(await updateLink(a.actor, id, input), a.actor) });
  } catch (err) {
    return sFail(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const { id } = await ctx.params;
    await deleteLink(a.actor, id);
    return sJson({ ok: true });
  } catch (err) {
    return sFail(err);
  }
}
