/**
 * Trabajo de mantenimiento `wa-webhook-header` (lib/maintenance-jobs.ts): vuelve
 * a registrar el webhook de las líneas de WhatsApp ya conectadas (Inbox y
 * Lines) con el secreto en un header en vez de la ruta (lib/wa-webhook-secret.ts).
 * No toca la sesión ni la vinculación: solo /webhook/set de cada instancia.
 *
 *   dry    cuenta cuántas se pasarían (no llama al servidor de WhatsApp)
 *   apply  las vuelve a registrar, de a tandas, con cursor
 *
 * Solo líneas conectadas con un proveedor que manda headers propios
 * (Evolution, el QR administrado). Las demás se pasan solas al volver a
 * vincular (connect registra la URL nueva), y la Cloud API de Meta sigue con la
 * ruta vieja. El informe tiene solo cuentas. Server-only.
 */
import { getDb } from './db';

export interface WebhookMigrateSide {
  seen: number;
  eligible: number;
  migrated: number;
  failed: number;
  skipped: number;
}

export interface WebhookMigrateState {
  phase: 'inbox' | 'lines' | 'done';
  cursor: string;
  inbox: WebhookMigrateSide;
  lines: WebhookMigrateSide;
}

export function newWebhookMigrateState(): WebhookMigrateState {
  const side = (): WebhookMigrateSide => ({ seen: 0, eligible: 0, migrated: 0, failed: 0, skipped: 0 });
  return { phase: 'inbox', cursor: '', inbox: side(), lines: side() };
}

/** Lo que hace falta para registrar una línea (inyectable en tests). */
export interface WebhookMigrateDeps {
  inbox: (id: string) => Promise<{ setWebhook?: (url: string, headers: Record<string, string>) => Promise<void>; url: string; headers: Record<string, string> } | null>;
  lines: (id: string) => Promise<{ setWebhook?: (url: string, headers: Record<string, string>) => Promise<void>; url: string; headers: Record<string, string> } | null>;
}

const defaultDeps: WebhookMigrateDeps = {
  async inbox(id) {
    const { getAccountById } = await import('./inbox/core');
    const { waProviderFor, webhookTargetFor } = await import('./inbox/whatsapp');
    const account = await getAccountById(id);
    if (!account) return null;
    const p = waProviderFor(account);
    const t = webhookTargetFor(account);
    return { setWebhook: p.setWebhook?.bind(p), ...t };
  },
  async lines(id) {
    const { getNumberRowById, providerFor, webhookTargetFor } = await import('./groups');
    const row = await getNumberRowById(id);
    if (!row) return null;
    const p = providerFor(row);
    const t = webhookTargetFor(row);
    return { setWebhook: p.setWebhook?.bind(p), ...t };
  },
};

const BATCH = 25;

/** Una tanda: avanza el cursor hasta `deadline`. Devuelve true al terminar. */
export async function webhookMigrateStep(
  state: WebhookMigrateState,
  opts: { apply: boolean; deadline: number; deps?: WebhookMigrateDeps },
): Promise<boolean> {
  const deps = opts.deps ?? defaultDeps;
  const db = getDb();
  while (state.phase !== 'done' && Date.now() < opts.deadline) {
    const side = state.phase;
    const sql =
      side === 'inbox'
        ? "SELECT id FROM inbox_accounts WHERE kind = 'whatsapp' AND status = 'connected' AND id > ? ORDER BY id LIMIT ?"
        : "SELECT id FROM groups_numbers WHERE status = 'connected' AND provider IN ('managed', 'evolution') AND id > ? ORDER BY id LIMIT ?";
    const rows = (await db.prepare(sql).all(state.cursor, BATCH)) as Array<{ id: string }>;
    if (!rows.length) {
      state.phase = side === 'inbox' ? 'lines' : 'done';
      state.cursor = '';
      continue;
    }
    const counts = state[side];
    for (const r of rows) {
      if (Date.now() >= opts.deadline) return false;
      state.cursor = r.id;
      counts.seen++;
      let line;
      try {
        line = await deps[side](r.id);
      } catch {
        // Sin proveedor válido (credenciales, modo no disponible): se pasa al volver a vincular.
        counts.skipped++;
        continue;
      }
      if (!line?.setWebhook) {
        counts.skipped++;
        continue;
      }
      counts.eligible++;
      if (!opts.apply) continue;
      try {
        await line.setWebhook(line.url, line.headers);
        counts.migrated++;
      } catch {
        counts.failed++;
      }
    }
  }
  return state.phase === 'done';
}
