/**
 * Track — orden de la lista de projects (track_plans). Sin acceso a la base:
 * lo usa el cliente (components/track/planning/PlansList).
 */
export const PLAN_LIST_SORTS = ['manual', 'name', 'target', 'progress', 'created', 'updated'] as const;
export type PlanListSort = (typeof PLAN_LIST_SORTS)[number];

interface SortablePlan {
  name: string;
  target_date: string | null;
  created_at: string;
  updated_at?: string | null;
  progress: { percent: number };
}

/** Orden de la lista de projects ("manual" deja el del servidor: estado y después fecha). */
export function sortPlans<T extends SortablePlan>(rows: T[], sort: PlanListSort): T[] {
  if (sort === 'manual') return rows;
  const out = [...rows];
  switch (sort) {
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name));
    case 'target':
      // Sin fecha al final, como Linear.
      return out.sort((a, b) => (a.target_date ?? '9999').localeCompare(b.target_date ?? '9999'));
    case 'progress':
      return out.sort((a, b) => b.progress.percent - a.progress.percent);
    case 'created':
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case 'updated':
      return out.sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at));
  }
  return out;
}
