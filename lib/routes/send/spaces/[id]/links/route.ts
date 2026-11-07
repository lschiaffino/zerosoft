import { NextRequest } from 'next/server';
import { createLink, linkDto, listLinks } from '@/lib/send/core';
import { getSpace } from '@/lib/send/spaces';
import { linkSchema } from '@/lib/send/schema';
import { assertNdaTemplate } from '@/lib/send/templates';
import { userCanUseApp } from '@/lib/workspace';
import { parseBody, sendActor, sendLimit, sFail, sJson } from '@/lib/send/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  try {
    const s = await getSpace(a.actor, (await ctx.params).id);
    return sJson({ links: await listLinks(a.actor, { spaceId: s.id }) });
  } catch (err) {
    return sFail(err);
  }
}

/** POST: link nuevo del espacio. Queda fuera del MCP, como los de documentos. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  const limited = await sendLimit(req, 'link', 300, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const s = await getSpace(a.actor, (await ctx.params).id);
    const input = await parseBody(req, linkSchema);
    await assertNdaTemplate(a.actor, userCanUseApp(a.user, 'sign'), input.ndaTemplateId);
    return sJson({ link: linkDto(await createLink(a.actor, { spaceId: s.id }, input), a.actor) }, 201);
  } catch (err) {
    return sFail(err);
  }
}
