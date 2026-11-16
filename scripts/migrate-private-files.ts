/**
 * Pasa los archivos de antes (URLs públicas del Blob de la suite, /uploads/…
 * del disco local) al storage privado de lib/files/store.ts y reescribe las
 * referencias en la base a /api/files/<id>/<nombre>. Lógica: lib/files/migrate.ts.
 *
 *   npx tsx scripts/migrate-private-files.ts --dry-run          # solo cuenta: archivos y bytes por carpeta
 *   npx tsx scripts/migrate-private-files.ts --apply            # copia, verifica y reescribe (no borra nada)
 *   npx tsx scripts/migrate-private-files.ts --apply --limit 500 --folders chat,inbox --tables groups_messages
 *   npx tsx scripts/migrate-private-files.ts --apply --delete-originals   # además borra los originales ya migrados y verificados
 *
 * Variables: las de la app (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN,
 * BLOB_READ_WRITE_TOKEN, ENCRYPTION_KEY / NEXTAUTH_SECRET o FILES_KEY, y
 * FILES_BLOB_READ_WRITE_TOKEN si hay store privado). Idempotente: se puede
 * cortar y volver a correr. Sin --apply es --dry-run.
 */
import { ensureMigrated, getClient } from '../lib/db';
import { fileBackend } from '../lib/files/store';
import { migratePrivateFiles } from '../lib/files/migrate';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmt = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const deleteOriginals = apply && process.argv.includes('--delete-originals');
  const limit = arg('--limit') ? Number(arg('--limit')) : undefined;
  const batch = arg('--batch') ? Number(arg('--batch')) : undefined;
  const folders = arg('--folders')?.split(',').map((s) => s.trim()).filter(Boolean);
  const tables = arg('--tables')?.split(',').map((s) => s.trim()).filter(Boolean);
  const backend = fileBackend();
  console.log(`Backend: ${backend}${apply ? '' : ' (dry run: nothing is copied, rewritten or deleted)'}`);
  if (apply && backend === 'unavailable') throw new Error('No storage configured (BLOB_READ_WRITE_TOKEN or FILES_BLOB_READ_WRITE_TOKEN).');
  await ensureMigrated();
  // Nunca se imprimen URLs ni nombres de archivo: solo carpetas, cuentas y bytes.
  const report = await migratePrivateFiles(getClient(), { apply, deleteOriginals, limit, batch, folders, tables, log: (l) => console.log(`  ${l}`) });
  console.log('By folder:');
  for (const [folder, c] of Object.entries(report.byFolder).sort()) console.log(`  ${folder.padEnd(10)} ${String(c.files).padStart(7)} files  ${fmt(c.bytes)}`);
  console.log(`Total: ${report.total.files} files, ${fmt(report.total.bytes)}`);
  if (Object.keys(report.skippedFolders).length) console.log(`Not migrated here (own storage or transient): ${JSON.stringify(report.skippedFolders)}`);
  if (report.unmapped.length) {
    console.log('References in tables without a known workspace (not migrated):');
    for (const u of report.unmapped) console.log(`  ${u.table}.${u.column}: ${u.cells}`);
  }
  if (apply) {
    console.log(`Registered ${report.registered} · copied and verified ${report.copied} · rewritten cells ${report.rewrittenCells} · deleted originals ${report.deleted}`);
    if (report.failed.length) {
      console.error(`Failed: ${report.failed.length}`);
      const reasons: Record<string, number> = {};
      for (const f of report.failed) reasons[f.reason] = (reasons[f.reason] ?? 0) + 1;
      console.error(`  ${JSON.stringify(reasons)}`);
      process.exitCode = 1;
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
