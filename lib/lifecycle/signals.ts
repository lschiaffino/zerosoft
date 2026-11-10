/**
 * Señales de ciclo de vida: qué configuró y qué usó cada persona.
 *
 * Detrás de una interfaz chica (SignalsSource) para poder cambiar de dónde
 * salen: hoy se leen de las tablas de cada app al momento de decidir (no hace
 * falta tocar cada app para emitir eventos). Lo que no queda en ninguna tabla
 * (instalar la app de escritorio) se marca con recordLifecycleEvent.
 * Cada consulta está aislada: si una tabla falta (self-host viejo), esa señal
 * vale false y el resto sigue.
 */
import { getDb } from '../db';
import { PRODUCT_KEYS, type ProductKey } from '../products';
import type { LifecycleLocale, LifecycleSignals } from './types';
import { IMPORT_HREFS } from './rules';
import { chosenApps as onboardingApps } from '../onboarding-shared';

export interface SignalsSource {
  load(userId: string): Promise<LifecycleSignals | null>;
}

/** Eventos que no salen de otras tablas. */
/** desktop_hint_dismissed: cerró la tarjeta de la app de escritorio del inicio (lib/desktop-hint.ts). */
export type LifecycleEvent = 'desktop_installed' | 'desktop_hint_dismissed' | 'imported' | 'mcp_connected';

/** Marca la primera vez que pasa algo (idempotente, nunca tira). */
export async function recordLifecycleEvent(userId: string, event: LifecycleEvent, at = new Date()): Promise<void> {
  try {
    await getDb()
      .prepare('INSERT OR IGNORE INTO lifecycle_events (user_id, event, first_at) VALUES (?, ?, ?)')
      .run(userId, event, at.toISOString());
  } catch {
    /* sin la tabla (migración pendiente): no frena a quien llamó */
  }
}

function asLocale(v: unknown): LifecycleLocale {
  return v === 'es' || v === 'pt' ? v : 'en';
}

function parseProfile(raw: unknown): { entryApp?: string; goals?: unknown; sourceTool?: string; role?: string; desktopSeenAt?: string } {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

const TOOL_APP: Record<string, ProductKey> = {
  hubspot: 'crm',
  pipedrive: 'crm',
  salesforce: 'crm',
  notion: 'docs',
  confluence: 'docs',
  linear: 'track',
  jira: 'track',
  github: 'track',
  calendly: 'cal',
  bitly: 'link',
  evernote: 'notes',
  miro: 'board',
  intercom: 'chat',
};

/** Apps elegidas en el onboarding: la de entrada primero, después objetivos y la de la herramienta de origen. */
export function chosenApps(profile: { entryApp?: string; goals?: unknown; sourceTool?: string }): ProductKey[] {
  const out: ProductKey[] = [];
  const add = (v: unknown) => {
    if (typeof v === 'string' && (PRODUCT_KEYS as string[]).includes(v) && !out.includes(v as ProductKey)) out.push(v as ProductKey);
  };
  add(profile.entryApp);
  if (Array.isArray(profile.goals)) profile.goals.forEach(add);
  if (profile.sourceTool) add(TOOL_APP[profile.sourceTool]);
  return out;
}

async function exists(sql: string, ...args: Array<string | number | null>): Promise<boolean> {
  try {
    return !!(await getDb().prepare(`SELECT 1 AS x FROM (${sql}) LIMIT 1`).get(...args));
  } catch {
    return false;
  }
}

async function count(sql: string, ...args: Array<string | number | null>): Promise<number> {
  try {
    const row = (await getDb().prepare(sql).get(...args)) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

interface UserBits {
  id: string;
  email: string;
  name: string | null;
  locale: string | null;
  time_zone: string | null;
  profile: string | null;
  created_at: string;
  onboarded_at: string | null;
  active_team_id: string | null;
  seeded_at: string | null;
}

/** Workspace activo de la persona: dueño (los datos cuelgan de su id), ficha y rol. */
async function workspaceOf(u: UserBits): Promise<{ ownerId: string; teamId: string | null; mode: string | null; name: string | null; role: string }> {
  const db = getDb();
  try {
    if (u.active_team_id) {
      const row = (await db
        .prepare('SELECT t.id, t.owner_id, t.use_mode, t.name, m.role FROM teams t JOIN team_members m ON m.team_id = t.id AND m.user_id = ? WHERE t.id = ?')
        .get(u.id, u.active_team_id)) as { id: string; owner_id: string; use_mode: string | null; name: string; role: string } | undefined;
      if (row) return { ownerId: row.owner_id, teamId: row.id, mode: row.use_mode, name: row.name, role: row.role };
    }
    const own = (await db
      .prepare('SELECT id, use_mode, name FROM teams WHERE owner_id = ? ORDER BY created_at ASC, id ASC LIMIT 1')
      .get(u.id)) as { id: string; use_mode: string | null; name: string } | undefined;
    return { ownerId: u.id, teamId: own?.id ?? null, mode: own?.use_mode ?? null, name: own?.name ?? null, role: 'owner' };
  } catch {
    return { ownerId: u.id, teamId: null, mode: null, name: null, role: 'owner' };
  }
}

/** Lee las señales de las tablas de cada app. */
export const dbSignalsSource: SignalsSource = {
  async load(userId) {
    const u = (await getDb()
      .prepare('SELECT id, email, name, locale, time_zone, profile, created_at, onboarded_at, active_team_id, seeded_at FROM users WHERE id = ?')
      .get(userId)) as UserBits | undefined;
    if (!u) return null;
    const profile = parseProfile(u.profile);
    // Las apps que eligió en el onboarding (users.profile.apps, lib/onboarding-shared.ts); si no hay, las deducidas.
    const apps = onboardingApps(u.profile) ?? chosenApps(profile);
    const ws = await workspaceOf(u);
    const owner = ws.ownerId;
    // Los datos de ejemplo del onboarding no cuentan como "creó lo primero". Las fechas
    // de las tablas son "YYYY-MM-DD HH:MM:SS" (datetime('now')) o ISO: se compara contra las dos.
    const since = u.seeded_at ? new Date(new Date(u.seeded_at).getTime() + 60_000).toISOString().slice(0, 19) : '0';
    const after = (col: string) => `REPLACE(SUBSTR(${col}, 1, 19), ' ', 'T') > ?`;

    const [
      docs, issues, deals, notes, boards, links, eventTypes,
      members, pending, oldestPending,
      importedJobs, importedCrm, events,
      calendar, whatsapp, voice, assistant, mcpGrant, mcpAudit,
    ] = await Promise.all([
      exists(`SELECT id FROM docs_pages WHERE user_id = ? AND ${after('created_at')}`, owner, since),
      exists(`SELECT id FROM track_issues WHERE creator_id = ? AND ${after('created_at')}`, u.id, since),
      exists(`SELECT id FROM crm_deals WHERE user_id = ? AND ${after('created_at')}`, owner, since),
      exists(`SELECT id FROM notes WHERE person_id = ? AND ${after('created_at')}`, u.id, since),
      exists(`SELECT id FROM boards WHERE created_by = ? AND ${after('created_at')}`, u.id, since),
      exists(`SELECT id FROM links WHERE user_id = ? AND ${after('created_at')}`, owner, since),
      exists(`SELECT id FROM calendar_event_types WHERE user_id = ? AND ${after('created_at')}`, u.id, since),
      ws.teamId ? count('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?', ws.teamId) : Promise.resolve(1),
      ws.teamId ? count("SELECT COUNT(*) AS n FROM team_invites WHERE team_id = ? AND status = 'pending'", ws.teamId) : Promise.resolve(0),
      ws.teamId
        ? getDb()
            .prepare("SELECT MIN(created_at) AS at FROM team_invites WHERE team_id = ? AND status = 'pending'")
            .get(ws.teamId)
            .then((r) => ((r as { at?: string | null } | undefined)?.at ?? null))
            .catch(() => null)
        : Promise.resolve(null),
      exists("SELECT id FROM import_jobs WHERE user_id = ? AND status = 'done'", u.id),
      exists("SELECT id FROM crm_import_jobs WHERE (created_by = ? OR user_id = ?) AND status = 'done'", u.id, u.id),
      getDb()
        .prepare('SELECT event FROM lifecycle_events WHERE user_id = ?')
        .all(u.id)
        .then((rows) => new Set((rows as Array<{ event: string }>).map((r) => r.event)))
        .catch(() => new Set<string>()),
      exists("SELECT user_id FROM integrations WHERE user_id = ? AND provider IN ('google_calendar', 'outlook_calendar', 'icloud_calendar')", u.id),
      exists("SELECT id FROM groups_numbers WHERE user_id = ? AND status = 'connected'", owner),
      exists('SELECT id FROM voice_sessions WHERE person_id = ?', u.id),
      exists('SELECT id FROM assistant_conversations WHERE person_id = ?', u.id),
      exists('SELECT id FROM oauth_grants WHERE user_id = ?', u.id),
      exists('SELECT id FROM mcp_audit_log WHERE user_id = ?', u.id),
    ]);

    const sourceTool = profile.sourceTool && IMPORT_HREFS[profile.sourceTool] ? profile.sourceTool : null;
    const teamMode = ws.mode === 'team';
    return {
      userId: u.id,
      email: u.email,
      name: u.name,
      locale: asLocale(u.locale),
      timeZone: u.time_zone || 'UTC',
      createdAt: u.created_at,
      onboardedAt: u.onboarded_at,
      apps,
      sourceTool,
      role: typeof profile.role === 'string' ? profile.role : null,
      workspaceOwnerId: owner,
      teamId: ws.teamId,
      isTeamAdmin: teamMode && (ws.role === 'owner' || ws.role === 'admin'),
      teamName: ws.name,
      memberCount: members,
      pendingInvites: pending,
      oldestPendingInviteAt: oldestPending,
      createdFirstItem: { docs, track: issues, crm: deals, notes, board: boards, link: links, cal: eventTypes },
      imported: importedJobs || importedCrm || events.has('imported'),
      calendarConnected: calendar,
      whatsappConnected: whatsapp,
      // La app de escritorio avisa al abrirse con la cuenta (lib/onboarding.ts → markDesktopSeen) o al iniciar sesión.
      desktopInstalled: events.has('desktop_installed') || Boolean(profile.desktopSeenAt),
      usedVoice: voice,
      usedAssistant: assistant,
      usedMcp: mcpGrant || mcpAudit || events.has('mcp_connected'),
    } satisfies LifecycleSignals;
  },
};
