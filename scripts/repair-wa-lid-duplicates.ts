/**
 * Inbox y Lines: junta los chats 1:1 duplicados de la misma persona (uno por
 * su lid de WhatsApp y otro por su teléfono) que ya quedaron en la base.
 *
 *   npx tsx scripts/repair-wa-lid-duplicates.ts           # solo informa lo que haría (no cambia nada)
 *   npx tsx scripts/repair-wa-lid-duplicates.ts --apply   # lo hace
 *
 * Usa las mismas variables que la app (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN).
 * Idempotente: se puede volver a correr; la segunda vez no encuentra nada.
 * El informe tiene solo cuentas (ni teléfonos, ni lids, ni nombres).
 * Detalle en lib/wa-dedupe-repair.ts. En producción, desde el cron: MAINTENANCE_JOBS=lid-repair:dry y después
 * lid-repair:apply (lib/maintenance-jobs.ts).
 */
import { ensureMigrated, getClient } from '../lib/db';
import { repairLidDuplicates } from '../lib/wa-dedupe-repair';

async function main() {
  const apply = process.argv.includes('--apply');
  await ensureMigrated();
  const r = await repairLidDuplicates(getClient(), { apply });
  console.log(apply ? 'Applied.' : 'Dry run (nothing changed; pass --apply to do it).');
  console.log(`Before: ${JSON.stringify(r.before)}`);
  console.log(`Inbox: ${r.inbox.merged} lid chats merged into the phone chat, ${r.inbox.renamed} moved to the phone id, ${r.inbox.messages} repeated messages removed`);
  console.log(`Lines: ${r.lines.merged} lid chats merged into the phone chat, ${r.lines.renamed} moved to the phone id, ${r.lines.messages} repeated messages removed`);
  console.log(`Inbox lid chats with digits in handle cleared: ${r.inboxLidHandles}`);
  console.log(`After: ${JSON.stringify(r.after)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
