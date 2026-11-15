import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatConversationRow } from '@/lib/db';
import { toPublicConversation } from '@/lib/chat-data';
import { publicView, type Resolved } from '@/lib/sign/signing';
import { makeUser } from './helpers';

/** Lo que sale por superficies públicas (sin sesión) no lleva datos internos ni secretos. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Chat: el visitante no recibe campos internos de su conversación', () => {
  it('solo id, estado, asunto y fechas', () => {
    const row = {
      id: 'c1', widget_id: 'w1', visitor_id: 'v1', status: 'open', subject: 'Hola', created_at: 'a', updated_at: 'b', resolved_at: null,
      assigned_to: 'agent-user-id', priority: 'high', team_id: 't1', sla_breach_at: 'x', snoozed_until: null, attributes: '{"plan":"vip"}', outbound_id: 'o1',
    } as unknown as ChatConversationRow;
    const out = toPublicConversation(row);
    expect(Object.keys(out).sort()).toEqual(['created_at', 'id', 'resolved_at', 'status', 'subject', 'updated_at', 'visitor_id', 'widget_id']);
    expect(toPublicConversation(null)).toBeNull();
  });
});

describe('Sign: antes del código por email no se ve el mensaje ni el email entero', () => {
  it('estado otp oculta; con sesión, se ve', async () => {
    const sender = await makeUser('sign-sender');
    const recipient = { id: 'r1', name: 'Ana', email: 'ana.private@client.test', role: 'signer', status: 'sent', order_index: 0 };
    const r = {
      env: { id: 'e1', status: 'sent', otp_required: 1, signing_order: 'parallel', title: 'Contrato', message: 'Monto confidencial', created_by: sender.id, expires_at: null, pages: '[]' },
      recipient,
      recipients: [recipient],
    } as unknown as Resolved;
    const locked = await publicView(r, false);
    expect(locked.state).toBe('otp');
    expect(locked.message).toBe('');
    expect(JSON.stringify(locked)).not.toContain('ana.private@client.test');
    const open = await publicView(r, true);
    expect(open.state).toBe('ready');
    expect(open.message).toBe('Monto confidencial');
    expect(open.recipient.email).toBe('ana.private@client.test');
  });
});
