'use client';

/**
 * Analytics del lado del cliente: pedidos a /api/bi/*, el aviso de cambios
 * (sidebar y listas se recargan sin refrescar la página) y textos de error.
 */
export const BI_CHANGED = 'zs:bi-changed';

export function notifyBiChanged(): void {
  window.dispatchEvent(new Event(BI_CHANGED));
}

export class BiApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public detail?: string | null,
  ) {
    super(code);
  }
}

export async function biApi<T>(url: string, init?: { method?: string; body?: unknown; signal?: AbortSignal }): Promise<T> {
  const res = await fetch(url, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
    signal: init?.signal,
    cache: 'no-store',
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new BiApiError(typeof data.error === 'string' ? data.error : 'request_failed', res.status, (data.detail as string | null) ?? null);
  return data as T;
}

/** Códigos que tienen texto propio en bi.errors; el resto cae en el genérico. */
const KNOWN = new Set([
  'admin_only',
  'forbidden',
  'not_found',
  'query_timeout',
  'busy',
  'sql_error',
  'sql_must_start_with_select',
  'sql_multiple_statements',
  'sql_keyword_not_allowed',
  'sql_function_not_allowed',
  'sql_table_not_allowed',
  'sql_too_many_tables',
  'sql_join_not_allowed',
  'sql_join_without_condition',
  'sql_comments_not_allowed',
  'sql_quoted_identifiers_not_allowed',
  'sql_parameters_not_allowed',
  'sql_admins_only',
  'param_required',
  'param_not_number',
  'param_not_date',
  'unknown_column',
  'unknown_table',
  'join_not_allowed',
  'filter_value_required',
  'aggregation_column_required',
  'private_host',
  'invalid_host',
  'unresolvable_host',
  'connect_failed',
  'invalid_config',
  'result_too_large',
  'recipient_not_member',
  'invalid_recipients',
  'channel_not_found',
  'talk_not_available',
  'ai_disabled',
  'quota_exceeded',
  'rate_limited',
  'too_many_shares',
  'too_many_cards',
  'too_many_subscriptions',
  'invalid_input',
]);

/** Mensaje legible para un error de la API (con el detalle del motor si lo hay). */
export function biErrorText(err: unknown, t: (key: string, values?: Record<string, string>) => string): string {
  if (err instanceof BiApiError) {
    const base = KNOWN.has(err.code) ? t(`errors.${err.code}`) : t('errors.generic');
    return err.detail && (err.code.startsWith('sql') || err.code === 'connect_failed' || err.code.startsWith('param') || err.code.startsWith('unknown')) ? `${base} ${err.detail}` : base;
  }
  return t('errors.generic');
}
