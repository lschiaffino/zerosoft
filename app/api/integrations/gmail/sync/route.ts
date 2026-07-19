import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getDb } from '@/lib/db';
import { runWorkflowsForEvent } from '@/lib/crm-workflows';
import {
  getIntegration,
  getValidAccessToken,
  gmailGetMessageMeta,
  gmailListMessageIds,
  touchIntegrationSync,
} from '@/lib/integrations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const CONTACTS_PER_SYNC = 100;
const MESSAGES_PER_CONTACT = 8;
const CHUNK = 5;

/**
 * Sincroniza emails de Gmail → crm_emails para los contactos del CRM.
 * Por contacto busca `from:x OR to:x`, saltea los gmail_id ya importados
 * (UNIQUE user_id+gmail_id) e inserta metadata mínima (sin cuerpo).
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const integration = await getIntegration(user.id, 'gmail');
  if (!integration) return NextResponse.json({ error: 'not_connected' }, { status: 400 });

  const token = await getValidAccessToken(integration);
  if (!token) return NextResponse.json({ error: 'token_expired' }, { status: 400 });

  const db = getDb();
  const known = new Set(
    (
      (await db.prepare('SELECT gmail_id FROM crm_emails WHERE user_id = ?').all(user.id)) as Array<{
        gmail_id: string;
      }>
    ).map((r) => r.gmail_id),
  );

  const contacts = (await db
    .prepare(
      `SELECT id, email FROM crm_contacts
       WHERE user_id = ? AND email != '' AND email IS NOT NULL
       ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(user.id, CONTACTS_PER_SYNC)) as Array<{ id: string; email: string }>;

  const insert = db.prepare(
    `INSERT OR IGNORE INTO crm_emails
       (id, user_id, contact_id, gmail_id, thread_id, direction, from_email, to_emails,
        subject, snippet, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let synced = 0;

  async function syncContact(contact: { id: string; email: string }): Promise<void> {
    const q = `from:${contact.email} OR to:${contact.email}`;
    const ids = (await gmailListMessageIds(token!, q, MESSAGES_PER_CONTACT)).filter(
      (m) => !known.has(m.id),
    );
    for (const m of ids) {
      const meta = await gmailGetMessageMeta(token!, m.id);
      if (!meta) continue;
      known.add(meta.id);
      const direction = meta.from.toLowerCase().includes(contact.email.toLowerCase())
        ? 'in'
        : 'out';
      const emailId = crypto.randomUUID();
      const res = await insert.run(
        emailId,
        user!.id,
        contact.id,
        meta.id,
        meta.threadId,
        direction,
        meta.from,
        meta.to,
        meta.subject,
        meta.snippet,
        meta.internalDate,
      );
      if (res.changes) {
        synced += res.changes;
        await runWorkflowsForEvent(user!.id, {
          type: 'email_received',
          entity: 'email',
          entityId: emailId,
          payload: { contactId: contact.id, gmailId: meta.id, direction },
        });
      }
    }
  }

  for (let i = 0; i < contacts.length; i += CHUNK) {
    await Promise.all(contacts.slice(i, i + CHUNK).map((c) => syncContact(c).catch(() => null)));
  }

  await touchIntegrationSync(user.id, 'gmail');
  return NextResponse.json({ ok: true, synced, contacts: contacts.length });
}
