/**
 * Track — helpers puros de milestones (se usan también en el cliente).
 */
interface MilestoneProgress {
  target_date: string | null;
  total: number;
  done: number;
}

/**
 * El milestone que viene: el primero sin terminar con fecha de hoy en
 * adelante, o si no hay, el primero sin terminar (vencido o sin fecha).
 */
export function upcomingMilestone<T extends MilestoneProgress>(
  milestones: T[],
  today: string,
): T | null {
  const open = milestones.filter((m) => m.total === 0 || m.done < m.total);
  return open.find((m) => m.target_date && m.target_date >= today) ?? open[0] ?? null;
}
