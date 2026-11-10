import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  dismissChecklist,
  markDesktopDownloaded,
  markDesktopSeen,
  onboardingDestination,
  saveBasicProfile,
  saveDraft,
  saveOnboarding,
  saveSetupProgress,
  SETUP_STEPS,
} from '@/lib/onboarding';
import { getOnboardingState } from '@/lib/onboarding-state';
import { rateLimit } from '@/lib/rate-limit';
import { getCurrentUser, isWorkspaceAdmin, realUserId } from '@/lib/session';
import { publicBase, requestLocale } from '@/lib/teams-http';
import { ensureWorkspace } from '@/lib/workspace';
import { ownedTeamWorkspace } from '@/lib/workspace-principal';
import { isComingSoon } from '@/lib/products';
import { joinWaitlist, normalizeLang, sendWaitlistJoined } from '@/lib/waitlist';
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
  apps: z.array(z.string().max(20)).max(40).optional(),
  goals: z.array(z.string().max(40)).max(10).optional(),
  invites: z.union([z.string().max(20_000), z.array(z.string().max(320)).max(50)]).optional(),
  name: z.string().max(80).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  timeZone: z.string().max(64).optional(),
  sampleData: z.boolean().optional(),
  importNow: z.boolean().optional(),
  /** Apps "Próximamente" a cuya lista de espera se suma. */
  waitlist: z.array(z.string().max(20)).max(20).optional(),
});

const basicSchema = z.object({
  kind: z.literal('invited'),
  name: z.string().max(80).optional(),
  locale: z.enum(['en', 'es', 'pt']).optional(),
  timeZone: z.string().max(64).optional(),
});

const draftSchema = z.object({ kind: z.literal('draft'), draft: z.record(z.string(), z.unknown()) });
const setupSchema = z.object({
  kind: z.literal('setup'),
  step: z.enum(SETUP_STEPS).optional(),
  done: z.boolean().optional(),
  sourceTool: z.string().max(30).nullable().optional(),
});
const desktopSchema = z.object({ kind: z.literal('desktop'), event: z.enum(['seen', 'download']), platform: z.string().max(10).optional(), version: z.string().max(32).optional() });
const checklistSchema = z.object({ kind: z.literal('checklist'), dismissed: z.boolean() });

/**
 * GET: el estado del onboarding de la persona (lib/onboarding-state.ts), sacado de los datos.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const real = user.actingUser ?? user;
  const state = await getOnboardingState(real.id, { workspaceId: user.id, admin: isWorkspaceAdmin(user) });
  return NextResponse.json({ state });
}

/**
 * POST: guarda el onboarding.
 * - { kind: 'draft', draft }: borrador del primer tramo (se retoma al volver).
 * - { kind: 'setup', step?, done?, sourceTool? }: segundo tramo (conectar, importar, escritorio).
 * - { kind: 'desktop', event: 'seen' | 'download' }: la app de escritorio se abrió, o se tocó un instalador.
 * - { kind: 'checklist', dismissed }: cerrar o volver a mostrar "Primeros pasos".
 * - { kind: 'full', … }: cuenta nueva (uso, equipo, invitaciones, rol, origen, app de entrada).
 * - { kind: 'invited', name, locale, timeZone }: quien entró por una invitación.
 * Devuelve a dónde seguir (`next`) y, si invitó gente, cómo salió cada email.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const real = user.actingUser ?? user;
  const limit = await rateLimit(`onboarding:${realUserId(user)}`, 120, 600);
  if (!limit.ok) return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  const raw = await req.json().catch(() => null);

  const draft = draftSchema.safeParse(raw);
  if (draft.success) {
    if (real.onboarded_at) return NextResponse.json({ ok: true });
    await saveDraft(real.id, draft.data.draft);
    return NextResponse.json({ ok: true });
  }
  const setup = setupSchema.safeParse(raw);
  if (setup.success) {
    await saveSetupProgress(real.id, setup.data);
    return NextResponse.json({ ok: true });
  }
  const desktop = desktopSchema.safeParse(raw);
  if (desktop.success) {
    if (desktop.data.event === 'seen') await markDesktopSeen(real.id, desktop.data);
    else await markDesktopDownloaded(real.id);
    return NextResponse.json({ ok: true });
  }
  const checklist = checklistSchema.safeParse(raw);
  if (checklist.success) {
    await dismissChecklist(real.id, checklist.data.dismissed);
    return NextResponse.json({ ok: true });
  }

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
  // Listas de espera elegidas en el último paso (las que no son "Próximamente" se ignoran).
  for (const app of new Set(input.waitlist ?? [])) {
    if (!isComingSoon(app)) continue;
    const joined = await joinWaitlist({ app, email: real.email, userId: real.id, locale: input.locale, source: 'app' }).catch(() => null);
    if (joined?.created) await sendWaitlistJoined(joined.email, joined.app, normalizeLang(input.locale)).catch(() => false);
  }
  let results: InviteOutcome[] = [];
  let invalid: string[] = [];
  if (input.mode === 'team' && input.invites && (Array.isArray(input.invites) ? input.invites.length : input.invites.trim())) {
    const team = (await ownedTeamWorkspace(real.id)) ?? (await ensureWorkspace(real.id));
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
