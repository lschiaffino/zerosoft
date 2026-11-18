/** Meses de un presupuesto (puro, se usa también en el cliente). */
export function budgetMonths(startMonth: string, months: number): string[] {
  const [y, m] = startMonth.split('-').map(Number);
  return Array.from({ length: months }, (_, i) => new Date(Date.UTC(y, m - 1 + i, 1)).toISOString().slice(0, 7));
}
