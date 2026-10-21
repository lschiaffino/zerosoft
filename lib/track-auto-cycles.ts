/**
 * Track — cycles automáticos por proyecto.
 *
 * Con cycle_auto activo, el tick horario (una vez por día y proyecto, con
 * claim en cycle_auto_day) se asegura de que haya un cycle en curso y uno
 * próximo, de cycle_weeks semanas, y completa los cycles ya terminados: lo
 * sin terminar pasa al cycle en curso (completeCycle deja la actividad y
 * marca completed_at, así no se vuelve a procesar).
 */
import { getDb } from './db';
import type { TrackCycleRow, TrackProjectRow } from './db';
import { completeCycle, createCycle, listCycles } from './track-data';
import { planAutoCycles } from './track-recurrence';
import { activeCycle, overlappingCycle } from './track-tasks';

export interface AutoCycleResult {
  created: number;
  rolledOver: number;
}

/** Crea los cycles que faltan y arrastra lo sin terminar de los que ya cerraron. */
export async function syncAutoCycles(project: TrackProjectRow, today: string): Promise<AutoCycleResult> {
  const result: AutoCycleResult = { created: 0, rolledOver: 0 };
  if (!project.cycle_auto || project.status !== 'active') return result;
  let cycles = await listCycles(project.id);
  const plan = planAutoCycles(cycles, today, project.cycle_weeks ?? 2, project.cycle_name ?? '');
  for (const c of plan) {
    // Vuelve a leer: si otro proceso ya creó uno en ese rango, no se pisa.
    cycles = await listCycles(project.id);
    if (overlappingCycle(cycles, c.startAt, c.endAt)) continue;
    await createCycle(project.id, { name: c.name, startAt: c.startAt, endAt: c.endAt });
    result.created++;
  }
  cycles = await listCycles(project.id);
  const current = activeCycle(cycles, today);
  const ended = cycles.filter((c: TrackCycleRow) => !c.completed_at && c.end_at.slice(0, 10) < today);
  for (const c of ended) {
    // Claim: solo un proceso completa cada cycle.
    const claimed = await getDb()
      .prepare('UPDATE track_cycles SET completed_at = ? WHERE id = ? AND completed_at IS NULL')
      .run(new Date().toISOString(), c.id);
    if (!claimed.changes) continue;
    const res = await completeCycle(c.id, current && current.id !== c.id ? current.id : null);
    if (res.ok) result.rolledOver += res.moved;
  }
  return result;
}

/** Corrida del tick: proyectos con cycles automáticos que hoy todavía no se revisaron. */
export async function runAutoCycles(opts: { now?: Date; limit?: number } = {}): Promise<AutoCycleResult & { projects: number }> {
  const day = (opts.now ?? new Date()).toISOString().slice(0, 10);
  const db = getDb();
  const rows = (await db
    .prepare(
      `SELECT * FROM track_projects
       WHERE cycle_auto = 1 AND status = 'active' AND (cycle_auto_day IS NULL OR cycle_auto_day != ?)
       LIMIT ?`,
    )
    .all(day, Math.min(Math.max(opts.limit ?? 200, 1), 1000))) as TrackProjectRow[];
  const total = { created: 0, rolledOver: 0, projects: 0 };
  for (const project of rows) {
    const claimed = await db
      .prepare('UPDATE track_projects SET cycle_auto_day = ? WHERE id = ? AND (cycle_auto_day IS NULL OR cycle_auto_day != ?)')
      .run(day, project.id, day);
    if (!claimed.changes) continue;
    try {
      const r = await syncAutoCycles(project, day);
      total.created += r.created;
      total.rolledOver += r.rolledOver;
      total.projects++;
    } catch {
      // Un proyecto con error no frena al resto; mañana se vuelve a intentar.
    }
  }
  return total;
}
