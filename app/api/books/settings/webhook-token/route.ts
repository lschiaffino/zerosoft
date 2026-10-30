import { handle } from '@/lib/books-http';
import { getDb } from '@/lib/db';
import { audit, ensureBooks } from '@/lib/books';
import { paymentsView } from '@/lib/books-payments';
import { BooksError, newToken, nowDb } from '@/lib/books-schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** POST /api/books/settings/webhook-token: nueva URL de webhooks (la anterior deja de funcionar). Admins. */
export async function POST() {
  return handle(async ({ actor }) => {
    if (!actor.admin) throw new BooksError('forbidden', 403);
    await ensureBooks(actor.ws);
    await getDb().prepare('UPDATE books_settings SET webhook_token = ?, updated_at = ? WHERE workspace_id = ?').run(newToken(), nowDb(), actor.ws);
    await audit(actor, 'payments.rotate_token', 'settings', null);
    return { payments: paymentsView(await ensureBooks(actor.ws)) };
  });
}
