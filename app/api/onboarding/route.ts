import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { onboardingDestination, saveBasicProfile, saveOnboarding } from '@/lib/onboarding';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, realUserId } from '@/lib/session';
import { publicBase, requestLocale } from '@/lib/teams-http';
import { ensureWorkspace } from '@/lib/workspace';
import { inviteMany, type InviteOutcome } from '@/lib/workspace-invites';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fullSchema = z.object({
  kind: z.literal('full'),
  mode: z.enum(['personal', 'team']),
  teamName: z.string().max(80).optional(),
  size: z.string().max(10).optional(),
  role: z.string().max(30).optional(),
  sourceTool: z.string().max(30).optional(),
  entryApp: z.string().max(20).optional(),
  goals: z.array(z.string().max(40)).max(10).optional(),
  invites: z.union([z.string().max(20_000), z.array(z.string().max(320)).max(50)]).optional(),
  name: z.string().max(80).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  timeZone: z.string().max(64).optional(),
  sampleData: z.boolean().optional(),
  importNow: z.boolean().optional(),
});

const basicSchema = z.object({
  kind: z.literal('invited'),
  name: z.string().max(80).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  timeZone: z.string().max(64).optional(),
});

/**
 * POST: guarda el onboarding.
 * - { kind: 'full', … }: cuenta nueva (uso, equipo, invitaciones, rol, origen, app de entrada).
 * - { kind: 'invited', name, locale, timeZone }: quien entró por una invitación.
 * Devuelve a dónde seguir (`next`) y, si invitó gente, cómo salió cada email.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const real = user.actingUser ?? user;
  const limit = await rateLimit(`onboarding:${realUserId(user)}`, 20, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const raw = await req.json().catch(() => null);

  const basic = basicSchema.safeParse(raw);
  if (basic.success) {
    await saveBasicProfile(real.id, basic.data);
    return NextResponse.json({ ok: true, next: '/app' });
  }
  const parsed = fullSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 400 });
  // El onboarding completo es una sola vez (después, todo se cambia desde Ajustes).
  if (real.onboarded_at || user.actingUser) return NextResponse.json({ error: 'already_onboarded' }, { status: 409 });
  const input = parsed.data;
  const profile = await saveOnboarding(real, input);
  let results: InviteOutcome[] = [];
  let invalid: string[] = [];
  if (input.mode === 'team' && input.invites && (Array.isArray(input.invites) ? input.invites.length : input.invites.trim())) {
    const team = await ensureWorkspace(real.id);
    const invLimit = await rateLimit(`teams:invite:${real.id}`, 30, 3600);
    if (!invLimit.ok) return NextResponse.json({ ok: true, next: onboardingDestination(profile, Boolean(input.importNow)), invites: [], invitesLimited: true });
    const sent = await inviteMany({
      team,
      inviter: { id: real.id, name: input.name?.trim() || real.name, email: real.email },
      emails: input.invites,
      locale: requestLocale(req, input.locale),
      base: publicBase(req),
    });
    results = sent.results;
    invalid = sent.invalid;
  }
  return NextResponse.json({ ok: true, next: onboardingDestination(profile, Boolean(input.importNow)), invites: results, invalid });
}
