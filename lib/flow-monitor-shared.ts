/** Filtros del historial global de corridas (compartidos con el cliente). */
export const RUN_FILTER_STATUSES = ['success', 'failed', 'running', 'waiting', 'queued', 'held'] as const;
export type RunFilterStatus = (typeof RUN_FILTER_STATUSES)[number];
/** Rangos de días del historial y del tablero. */
export const RUN_RANGES = [1, 7, 30, 90] as const;
