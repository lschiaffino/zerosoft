import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCampaign, getCampaign, processChatCampaigns, startCampaign } from '@/lib/chat-campaigns';
import { setCampaignOptIn } from '@/lib/chat-companies';
import { createChatWidget, getOrCreateChatVisitor } from '@/lib/chat-data';
import { getDb } from '@/lib/db';
import { makeUser } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
});

describe('consentimiento e identidad del visitante', () => {
  it('cambiar el email por el widget borra el consentimiento; repetir el mismo o cambiar el nombre no', async () => {
    const owner = await makeUser('o2');
    const widget = await createChatWidget(owner.id, null, { name: 'W' } as never);
    const v = await getOrCreateChatVisitor(widget.id, 'k2', { email: 'a@x.io' });
    await setCampaignOptIn(v.id, true);
    expect((await getOrCreateChatVisitor(widget.id, 'k2', { email: 'A@x.io' })).campaign_opt_in_at).toBeTruthy();
    expect((await getOrCreateChatVisitor(widget.id, 'k2', { name: 'Ana' })).campaign_opt_in_at).toBeTruthy();
    const moved = await getOrCreateChatVisitor(widget.id, 'k2', { email: 'victima@x.io' });
    expect(moved.email).toBe('victima@x.io');
    expect(moved.campaign_opt_in_at).toBeNull();
  });

  it('un email firmado nuevo tampoco hereda el consentimiento', async () => {
    const owner = await makeUser('o3');
    const widget = await createChatWidget(owner.id, null, { name: 'W' } as never);
    const v = await getOrCreateChatVisitor(widget.id, 'k3', { email: 'a@x.io', verified: true });
    await setCampaignOptIn(v.id, true);
    expect((await getOrCreateChatVisitor(widget.id, 'k3', { email: 'a@x.io', verified: true })).campaign_opt_in_at).toBeTruthy();
    expect((await getOrCreateChatVisitor(widget.id, 'k3', { email: 'b@x.io', verified: true })).campaign_opt_in_at).toBeNull();
  });
});

describe('reintento de campañas contra Resend', () => {
  it('manda la misma Idempotency-Key en cada intento, también tras un 5xx', async () => {
    const owner = await makeUser('o');
    const widget = await createChatWidget(owner.id, null, { name: 'W' } as never);
    await setCampaignOptIn((await getOrCreateChatVisitor(widget.id, 'k', { email: 'a@x.io' })).id, true);
    const c = await createCampaign(owner.id, owner.id, { name: 'C', subject: 'S', body: 'B', widget_id: widget.id });
    await startCampaign(owner.id, c.id);
    process.env.RESEND_API_KEY = 'test';
    const keys: Array<string | undefined> = [];
    const statuses = [503, 200];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        keys.push((init.headers as Record<string, string>)['Idempotency-Key']);
        const status = statuses.shift()!;
        return new Response(JSON.stringify(status === 200 ? { id: 'x' } : { message: 'down' }), { status });
      }),
    );
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).retried).toBe(1);
    await getDb().prepare('UPDATE chat_campaign_recipients SET next_attempt_at = NULL WHERE campaign_id = ?').run(c.id);
    expect((await processChatCampaigns({ campaignId: c.id, gapMs: 0 })).sent).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    const done = await getCampaign(owner.id, c.id);
    expect(done?.status).toBe('sent');
    // Un reintento no gasta cupo dos veces.
    const used = (await getDb().prepare('SELECT used FROM chat_campaign_usage WHERE workspace_id = ?').get(owner.id)) as { used: number };
    expect(Number(used.used)).toBe(1);
  });
});
