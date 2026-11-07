import { NextRequest } from 'next/server';
import { createLink, getDocument, linkDto, listLinks } from '@/lib/send/core';
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
    const { id } = await ctx.params;
    const d = await getDocument(a.actor, id);
    return sJson({ links: await listLinks(a.actor, { documentId: d.id }) });
  } catch (err) {
    return sFail(err);
  }
}

/** POST: link nuevo. Queda fuera del MCP: es una URL que funciona sin cuenta (lib/mcp/excludes.mjs). */
export async function POST(req: NextRequest, ctx: Ctx) {
  const a = await sendActor();
  if ('res' in a) return a.res;
  const limited = await sendLimit(req, 'link', 300, 3600, a.actor.person);
  if (limited) return limited;
  try {
    const { id } = await ctx.params;
    const d = await getDocument(a.actor, id);
    const input = await parseBody(req, linkSchema);
    await assertNdaTemplate(a.actor, userCanUseApp(a.user, 'sign'), input.ndaTemplateId);
    const link = await createLink(a.actor, { documentId: d.id }, input);
    return sJson({ link: linkDto(link, a.actor) }, 201);
  } catch (err) {
    return sFail(err);
  }
}
