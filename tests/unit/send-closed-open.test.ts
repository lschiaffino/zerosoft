import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createLink, updateLink, type LinkRow } from '@/lib/send/core';
import { recordClosedOpen } from '@/lib/send/viewer';
import { listNotifications } from '@/lib/notifications';
import type { SendActor } from '@/lib/send/types';
import { makeUser } from './helpers';

const BROWSER = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const meta = (ip: string, ua = BROWSER) => ({ headers: new Headers({ 'user-agent': ua }), ua, ip });

async function setup(label: string, input: Parameters<typeof createLink>[2] = {}) {
  const owner = await makeUser(label);
  const actor: SendActor = { ws: owner.id, person: owner.id, admin: true, email: owner.email ?? '', name: 'Owner' };
  const docId = `sd_${label}_${Math.random().toString(36).slice(2, 8)}`;
  const ts = new Date().toISOString();
  await getDb()
    .prepare("INSERT INTO send_documents (id, workspace_id, owner_id, title, sharing, created_at, updated_at) VALUES (?, ?, ?, ?, 'private', ?, ?)")
    .run(docId, owner.id, owner.id, 'Pitch', ts, ts);
  const link = await createLink(actor, { documentId: docId }, { name: 'Acme', ...input });
  return { owner, actor, docId, link };
}

const events = async (linkId: string) =>
  (await getDb().prepare("SELECT type, detail, email FROM send_events WHERE link_id = ? AND type = 'closed_open'").all(linkId)) as Array<{ type: string; detail: string; email: string | null }>;
const alerts = async (userId: string, linkId: string) => (await listNotifications(userId, { limit: 50 })).filter((n) => n.source_id === linkId);

describe('Send: abrir un link cerrado', () => {
  it('un link activo no registra nada', async () => {
    const { owner, link } = await setup('closed-active');
    expect(await recordClosedOpen(link, null, meta('10.0.0.1'))).toBe(false);
    expect(await events(link.id)).toHaveLength(0);
    expect(await alerts(owner.id, link.id)).toHaveLength(0);
  });

  it('deshabilitado: registra y avisa una vez por persona y por día', async () => {
    const { owner, actor, link } = await setup('closed-disabled');
    const off = (await updateLink(actor, link.id, { disabled: true })) as LinkRow;
    expect(await recordClosedOpen(off, null, meta('10.0.0.2'))).toBe(true);
    expect(await recordClosedOpen(off, null, meta('10.0.0.2'))).toBe(false);
    // Dos pedidos a la vez de la misma persona: pasa uno solo.
    const both = await Promise.all([recordClosedOpen(off, null, meta('10.0.0.3')), recordClosedOpen(off, null, meta('10.0.0.3'))]);
    expect(both.filter(Boolean)).toHaveLength(1);
    const ev = await events(link.id);
    expect(ev).toHaveLength(2);
    expect(ev.every((e) => e.detail === 'disabled')).toBe(true);
    expect(await alerts(owner.id, link.id)).toHaveLength(2);
  });

  it('vencido se registra como vencido', async () => {
    const { actor, link } = await setup('closed-expired', { expiresAt: new Date(Date.now() + 3600_000).toISOString() });
    const gone = await updateLink(actor, link.id, { expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect(await recordClosedOpen(gone, null, meta('10.0.0.4'))).toBe(true);
    expect((await events(link.id))[0].detail).toBe('expired');
  });

  it('bots y herramientas no cuentan', async () => {
    const { actor, link } = await setup('closed-bot');
    const off = await updateLink(actor, link.id, { disabled: true });
    expect(await recordClosedOpen(off, null, meta('10.0.0.5', 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'))).toBe(false);
    expect(await recordClosedOpen(off, null, meta('10.0.0.5', 'curl/8.4.0'))).toBe(false);
    expect(await recordClosedOpen(off, null, meta('10.0.0.5', ''))).toBe(false);
    expect(await events(link.id)).toHaveLength(0);
  });

  it('con avisos apagados registra pero no avisa', async () => {
    const { owner, actor, link } = await setup('closed-quiet', { notify: false });
    const off = await updateLink(actor, link.id, { disabled: true });
    expect(await recordClosedOpen(off, null, meta('10.0.0.6'))).toBe(true);
    expect(await events(link.id)).toHaveLength(1);
    expect(await alerts(owner.id, link.id)).toHaveLength(0);
  });

  it('respeta el tope de avisos por hora del link', async () => {
    const { owner, actor, link } = await setup('closed-cap');
    const off = await updateLink(actor, link.id, { disabled: true });
    for (let i = 0; i < 5; i++) expect(await recordClosedOpen(off, null, meta(`10.0.1.${i}`))).toBe(true);
    expect(await events(link.id)).toHaveLength(5);
    expect(await alerts(owner.id, link.id)).toHaveLength(3);
    const row = (await getDb().prepare('SELECT alert_digest FROM send_links WHERE id = ?').get(link.id)) as { alert_digest: number };
    expect(Number(row.alert_digest)).toBe(2);
  });
});
