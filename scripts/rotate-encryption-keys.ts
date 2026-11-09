/**
 * Rotación de la clave maestra de cifrado de campos (lib/key-ring.ts).
 *
 *   npx tsx scripts/rotate-encryption-keys.ts           # solo cuenta lo pendiente
 *   npx tsx scripts/rotate-encryption-keys.ts --apply   # vuelve a cifrar con la clave activa
 *
 * Usa las mismas variables que la app (TURSO_DATABASE_URL, TURSO_AUTH_TOKEN,
 * ENCRYPTION_KEYS, ENCRYPTION_KEY / NEXTAUTH_SECRET, CREDENTIALS_KEY). Es idempotente:
 * se puede cortar y volver a correr. Procedimiento completo: docs/security/encryption.md.
 */
import { ensureMigrated, getClient } from '../lib/db';
import { activeKey, keyRing } from '../lib/key-ring';
import { rotateEncryptedValues } from '../lib/key-rotation';

async function main() {
  const apply = process.argv.includes('--apply');
  const ring = keyRing();
  console.log(`Active key: ${activeKey().id} · keys in ring: ${ring.map((k) => k.id).join(', ')}`);
  await ensureMigrated();
  const report = await rotateEncryptedValues(getClient(), { apply, log: (l) => console.log(`  ${l}`) });
  console.log(
    apply
      ? `Pending ${report.pending} · rewritten rows ${report.rotated} · unreadable ${report.unreadable} · changed meanwhile ${report.skipped}`
      : `Pending ${report.pending} (dry run: pass --apply to rewrite)`,
  );
  if (report.unreadable) {
    console.error('Some values could not be opened: keep the old keys in ENCRYPTION_KEYS until this is resolved.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
