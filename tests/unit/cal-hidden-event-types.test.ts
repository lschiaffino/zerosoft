import { describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db';
import { createEventType, getOrCreateCalendarUser, getPublicProfile, updateEventType } from '@/lib/calendar';
import { eventTypeCreateSchema } from '@/lib/calendar-schema';
import { makeUser } from './helpers';

async function setup(label: string) {
  const user = await makeUser(label);
  await getOrCreateCalendarUser(user.id);
  const handle = ((await getDb().prepare('SELECT handle FROM users WHERE id = ?').get(user.id)) as { handle: string }).handle;
  const cal = { handle };
  const mk = (slug: string, extra: Record<string, unknown> = {}) =>
    createEventType(user.id, {
      slug: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
      title: slug,
      durationMin: 30,
      active: true,
      ...extra,
    } as Parameters<typeof createEventType>[1]);
  return { user, cal, mk };
}

describe('Cal: tipos de evento ocultos', () => {
  it('el schema acepta hidden', () => {
    const r = eventTypeCreateSchema.safeParse({ slug: 'a-b', title: 'A', durationMin: 30, hidden: true });
    expect(r.success).toBe(true);
  });

  it('un tipo oculto no sale en la página pública pero el link directo lo encuentra', async () => {
    const { user, cal, mk } = await setup('hid1');
    const shown = await mk('visible');
    const hidden = await mk('secret', { hidden: true });
    expect(hidden.hidden).toBe(1);
    const profile = await getPublicProfile(cal.handle);
    const ids = profile!.eventTypes.map((e) => e.id);
    expect(ids).toContain(shown.id);
    expect(ids).not.toContain(hidden.id);
    expect(user.id).toBeTruthy();
  });

  it('se puede ocultar y mostrar de nuevo', async () => {
    const { user, cal, mk } = await setup('hid2');
    const et = await mk('toggle');
    expect(et.hidden).toBe(0);
    await updateEventType(user.id, et.id, { hidden: true });
    expect((await getPublicProfile(cal.handle))!.eventTypes.map((e) => e.id)).not.toContain(et.id);
    await updateEventType(user.id, et.id, { hidden: false });
    expect((await getPublicProfile(cal.handle))!.eventTypes.map((e) => e.id)).toContain(et.id);
  });
});
