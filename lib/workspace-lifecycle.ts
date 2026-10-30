/**
 * "Persona sacada del workspace": un solo hook que corta lo que cada app
 * dejaba abierto. El acceso en sí ya se corta en el request siguiente
 * (lib/session.ts mira la membresía en cada request y limpia
 * active_team_id); esto saca lo que sigue funcionando sin sesión o a su
 * nombre: API keys, hosts y reservas de Cal, asignaciones de Chat y Groups,
 * subequipos, conexiones de tiempo real de Talk, accesos a proyectos de
 * Track, teamspaces de Docs y lo que se le compartió persona a persona.
 *
 * Cada paso va aparte: si uno falla (una tabla de una app que no está),
 * los demás corren igual. Se llama al sacar a alguien (teams.removeMember)
 * y al bajarlo a guest (con keepShares: lo compartido por recurso es
 * justamente lo que un guest sigue viendo).
 */
import { getDb } from './db';

export interface PersonRemoved {
  ownerId: string;
  teamId: string;
  userId: string;
  /** Pasó a guest: conserva lo que se le compartió por recurso. */
  keepShares?: boolean;
}

type Step = { name: string; run: (e: PersonRemoved) => Promise<unknown> };

const db = () => getDb();

const STEPS: Step[] = [
  {
    // Las API keys que creó en el workspace dejan de funcionar.
    name: 'api_keys',
    run: (e) => db().prepare('UPDATE api_keys SET revoked = 1 WHERE user_id = ? AND created_by = ?').run(e.ownerId, e.userId),
  },
  {
    // Deja de ser host de los tipos de evento (no recibe más reservas ni expone disponibilidad)
    // y sus reservas por venir pasan a otro host (o al owner), con aviso.
    name: 'cal',
    run: async (e) => {
      await db()
        .prepare('DELETE FROM calendar_event_hosts WHERE user_id = ? AND event_type_id IN (SELECT id FROM calendar_event_types WHERE user_id = ?)')
        .run(e.userId, e.ownerId);
      const { reassignRemovedHostBookings } = await import('./calendar-lifecycle');
      await reassignRemovedHostBookings(e.ownerId, e.userId);
    },
  },
  {
    // Sus conversaciones de Chat quedan sin asignar: las reglas las vuelven a repartir.
    name: 'chat',
    run: (e) =>
      db()
        .prepare(
          `UPDATE chat_conversations SET assigned_to = NULL
           WHERE assigned_to = ? AND widget_id IN (
             SELECT id FROM chat_widgets WHERE user_id = ? OR team_id IN (SELECT id FROM teams WHERE owner_id = ?))`,
        )
        .run(e.userId, e.ownerId, e.ownerId),
  },
  {
    // Groups: sus chats asignados vuelven a la cola y sale de la disponibilidad.
    name: 'groups',
    run: async (e) => {
      await db().prepare('UPDATE groups_chats SET assigned_to = NULL WHERE user_id = ? AND assigned_to = ?').run(e.ownerId, e.userId);
      await db().prepare('DELETE FROM groups_availability WHERE user_id = ? AND person_id = ?').run(e.ownerId, e.userId);
    },
  },
  {
    // Subequipos del workspace (y sus copias en CRM, Chat y Groups).
    name: 'workspace_groups',
    run: async (e) => {
      const { removePersonFromGroups } = await import('./workspace-groups');
      await removePersonFromGroups(e.ownerId, e.userId);
    },
  },
  {
    // Talk: deja los canales, sin avisos ni emails pendientes; sus streams abiertos se cortan.
    name: 'talk',
    run: async (e) => {
      const { talkPersonRemoved } = await import('./talk');
      await talkPersonRemoved(e.ownerId, e.userId);
    },
  },
  {
    // Social: deja de publicar en las cuentas del workspace, sus ítems de la bandeja vuelven a sin asignar
    // y lo programado vuelve a aprobación.
    name: 'social',
    run: async (e) => {
      await db()
        .prepare('DELETE FROM social_account_members WHERE person_id = ? AND account_id IN (SELECT id FROM social_accounts WHERE workspace_id = ?)')
        .run(e.userId, e.ownerId);
      await db().prepare('UPDATE social_inbox SET assigned_to = NULL WHERE workspace_id = ? AND assigned_to = ?').run(e.ownerId, e.userId);
      await db().prepare('DELETE FROM social_roles WHERE workspace_id = ? AND person_id = ?').run(e.ownerId, e.userId);
      // Lo que dejó programado vuelve a aprobación (con aviso a los admins) en vez de salir a su nombre.
      const { pauseAuthorPosts } = await import('./social');
      await pauseAuthorPosts(e.ownerId, e.userId, { reason: 'author_removed' });
    },
  },
  {
    // Webhooks, flows, robots y agentes con salida HTTP que armó: se pausan y el owner recibe aviso.
    name: 'automations',
    run: async (e) => {
      const { pauseRemovedPersonAutomations } = await import('./removed-automations');
      await pauseRemovedPersonAutomations(e.ownerId, e.userId);
    },
  },
  {
    // Track: accesos a proyectos privados del workspace.
    name: 'track',
    run: (e) =>
      db()
        .prepare('DELETE FROM track_project_access WHERE user_id = ? AND project_id IN (SELECT id FROM track_projects WHERE owner_id = ?)')
        .run(e.userId, e.ownerId),
  },
  {
    // Docs: teamspaces del workspace.
    name: 'docs_teamspaces',
    run: (e) =>
      db()
        .prepare('DELETE FROM docs_teamspace_members WHERE user_id = ? AND teamspace_id IN (SELECT id FROM docs_teamspaces WHERE workspace_id = ?)')
        .run(e.userId, e.ownerId),
  },
  {
    // Lo que se le compartió persona a persona dentro del workspace.
    name: 'shares',
    run: async (e) => {
      if (e.keepShares) return;
      await db()
        .prepare("DELETE FROM docs_shares WHERE kind = 'user' AND target_id = ? AND page_id IN (SELECT id FROM docs_pages WHERE user_id = ?)")
        .run(e.userId, e.ownerId);
      await db().prepare('DELETE FROM board_members WHERE user_id = ? AND board_id IN (SELECT id FROM boards WHERE workspace_id = ?)').run(e.userId, e.ownerId);
      await db()
        .prepare('DELETE FROM link_folder_members WHERE user_id = ? AND folder_id IN (SELECT id FROM link_folders WHERE user_id = ?)')
        .run(e.userId, e.ownerId);
      await db().prepare('DELETE FROM note_shares WHERE workspace_id = ? AND person_id = ?').run(e.ownerId, e.userId);
    },
  },
];

/** ¿Sigue siendo persona (no guest) de algún equipo del owner? (un owner de antes de 128 puede tener varios). */
async function stillInWorkspace(ownerId: string, userId: string): Promise<boolean> {
  const row = await db()
    .prepare(
      `SELECT 1 AS x FROM team_members m JOIN teams t ON t.id = m.team_id
       WHERE t.owner_id = ? AND m.user_id = ? AND m.role != 'guest' LIMIT 1`,
    )
    .get(ownerId, userId);
  return Boolean(row);
}

/** Corta todo lo que la persona tenía abierto en el workspace del owner. Nunca tira. */
export async function personRemoved(event: PersonRemoved): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  if (event.userId === event.ownerId) return { failed };
  // Si tenía este equipo como activo, vuelve a su workspace propio.
  await db()
    .prepare('UPDATE users SET active_team_id = NULL WHERE id = ? AND active_team_id = ?')
    .run(event.userId, event.teamId)
    .catch(() => undefined);
  // Sigue en otro equipo del mismo owner: conserva todo lo del workspace.
  if (await stillInWorkspace(event.ownerId, event.userId).catch(() => false)) return { failed };
  for (const step of STEPS) {
    try {
      await step.run(event);
    } catch (err) {
      if (!/no such table|no such column/i.test(String(err))) {
        failed.push(step.name);
        console.error(`[workspace] person removed: ${step.name}`, err);
      }
    }
  }
  return { failed };
}

// ---------- Persona que se suma ----------

export interface PersonJoined {
  ownerId: string;
  teamId: string;
  userId: string;
  role: string;
}

/**
 * Pasos al sumarse alguien al workspace (teams.addMember: invitación,
 * dominio o alta directa). Cada app agrega el suyo acá (p. ej. el importador
 * de HubSpot le pasa los registros que eran de esa persona). Nunca tira: un
 * paso que falla no deja a nadie afuera.
 */
const JOIN_STEPS: Array<{ name: string; run: (e: PersonJoined) => Promise<unknown> }> = [
  {
    // Migración del CRM: los registros que esperaban a esta persona (owner del otro CRM) pasan a ser suyos.
    name: 'crm_import_owners',
    run: (e) => claimIfCrm(e),
  },
];

/**
 * Los registros importados que esperaban a esta persona pasan a ser suyos
 * solo si tiene el CRM en este workspace. Si no, el pedido queda anotado y se
 * reclama cuando le habiliten el CRM (personAppsChanged).
 */
async function claimIfCrm(e: { ownerId: string; userId: string; role?: string }): Promise<void> {
  if (e.role === 'guest') return;
  const { personAppAccess } = await import('./api-auth');
  const access = await personAppAccess(e.ownerId, e.userId);
  if (!access || (access.apps !== '*' && !access.apps.includes('crm'))) return;
  const { claimImportedRecords } = await import('./crm-import-owners');
  await claimImportedRecords(e.ownerId, e.userId);
}

/** Cambiaron las apps de una persona (Ajustes › Miembros): lo que dependía de tener una app. */
export async function personAppsChanged(event: { ownerId: string; teamId: string; userId: string }): Promise<void> {
  try {
    await claimIfCrm(event);
  } catch (err) {
    console.error('[workspace] apps changed: crm_import_owners', err);
  }
}

export async function personJoined(event: PersonJoined): Promise<{ failed: string[] }> {
  const failed: string[] = [];
  for (const step of JOIN_STEPS) {
    try {
      await step.run(event);
    } catch (err) {
      failed.push(step.name);
      console.error(`[workspace] person joined: ${step.name}`, err);
    }
  }
  return { failed };
}
