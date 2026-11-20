import { describe, expect, it } from 'vitest';
import { recipientDto, type RecipientRow } from '@/lib/sign/core';

const row = (over: Partial<RecipientRow>): RecipientRow => ({ id: 'r1', role: 'signer', name: 'Ana', email: 'ana@example.com', routing_order: 1, status: 'sent', notified_at: null, reminded_at: null, ...over }) as RecipientRow;

describe('Sign: recipientDto remindedAt', () => {
  it('no marca recordatorio si solo se envió la invitación', () => {
    const ts = '2026-11-01T10:00:00.000Z';
    expect(recipientDto(row({ notified_at: ts, reminded_at: ts }), true).remindedAt).toBeNull();
    expect(recipientDto(row({}), true).remindedAt).toBeNull();
  });
  it('devuelve la fecha del último recordatorio', () => {
    const dto = recipientDto(row({ notified_at: '2026-11-01T10:00:00.000Z', reminded_at: '2026-11-04T10:00:00.000Z' }), true);
    expect(dto.remindedAt).toBe('2026-11-04T10:00:00.000Z');
  });
});
