/**
 * Fotos de perfil de los participantes de los grupos (Inbox y Lines): cuándo
 * se piden, que un 429 frena la tanda sin tomarlo como "sin foto", que una
 * foto que no cambió no se vuelve a bajar y que se muestran en los
 * participantes de Inbox y en los miembros de Lines. Números inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { ProviderError } from '@/lib/groups-provider';
import { lookupContacts, rememberContacts, type ContactScope } from '@/lib/wa-contacts';
import {
  applyPicture,
  contactPictures,
  pictureDue,
  pictureSource,
  PICTURE_TTL_MS,
  refreshContactPictures,
  resetPicturePauses,
  type PictureRow,
} from '@/lib/wa-contact-pictures';
import { makeUser } from './helpers';

beforeEach(() => {
  vi.stubEnv('GROUPS_FAKE', '1');
  resetPicturePauses();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const A = '5491170001112';
const B = '5491170002224';
const C = '5491170003336';
const pic = (n: number) => `https://pps.whatsapp.net/v/t61/${n}.jpg?oh=firma${n}&oe=vence`;

async function scopeFor(): Promise<ContactScope> {
  const user = await makeUser('wa-pics');
  return { app: 'lines', accountId: `num_${user.id}`, userId: user.id };
}

async function row(scope: ContactScope, phone: string): Promise<PictureRow> {
  return (await lookupContacts(scope, [phone])).get(phone) as PictureRow;
}

describe('fotos de contactos (puro)', () => {
  it('toca pedirla si nunca se pidió o pasó una semana', () => {
    const now = new Date('2026-11-15T12:00:00Z');
    expect(pictureDue({ picture_at: null }, now)).toBe(true);
    expect(pictureDue({ picture_at: new Date(now.getTime() - 3_600_000).toISOString() }, now)).toBe(false);
    expect(pictureDue({ picture_at: new Date(now.getTime() - PICTURE_TTL_MS - 1).toISOString() }, now)).toBe(true);
  });

  it('identifica la foto sin la firma que vence', () => {
    expect(pictureSource(pic(1))).toBe('pps.whatsapp.net/v/t61/1.jpg');
    expect(pictureSource(`${pic(1)}&otra=1`)).toBe(pictureSource(pic(1)));
    expect(pictureSource(pic(2))).not.toBe(pictureSource(pic(1)));
    expect(pictureSource('data:image/png;base64,AAAA')).toMatch(/^data:/);
  });
});

describe('refreshContactPictures', () => {
  it('pide una por persona, guarda la copia y no vuelve a pedir hasta que venza', async () => {
    const scope = await scopeFor();
    const asked: string[] = [];
    const provider: { profilePicture: (jid: string) => Promise<string> } = {
      profilePicture: async (jid: string) => {
        asked.push(jid);
        return jid.startsWith(B) ? '' : pic(Number(jid.replace(/@.*/, '').slice(-1)));
      },
    };
    const store = vi.fn(async (url: string) => `/uploads/chat/${pictureSource(url).split('/').pop()}`);
    // A aparece dos veces (remitente y miembro): se pide una vez. Nadie estaba en la libreta: entran.
    const n = await refreshContactPictures(scope, provider, [A, B, A, 'no-es-un-numero'], { gapMs: 0, store });
    expect(n).toBe(2);
    expect(asked).toEqual([`${A}@s.whatsapp.net`, `${B}@s.whatsapp.net`]);
    expect(store).toHaveBeenCalledTimes(1);
    const pics = await contactPictures(scope, [A, B]);
    expect(pics.get(A)).toBe('/uploads/chat/2.jpg');
    expect(pics.has(B)).toBe(false);

    // Al rato: nada vencido, nada que pedir.
    expect(await refreshContactPictures(scope, provider, [A, B], { gapMs: 0, store })).toBe(0);
    expect(asked).toHaveLength(2);

    // Una semana después: se vuelve a pedir; la misma foto (otra firma) no se baja de nuevo.
    const later = new Date(Date.now() + PICTURE_TTL_MS + 60_000);
    provider.profilePicture = async (jid: string) => {
      asked.push(jid);
      return jid.startsWith(A) ? `${pic(2)}&nueva=firma` : '';
    };
    expect(await refreshContactPictures(scope, provider, [A, B], { gapMs: 0, store, now: later })).toBe(2);
    expect(store).toHaveBeenCalledTimes(1);
    expect((await contactPictures(scope, [A])).get(A)).toBe('/uploads/chat/2.jpg');
  });

  it('respeta el tope por tanda', async () => {
    const scope = await scopeFor();
    const provider = { profilePicture: vi.fn(async () => '') };
    expect(await refreshContactPictures(scope, provider, [A, B, C], { gapMs: 0, limit: 2 })).toBe(2);
    expect(provider.profilePicture).toHaveBeenCalledTimes(2);
    // La tercera queda para la próxima.
    expect(await refreshContactPictures(scope, provider, [A, B, C], { gapMs: 0, limit: 2 })).toBe(1);
  });

  it('un 429 frena la tanda, no cuenta como "sin foto" y pausa la cuenta', async () => {
    const scope = await scopeFor();
    let calls = 0;
    const provider: { profilePicture: (jid: string) => Promise<string> } = {
      profilePicture: async () => {
        calls++;
        throw new ProviderError('rate_limited', 429);
      },
    };
    expect(await refreshContactPictures(scope, provider, [A, B], { gapMs: 0 })).toBe(0);
    expect(calls).toBe(1);
    // El reclamo se devolvió: la persona sigue pendiente.
    expect((await row(scope, A)).picture_at).toBeNull();
    // Pausada: ni siquiera pregunta.
    expect(await refreshContactPictures(scope, provider, [A, B], { gapMs: 0 })).toBe(0);
    expect(calls).toBe(1);
    resetPicturePauses();
    provider.profilePicture = async () => pic(5);
    expect(await refreshContactPictures(scope, provider, [A], { gapMs: 0, store: async () => '/uploads/chat/5.jpg' })).toBe(1);
    expect((await contactPictures(scope, [A])).get(A)).toBe('/uploads/chat/5.jpg');
  });

  it('otro error deja a la persona pendiente y sigue con la próxima', async () => {
    const scope = await scopeFor();
    const provider: { profilePicture: (jid: string) => Promise<string> } = {
      profilePicture: async (jid: string) => {
        if (jid.startsWith(A)) throw new ProviderError('provider_error', 500);
        return pic(4);
      },
    };
    expect(await refreshContactPictures(scope, provider, [A, B], { gapMs: 0, store: async () => '/uploads/chat/4.jpg' })).toBe(1);
    expect((await row(scope, A)).picture_at).toBeNull();
    expect((await contactPictures(scope, [B])).get(B)).toBe('/uploads/chat/4.jpg');
  });

  it('dos tandas a la vez no piden la misma persona (compare-and-set)', async () => {
    const scope = await scopeFor();
    const asked: string[] = [];
    const provider = {
      profilePicture: async (jid: string) => {
        asked.push(jid);
        await new Promise((r) => setTimeout(r, 5));
        return '';
      },
    };
    await Promise.all([refreshContactPictures(scope, provider, [A, B], { gapMs: 0 }), refreshContactPictures(scope, provider, [A, B], { gapMs: 0 })]);
    expect(asked.sort()).toEqual([`${A}@s.whatsapp.net`, `${B}@s.whatsapp.net`]);
  });

  it('sin el método en el proveedor no hace nada', async () => {
    const scope = await scopeFor();
    expect(await refreshContactPictures(scope, {}, [A], { gapMs: 0 })).toBe(0);
  });
});

describe('applyPicture', () => {
  it('sin foto borra la copia; una foto nueva reemplaza la anterior', async () => {
    const scope = await scopeFor();
    await rememberContacts(scope, [{ phone: A, push: 'Ana Prueba' }]);
    const r = await row(scope, A);
    await applyPicture(r, pic(1), async () => '/uploads/chat/uno.jpg');
    expect((await row(scope, A)).picture).toBe('/uploads/chat/uno.jpg');
    await applyPicture(await row(scope, A), pic(2), async () => '/uploads/chat/dos.jpg');
    expect((await row(scope, A)).picture).toBe('/uploads/chat/dos.jpg');
    await applyPicture(await row(scope, A), '');
    const after = await row(scope, A);
    expect(after.picture).toBe('');
    expect(after.picture_src).toBe('');
  });

  it('si no se pudo guardar, queda la que había', async () => {
    const scope = await scopeFor();
    await rememberContacts(scope, [{ phone: A }]);
    await applyPicture(await row(scope, A), pic(1), async () => '/uploads/chat/uno.jpg');
    await applyPicture(await row(scope, A), pic(2), async () => '');
    expect((await row(scope, A)).picture).toBe('/uploads/chat/uno.jpg');
  });

  it('al juntar la fila del lid con la del teléfono, la foto pasa a la principal', async () => {
    const scope = await scopeFor();
    const LID = '118571178918122';
    await rememberContacts(scope, [{ lid: LID, push: 'Lid Prueba' }]);
    await rememberContacts(scope, [{ phone: A }]);
    const lidRow = (await lookupContacts(scope, [LID])).get(LID) as PictureRow;
    await applyPicture(lidRow, pic(3), async () => '/uploads/chat/tres.jpg');
    await rememberContacts(scope, [{ phone: A, lid: LID }]);
    const merged = await row(scope, A);
    expect(merged.lid).toBe(LID);
    expect(merged.picture).toBe('/uploads/chat/tres.jpg');
    const n = (await getDb().prepare('SELECT COUNT(*) AS n FROM wa_contacts WHERE app = ? AND account_id = ?').get(scope.app, scope.accountId)) as { n: number };
    expect(Number(n.n)).toBe(1);
  });
});
