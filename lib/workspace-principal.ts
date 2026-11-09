/**
 * Personal y equipo: cada persona tiene su workspace personal (la ficha
 * ws_<su id>, con sus datos bajo su id) y un workspace de equipo.
 *
 * Los datos de las apps cuelgan del id del owner del workspace
 * (lib/workspace.ts). Para que el equipo no comparta datos con lo personal, un
 * workspace de equipo nuevo tiene su propio "titular": una fila de users con
 * kind = 'workspace' (sin login posible: email @workspaces.zerosoft.invalid)
 * que es el owner_id de la ficha y la clave de sus datos. La persona que lo
 * crea entra como miembro con rol owner: tiene todo, como siempre, y el día
 * de mañana el workspace se puede pasar a otra persona sin mover datos.
 *
 * El titular no es una persona: no aparece en listas de personas, no recibe
 * emails de ciclo de vida y no tiene fila en team_members.
 */
import { getDb, upsertUser, type Db, type TeamRow, type UserRow } from './db';
import { cleanLine, ensureWorkspace, updateWorkspace } from './workspace';

export const PRINCIPAL_EMAIL_DOMAIN = 'workspaces.zerosoft.invalid';

export function isPrincipalEmail(email: string | null | undefined): boolean {
  return (email ?? '').toLowerCase().endsWith(`@${PRINCIPAL_EMAIL_DOMAIN}`);
}

/** "<Nombre> Team" (o el de la empresa si vino del onboarding). */
export function defaultTeamName(person: Pick<UserRow, 'name' | 'email'>): string {
  const first = (person.name ?? '').trim().split(/\s+/)[0] || (person.email ?? '').split('@')[0] || 'My';
  return `${first.slice(0, 60)} Team`;
}

/**
 * Crea un workspace de equipo con titular propio y deja a `person` como su
 * owner. Devuelve la ficha. No es idempotente: para "si no tiene, crear" está
 * ensureTeamWorkspace.
 */
export async function createTeamWorkspace(person: Pick<UserRow, 'id'>, name: string, db: Db = getDb()): Promise<TeamRow> {
  const clean = cleanLine(name).slice(0, 80) || 'Team';
  const id = `wsp_${crypto.randomUUID().replace(/-/g, '')}`;
  const principal = await upsertUser({ id, email: `${id}@${PRINCIPAL_EMAIL_DOMAIN}`, name: clean, image: null });
  await db.prepare("UPDATE users SET kind = 'workspace', onboarded_at = COALESCE(onboarded_at, datetime('now')) WHERE id = ?").run(principal.id);
  const team = await ensureWorkspace(principal.id, db);
  await updateWorkspace(team.id, { name: clean, mode: 'team' }, db);
  // El titular no es una persona del equipo: la persona que lo creó es el owner.
  await db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(team.id, principal.id);
  await db
    .prepare("INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, 'owner', '*') ON CONFLICT(team_id, user_id) DO UPDATE SET role = 'owner', apps = '*'")
    .run(team.id, person.id);
  return (await db.prepare('SELECT * FROM teams WHERE id = ?').get(team.id)) as TeamRow;
}

/** La ficha `t` ya tiene otras personas (no guests): se usa como equipo aunque no diga el modo. */
const OTHERS = "EXISTS (SELECT 1 FROM team_members o WHERE o.team_id = t.id AND o.user_id != t.owner_id AND o.role != 'guest')";

/**
 * ¿Ya tiene un workspace de equipo? Uno ajeno donde es parte (no guest) o el
 * propio en modo equipo o con más personas (los de antes, con los datos bajo su id).
 */
export async function teamWorkspaceOf(personId: string, db: Db = getDb()): Promise<TeamRow | null> {
  const row = (await db
    .prepare(
      `SELECT t.* FROM teams t
       WHERE (t.owner_id = ? AND (t.use_mode = 'team' OR ${OTHERS}))
          OR EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = t.id AND m.user_id = ? AND m.role != 'guest' AND t.owner_id != ?)
       ORDER BY (t.owner_id != ?) DESC, t.created_at ASC, t.id ASC LIMIT 1`,
    )
    .get(personId, personId, personId, personId)) as TeamRow | undefined;
  return row ?? null;
}

/** Workspace de equipo con titular propio donde la persona es owner (el que creó ella). */
export async function ownedTeamWorkspace(personId: string, db: Db = getDb()): Promise<TeamRow | null> {
  const row = (await db
    .prepare(
      `SELECT t.* FROM teams t JOIN team_members m ON m.team_id = t.id
       WHERE m.user_id = ? AND m.role = 'owner' AND t.owner_id LIKE 'wsp\\_%' ESCAPE '\\' ORDER BY t.created_at, t.id LIMIT 1`,
    )
    .get(personId)) as TeamRow | undefined;
  return row ?? null;
}

/** Idempotente: si la persona no tiene workspace de equipo, crea "<Nombre> Team". */
export async function ensureTeamWorkspace(person: Pick<UserRow, 'id' | 'name' | 'email'>, name?: string, db: Db = getDb()): Promise<{ team: TeamRow; created: boolean }> {
  const existing = await teamWorkspaceOf(person.id, db);
  if (existing) return { team: existing, created: false };
  return { team: await createTeamWorkspace(person, name || defaultTeamName(person), db), created: true };
}

/**
 * Las dos cosas para una persona: su personal (la ficha propia, en modo
 * personal si todavía no era de equipo) y uno de equipo. Para el alta y la
 * migración de los que ya estaban.
 */
export async function ensurePersonalAndTeam(person: Pick<UserRow, 'id' | 'name' | 'email'>, opts: { teamName?: string } = {}, db: Db = getDb()) {
  const own = await ensureWorkspace(person.id, db);
  const result = await ensureTeamWorkspace(person, opts.teamName, db);
  // La ficha propia sin modo y sin nadie más pasa a ser la personal (con nadie más adentro, ya era de uso personal).
  if (result.team.id !== own.id) {
    await db
      .prepare(`UPDATE teams SET use_mode = 'personal' WHERE id = ? AND use_mode IS NULL AND NOT ${OTHERS.replace(/t\.id/g, 'teams.id').replace(/t\.owner_id/g, 'teams.owner_id')}`)
      .run(own.id);
  }
  return result;
}
