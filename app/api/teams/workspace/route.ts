import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getTeamById } from '@/lib/teams';
import { isResponse, teamsCtx, teamsError } from '@/lib/teams-http';
import { joinSettings, parseDomains, updateWorkspace, workspaceModeOf, WORKSPACE_SIZES } from '@/lib/workspace';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function dto(team: NonNullable<Awaited<ReturnType<typeof getTeamById>>>) {
  return {
    id: team.id,
    name: team.name,
    slug: team.slug ?? null,
    logoUrl: team.logo_url ?? null,
    mode: workspaceModeOf(team),
    size: team.size ?? null,
    allowedDomains: parseDomains(team.allowed_domains),
    joinApps: joinSettings(team).apps,
    joinApproval: joinSettings(team).approval,
    ownerId: team.owner_id,
  };
}

/** GET: la ficha del workspace activo. */
export async function GET() {
  const ctx = await teamsCtx();
  if (isResponse(ctx)) return ctx;
  return NextResponse.json(dto(ctx.team));
}

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  logoUrl: z.string().trim().max(500).nullable().optional(),
  slug: z.string().trim().max(60).nullable().optional(),
  mode: z.enum(['personal', 'team']).optional(),
  size: z.enum(WORKSPACE_SIZES).nullable().optional(),
  allowedDomains: z.array(z.string().trim().max(120)).max(10).optional(),
  joinApps: z.union([z.literal('*'), z.array(z.string().max(20)).max(64)]).optional(),
  joinApproval: z.boolean().optional(),
});

/** PATCH: cambia la ficha (solo owner y admins). */
export async function PATCH(req: NextRequest) {
  const ctx = await teamsCtx('admin');
  if (isResponse(ctx)) return ctx;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return teamsError('invalid_input');
  // Los dominios solo los habilita alguien con email de ese dominio (Google lo verificó al entrar).
  const err = await updateWorkspace(ctx.team.id, { ...parsed.data, editorEmail: parsed.data.allowedDomains ? ctx.real.email : undefined });
  if (err) return teamsError(err, err === 'slug_taken' ? 409 : 400);
  return NextResponse.json(dto((await getTeamById(ctx.team.id))!));
}
