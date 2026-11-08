/**
 * "¿Qué puede ver esta persona?" (Ajustes › Miembros y permisos): rol, apps,
 * equipos, el nivel que tiene dentro de cada app donde hay uno (Books, CRM,
 * Chat, Groups, Social, Cal, People, Track, Docs), lo que le compartieron
 * persona a persona, lo que tiene a su cargo y los últimos cambios.
 *
 * Usa las mismas funciones que deciden el acceso en cada app, así lo que se
 * muestra es lo que la persona efectivamente ve. Cada app va aparte: si una
 * tabla no está (o falla), esa línea queda en "Puede usarla".
 */
import { getDb, type TeamRow } from './db';
import { APP_SWITCHER_ORDER, type ProductKey } from './products';
import { canUseApp, getMembership } from './workspace';
import { listAudit, ownedStuff, type AuditEntry, type OwnedStuff } from './workspace-admin';
import { groupIdsOf } from './workspace-groups';
import type { WorkspaceRole } from './workspace';

export interface AppAccessRow {
  app: ProductKey;
  allowed: boolean;
  /** Texto corto ya traducido del nivel dentro de la app (null = "Puede usarla"). */
  detail: string | null;
}

export interface PersonAccessView {
  userId: string;
  role: WorkspaceRole;
  groupIds: string[];
  apps: AppAccessRow[];
  shared: { docs: number; boards: number; notes: number; links: number; track: number; docsTeamspaces: number };
  owned: OwnedStuff;
  history: AuditEntry[];
}

type Detail = { key: string; values?: Record<string, string | number> };

async function n(sql: string, ...args: string[]): Promise<number> {
  try {
    const row = (await getDb().prepare(sql).get(...args)) as { n?: number } | undefined;
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

/** Nivel dentro de cada app (solo donde hay uno distinto de "usa la app"). */
async function appDetails(ws: string, teamId: string, person: string, role: WorkspaceRole): Promise<Partial<Record<ProductKey, Detail>>> {
  const out: Partial<Record<ProductKey, Detail>> = {};
  const admin = role === 'owner' || role === 'admin';
  const steps: Array<Promise<void>> = [
    (async () => {
      const { booksActor } = await import('./books');
      const actor = await booksActor({ ws, person, workspaceRole: role });
      out.books = { key: 'books', values: { role: actor.role } };
    })(),
    (async () => {
      const { ownerScopeFor } = await import('./crm-visibility');
      const scope = await ownerScopeFor({ workspaceId: ws, personId: person, role });
      out.crm = { key: scope === null ? 'crmAll' : scope.length <= 1 ? 'crmMine' : 'crmTeam' };
    })(),
    (async () => {
      const { groupsViewer } = await import('./groups-access');
      const viewer = await groupsViewer(ws, person, role);
      if (viewer.restricted) out.groups = { key: 'groupsLabels' };
    })(),
    (async () => {
      if (admin) return;
      const { socialRoleOf } = await import('./social');
      const r = await socialRoleOf({ workspaceId: ws, personId: person, role } as Parameters<typeof socialRoleOf>[0]);
      out.social = { key: 'social', values: { role: r } };
    })(),
    (async () => {
      if (admin) return;
      const total = await n('SELECT COUNT(*) AS n FROM chat_widgets WHERE (user_id = ? OR team_id = ?) AND restricted = 1', ws, teamId);
      if (!total) return;
      const mine = await n(
        'SELECT COUNT(*) AS n FROM chat_widgets w JOIN chat_widget_access a ON a.widget_id = w.id WHERE (w.user_id = ? OR w.team_id = ?) AND w.restricted = 1 AND a.user_id = ?',
        ws,
        teamId,
        person,
      );
      out.chat = { key: 'chatRestricted', values: { count: total - mine } };
    })(),
    (async () => {
      if (!admin) out.cal = { key: 'calOwn' };
    })(),
    (async () => {
      if (role === 'owner') return;
      const { isHrAdmin } = await import('./people');
      if (await isHrAdmin(ws, person, false)) out.people = { key: 'peopleHr' };
    })(),
    (async () => {
      const guest = await n('SELECT COUNT(*) AS n FROM track_guests g JOIN users u ON lower(u.email) = lower(g.email) WHERE g.workspace_id = ? AND u.id = ?', ws, person);
      if (guest) out.track = { key: 'trackInvited' };
    })(),
  ];
  await Promise.all(steps.map((p) => p.catch(() => undefined)));
  return out;
}

const DETAIL_TEXT: Record<string, Record<string, string>> = {
  en: {
    books: 'Books role: {role}',
    crmAll: 'Sees every record',
    crmMine: 'Sees only the records they own',
    crmTeam: 'Sees their sales team’s records',
    groupsLabels: 'Sees only the chats of their labels',
    social: 'Social role: {role}',
    chatRestricted: '{count} restricted inboxes hidden',
    calOwn: 'Sees only their own bookings',
    peopleHr: 'HR admin: sees salaries',
    trackInvited: 'Only the projects they were invited to',
  },
  es: {
    books: 'Rol en Books: {role}',
    crmAll: 'Ve todos los registros',
    crmMine: 'Ve solo los registros que son suyos',
    crmTeam: 'Ve los registros de su equipo de ventas',
    groupsLabels: 'Ve solo los chats de sus etiquetas',
    social: 'Rol en Social: {role}',
    chatRestricted: '{count} bandejas restringidas ocultas',
    calOwn: 'Ve solo sus propias reservas',
    peopleHr: 'Admin de RR. HH.: ve sueldos',
    trackInvited: 'Solo los proyectos a los que lo invitaron',
  },
  pt: {
    books: 'Papel no Books: {role}',
    crmAll: 'Vê todos os registros',
    crmMine: 'Vê só os registros que são dele',
    crmTeam: 'Vê os registros da sua equipe de vendas',
    groupsLabels: 'Vê só os chats das suas etiquetas',
    social: 'Papel no Social: {role}',
    chatRestricted: '{count} caixas restritas ocultas',
    calOwn: 'Vê só as próprias reservas',
    peopleHr: 'Admin de RH: vê salários',
    trackInvited: 'Só os projetos para os quais foi convidado',
  },
};

const ROLE_WORDS: Record<string, Record<string, string>> = {
  en: { accountant: 'accountant', sales: 'sales', viewer: 'viewer', admin: 'admin', publisher: 'publisher', drafter: 'drafter' },
  es: { accountant: 'contador', sales: 'ventas', viewer: 'lector', admin: 'admin', publisher: 'publica', drafter: 'borradores' },
  pt: { accountant: 'contador', sales: 'vendas', viewer: 'leitor', admin: 'admin', publisher: 'publica', drafter: 'rascunhos' },
};

export function detailText(d: Detail, locale: string): string {
  const l = locale === 'es' || locale === 'pt' ? locale : 'en';
  let text = DETAIL_TEXT[l][d.key] ?? '';
  for (const [k, v] of Object.entries(d.values ?? {})) {
    const word = typeof v === 'string' ? ROLE_WORDS[l][v] ?? v : String(v);
    text = text.replace(`{${k}}`, word);
  }
  return text;
}

/** La vista completa (null si la persona no es parte del workspace). */
export async function personAccess(team: TeamRow, userId: string, locale = 'en'): Promise<PersonAccessView | null> {
  const m = await getMembership(team, userId);
  if (!m) return null;
  const ws = team.owner_id;
  const [groupIds, details, owned, history, docs, boards, notes, links, track, docsTeamspaces] = await Promise.all([
    groupIdsOf(ws, userId).catch(() => [] as string[]),
    m.role === 'guest' ? Promise.resolve({} as Partial<Record<ProductKey, Detail>>) : appDetails(ws, team.id, userId, m.role),
    ownedStuff(team, userId),
    listAudit(team.id, { targetId: userId, limit: 10 }).catch(() => [] as AuditEntry[]),
    n("SELECT COUNT(*) AS n FROM docs_shares s JOIN docs_pages p ON p.id = s.page_id WHERE s.kind = 'user' AND s.target_id = ? AND p.user_id = ?", userId, ws),
    n('SELECT COUNT(*) AS n FROM board_members m JOIN boards b ON b.id = m.board_id WHERE m.user_id = ? AND b.workspace_id = ?', userId, ws),
    n('SELECT COUNT(*) AS n FROM note_shares WHERE workspace_id = ? AND person_id = ?', ws, userId),
    n('SELECT COUNT(*) AS n FROM link_folder_members m JOIN link_folders f ON f.id = m.folder_id WHERE m.user_id = ? AND f.user_id = ?', userId, ws),
    n('SELECT COUNT(*) AS n FROM track_project_access a JOIN track_projects p ON p.id = a.project_id WHERE a.user_id = ? AND p.owner_id IN (?, ?)', userId, ws, team.id),
    n('SELECT COUNT(*) AS n FROM docs_teamspace_members m JOIN docs_teamspaces t ON t.id = m.teamspace_id WHERE m.user_id = ? AND t.workspace_id = ?', userId, ws),
  ]);
  // Inbox es personal (la tiene todo el mundo): no es un permiso del workspace.
  const apps = APP_SWITCHER_ORDER.filter((app) => app !== 'inbox').map((app) => {
    const allowed = canUseApp(m, app);
    const d = allowed ? details[app] : undefined;
    return { app, allowed, detail: d ? detailText(d, locale) || null : null };
  });
  // Lo compartido por recurso es lo que ve un guest; a los demás se les suman los accesos privados.
  return {
    userId,
    role: m.role,
    groupIds,
    apps,
    shared: { docs, boards, notes, links, track: m.role === 'guest' ? 0 : track, docsTeamspaces: m.role === 'guest' ? 0 : docsTeamspaces },
    owned,
    history,
  };
}

/** Para los tests: ¿la persona usa la app y con qué detalle? */
export async function appLine(team: TeamRow, userId: string, app: ProductKey): Promise<AppAccessRow | null> {
  const v = await personAccess(team, userId);
  return v?.apps.find((a) => a.app === app) ?? null;
}

