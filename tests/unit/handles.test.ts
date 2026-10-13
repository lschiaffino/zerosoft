import { describe, expect, it } from 'vitest';
import { handleBase, isValidHandle, pickHandle } from '@/lib/schema/handles';
import { getUserById, setUserHandle } from '@/lib/db';
import { makeUser } from './helpers';

describe('handles públicos', () => {
  it('derivan del email y se normalizan', () => {
    expect(handleBase('Lautaro.Schiaffino@x.com')).toBe('lautaro-schiaffino');
    expect(handleBase('José@x.com')).toBe('jose');
  });

  it('evitan reservados y colisiones', () => {
    expect(isValidHandle('admin')).toBe(false);
    expect(pickHandle('admin@x.com', new Set())).toBe('admin-1');
    expect(pickHandle('ana@x.com', new Set(['ana', 'ana-2']))).toBe('ana-3');
  });

  it('todo usuario nuevo tiene handle único y se puede cambiar', async () => {
    const a = await makeUser('same');
    const b = await makeUser('same');
    expect(a.handle).toBeTruthy();
    expect(a.handle).not.toBe(b.handle);
    expect(await setUserHandle(a.id, b.handle!)).toEqual({ ok: false, code: 'handle_taken' });
    expect(await setUserHandle(a.id, 'No Válido')).toEqual({ ok: false, code: 'invalid_handle' });
    expect(await setUserHandle(a.id, `nuevo-${a.id.slice(-6)}`)).toEqual({ ok: true });
    expect((await getUserById(a.id))?.handle).toBe(`nuevo-${a.id.slice(-6)}`);
  });
});
