/**
 * Inbox y Lines: pasa al chat de Meta AI los mensajes de Meta AI que quedaron
 * en el chat con uno mismo (lib/wa-bot-self-repair.ts). Solo los que el
 * servidor de WhatsApp guarda con la marca de Meta AI; lo demás no se toca.
 *
 *   npx tsx scripts/repair-wa-bot-self-chat.ts           # solo cuenta (no cambia nada)
 *   npx tsx scripts/repair-wa-bot-self-chat.ts --apply   # lo hace
 *
 * Usa las mismas variables que la app. Idempotente. El informe tiene solo cuentas. En producción, desde el cron:
 * MAINTENANCE_JOBS=bot-self-repair:dry y después bot-self-repair:apply (lib/maintenance-jobs.ts).
 */
import { ensureMigrated } from '../lib/db';
import { repairBotSelfChat } from '../lib/wa-bot-self-repair';

async function main() {
  const apply = process.argv.includes('--apply');
  await ensureMigrated();
  const r = await repairBotSelfChat({ apply });
  console.log(apply ? 'Applied.' : 'Dry run (nothing changed; pass --apply to do it).');
  console.log(`Inbox: ${JSON.stringify(r.inbox)}`);
  console.log(`Lines: ${JSON.stringify(r.lines)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
