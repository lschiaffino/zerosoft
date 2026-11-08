/**
 * Estado del onboarding de una persona, sacado de los datos (no de clics):
 * qué tiene armado y qué le falta. Lo usan "Primeros pasos" del inicio
 * (components/app/home/GettingStarted.tsx), el segundo tramo de /app/welcome,
 * GET /api/onboarding y los emails del ciclo de vida.
 *
 *   const state = await getOnboardingState(userId);            // workspace propio
 *   const state = await getOnboardingState(userId, { workspaceId }); // otro workspace
 *   state.steps.find((s) => s.key === 'desktop')?.done
 *   state.pending  // claves relevantes que faltan, en orden
 *
 * Cada paso tiene `relevant` (aplica a esta persona: según el modo, las apps
 * que eligió y si administra el workspace) y `done` (lo dice la base). Un
 * paso que no aplica nunca cuenta como pendiente. Si una tabla no existe
 * (self-host viejo) el paso queda como no hecho, nunca tira.
 *
 * Server-only.
 */
import { getDb } from './db';
import { GOOGLE_CALENDAR_PROVIDER } from './google-calendar';
import { OUTLOOK_PROVIDER } from './microsoft';
import { OUTLOOK_CALENDAR_PROVIDER } from './outlook-calendar';
import { chosenApps, parseProfile, SOURCE_TOOLS, type OnboardingProfile } from './onboarding';
import type { ProductKey } from './products';
import { normalizeWorkspaceMode, type WorkspaceMode } from './workspace-mode';

export const ONBOARDING_STEP_KEYS = ['profile', 'invite', 'import', 'calendar', 'email', 'whatsapp', 'desktop'] as const;
export type OnboardingStepKey = (typeof ONBOARDING_STEP_KEYS)[number];

export interface OnboardingStep {
  key: OnboardingStepKey;
  /** Aplica a esta persona (si no, no se muestra ni cuenta). */
  relevant: boolean;
  done: boolean;
  /** A dónde ir para hacerlo (ruta de la app sin locale). */
  href: string;
}

export interface OnboardingState {
  userId: string;
  workspaceId: string;
  mode: WorkspaceMode;
  /** Terminó el primer tramo de /app/welcome (los usuarios anteriores lo tienen = created_at). */
  onboardedAt: string | null;
  /** Pasó por el onboarding actual (perfil v2): solo a ellos se les muestra "Primeros pasos". */
  newFlow: boolean;
  /** Administra el workspace (invitar e importar son de admins). */
  admin: boolean;
  role: string | null;
  apps: ProductKey[] | null;
  sourceTool: string | null;
  /** Segundo tramo de /app/welcome (conectar, importar, escritorio) terminado o salteado. */
  setupDoneAt: string | null;
  setupStep: string | null;
  checklistDismissedAt: string | null;
  desktop: { seenAt: string | null; platform: string | null; version: string | null; downloadedAt: string | null };
  steps: OnboardingStep[];
  /** Claves relevantes sin hacer, en el orden de `steps`. */
  pending: OnboardingStepKey[];
  doneCount: number;
  totalCount: number;
  complete: boolean;
  /** "Primeros pasos" se muestra en el inicio: perfil v2, no cerrado a mano y con algo pendiente. */
  showChecklist: boolean;
}

async function exists(sql: string, args: unknown[]): Promise<boolean> {
  try {
    return Boolean(await getDb().prepare(sql).get(...args));
  } catch {
    return false;
  }
}

interface UserBits {
  id: string;
  profile: string | null;
  onboarded_at: string | null;
}

/**
 * Estado del onboarding. `workspaceId` es el workspace donde mira (por
 * defecto, el propio: el id de la persona). Las conexiones (calendario,
 * email) son de la persona; WhatsApp e importaciones, del workspace.
 */
export async function getOnboardingState(userId: string, opts: { workspaceId?: string; admin?: boolean } = {}): Promise<OnboardingState | null> {
  const db = getDb();
  const user = (await db.prepare('SELECT id, profile, onboarded_at FROM users WHERE id = ?').get(userId)) as UserBits | undefined;
  if (!user) return null;
  const ws = opts.workspaceId ?? userId;
  const profile: OnboardingProfile = parseProfile(user.profile);
  const team = (await db
    .prepare('SELECT id, use_mode, owner_id FROM teams WHERE owner_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')
    .get(ws)
    .catch(() => undefined)) as { id: string; use_mode: string | null; owner_id: string } | undefined;
  const mode = normalizeWorkspaceMode(team?.use_mode);
  const admin = opts.admin ?? ws === userId;
  const apps = chosenApps(user.profile);
  const uses = (k: ProductKey) => (apps ? apps.includes(k) : false);
  const tool = profile.sourceTool ? SOURCE_TOOLS[profile.sourceTool] : undefined;

  const [invited, imported, calendar, email, whatsapp] = await Promise.all([
    team
      ? (async () =>
          (await exists("SELECT 1 FROM team_members WHERE team_id = ? AND user_id != ? AND role != 'guest' LIMIT 1", [team.id, team.owner_id])) ||
          (await exists("SELECT 1 FROM team_invites WHERE team_id = ? AND status IN ('pending', 'accepted') AND COALESCE(kind, 'invite') = 'invite' LIMIT 1", [team.id])))()
      : Promise.resolve(false),
    (async () =>
      (await exists("SELECT 1 FROM import_jobs WHERE workspace_id = ? AND status NOT IN ('failed', 'cancelled') LIMIT 1", [ws])) ||
      (await exists("SELECT 1 FROM crm_import_jobs WHERE user_id = ? AND status NOT IN ('failed', 'cancelled') LIMIT 1", [ws])) ||
      (profile.sourceTool === 'periskope' &&
        (await exists("SELECT 1 FROM groups_numbers WHERE user_id = ? AND provider != 'sample' AND status = 'connected' LIMIT 1", [ws]))))(),
    exists('SELECT 1 FROM integrations WHERE user_id = ? AND provider IN (?, ?) LIMIT 1', [userId, GOOGLE_CALENDAR_PROVIDER, OUTLOOK_CALENDAR_PROVIDER]),
    exists("SELECT 1 FROM integrations WHERE user_id = ? AND provider IN ('gmail', ?) LIMIT 1", [userId, OUTLOOK_PROVIDER]),
    exists("SELECT 1 FROM groups_numbers WHERE user_id = ? AND provider != 'sample' AND status = 'connected' LIMIT 1", [ws]),
  ]);

  const steps: OnboardingStep[] = [
    { key: 'profile', relevant: true, done: Boolean(user.onboarded_at), href: '/app/welcome' },
    { key: 'invite', relevant: admin && mode === 'team', done: invited, href: '/app/settings/members' },
    {
      key: 'import',
      relevant: admin && Boolean(tool?.importHref),
      done: imported,
      href: tool?.importHref ?? '/app/settings/import',
    },
    { key: 'calendar', relevant: uses('cal'), done: calendar, href: '/app/calendar/settings?tab=connections' },
    { key: 'email', relevant: uses('crm'), done: email, href: '/app/crm/settings?tab=integrations' },
    { key: 'whatsapp', relevant: admin && uses('groups'), done: whatsapp, href: '/app/groups/settings?tab=numbers' },
    { key: 'desktop', relevant: true, done: Boolean(profile.desktopSeenAt), href: '/app/download' },
  ];
  const relevant = steps.filter((s) => s.relevant);
  const pending = relevant.filter((s) => !s.done).map((s) => s.key);
  const doneCount = relevant.length - pending.length;
  const newFlow = (profile.v ?? 0) >= 2;
  return {
    userId,
    workspaceId: ws,
    mode,
    onboardedAt: user.onboarded_at,
    newFlow,
    admin,
    role: profile.role ?? null,
    apps,
    sourceTool: profile.sourceTool ?? null,
    setupDoneAt: profile.setupDoneAt ?? null,
    setupStep: profile.setupStep ?? null,
    checklistDismissedAt: profile.checklistDismissedAt ?? null,
    desktop: {
      seenAt: profile.desktopSeenAt ?? null,
      platform: profile.desktopPlatform ?? null,
      version: profile.desktopVersion ?? null,
      downloadedAt: profile.desktopDownloadedAt ?? null,
    },
    steps,
    pending,
    doneCount,
    totalCount: relevant.length,
    complete: pending.length === 0,
    showChecklist: newFlow && Boolean(user.onboarded_at) && !profile.checklistDismissedAt,
  };
}
