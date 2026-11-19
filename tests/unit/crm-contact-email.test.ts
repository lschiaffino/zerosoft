/**
 * El email como identidad del contacto (lib/crm-contact-email.ts): la regla,
 * cada camino que crea o edita contactos, el 409 con su visibilidad, el
 * aislamiento entre workspaces y el listado de duplicados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getDb, type ChatVisitorRow, type CrmContactRow, type UserRow } from '@/lib/db';
import { createContact, deleteContact, getContact, listTimeline, mergeContacts, updateContact } from '@/lib/crm';
import {
  CONTACT_EMAIL_TAKEN,
  ContactEmailTakenError,
  emailTakenInfo,
  findContactByEmail,
  findDuplicateContacts,
} from '@/lib/crm-contact-email';
import { findOrCreateContact, logChatToCrm, recordBookingInCrm } from '@/lib/crm-integrations';
import { listTrash, restoreTrash } from '@/lib/crm-trash';
import { setMemberVisibility } from '@/lib/crm-visibility';
import { createApiKey } from '@/lib/api-auth';
import { createForm, submitForm } from '@/lib/crm-forms';
import type { FormField } from '@/lib/crm-forms-schema';
import { importContacts, importDeals } from '@/lib/crm-import';
import { createImportPreview, runImportStep, startImportJob } from '@/lib/crm-import-jobs';
import { createPipeline, createStage } from '@/lib/crm';
import { trackExtensionEmail } from '@/lib/crm-extension';
import { createBooking, createEventType, getOrCreateCalendarUser, setAvailability } from '@/lib/calendar';
import { createFlow } from '@/lib/flow';
import { runFlowNow } from '@/lib/flow-http';
import type { FlowGraph } from '@/lib/flow-schema';
import { toolCtx, type WriteTool } from '@/lib/assistant/registry';
import { toolsFor } from '@/lib/assistant/tools';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, roles, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));

const contactsRoute = await import('@/app/api/crm/contacts/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');
const v1Contacts = await import('@/app/api/v1/crm/contacts/route');
const v1Contact = await import('@/lib/routes/v1/crm/contacts/[id]/route');
const duplicatesRoute = await import('@/app/api/crm/contacts/duplicates/route');
const restoreRoute = await import('@/lib/routes/crm/trash/[id]/restore/route');

beforeEach(() => {
  session.user = null;
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (url: string, method: string, body: unknown, key?: string) =>
  new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

async function countByEmail(ws: string, email: string): Promise<number> {
  const row = (await getDb()
    .prepare('SELECT COUNT(*) AS c FROM crm_contacts WHERE user_id = ? AND lower(trim(email)) = lower(trim(?))')
    .get(ws, email)) as { c: number };
  return row.c;
}

/** Un duplicado de antes de la regla: se inserta directo, como los que puede haber en producción. */
async function legacyContact(ws: string, email: string, firstName: string, ownerId: string = ws): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare("INSERT INTO crm_contacts (id, user_id, owner_id, first_name, email) VALUES (?, ?, ?, ?, ?)")
    .run(id, ws, ownerId, firstName, email);
  return id;
}

async function taken(p: Promise<unknown>): Promise<ContactEmailTakenError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ContactEmailTakenError);
  return err as ContactEmailTakenError;
}

describe('email único: la regla', () => {
  it('no deja crear un segundo contacto con el mismo email, sin importar mayúsculas ni espacios', async () => {
    const ws = (await makeUser('uniq')).id;
    const first = await createContact(ws, { email: 'Vera.Lumen@orbita.test', firstName: 'Vera' });
    for (const email of ['vera.lumen@orbita.test', 'VERA.LUMEN@ORBITA.TEST', '  Vera.Lumen@orbita.test  ']) {
      const err = await taken(createContact(ws, { email, firstName: 'Otra' }));
      expect(err.code).toBe(CONTACT_EMAIL_TAKEN);
      expect(err.existing.id).toBe(first.id);
    }
    expect(await countByEmail(ws, 'vera.lumen@orbita.test')).toBe(1);
  });

  it('guarda el email sin espacios alrededor y lo encuentra en cualquier forma', async () => {
    const ws = (await makeUser('uniq')).id;
    const c = await createContact(ws, { email: '  Tilo@Prado.test ' });
    expect(c.email).toBe('Tilo@Prado.test');
    expect((await findContactByEmail(ws, ' tilo@prado.TEST'))?.id).toBe(c.id);
    expect(await findContactByEmail(ws, '')).toBeNull();
  });

  it('sin email no hay clave: se pueden crear muchos contactos sin email', async () => {
    const ws = (await makeUser('uniq')).id;
    await createContact(ws, { firstName: 'Sin' });
    await createContact(ws, { firstName: 'Email', email: '' });
    await createContact(ws, { firstName: 'Tampoco', email: '   ' });
    const row = (await getDb().prepare("SELECT COUNT(*) AS c FROM crm_contacts WHERE user_id = ? AND email = ''").get(ws)) as { c: number };
    expect(row.c).toBe(3);
  });

  it('varias altas a la vez con el mismo email: entra una sola', async () => {
    const ws = (await makeUser('race')).id;
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => createContact(ws, { email: 'carrera@pista.test', firstName: `N${i}` })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(ContactEmailTakenError);
    }
    expect(await countByEmail(ws, 'carrera@pista.test')).toBe(1);
  });

  it('editar: no se puede pasar al email de otro contacto; sí cambiar las mayúsculas del propio', async () => {
    const ws = (await makeUser('edit')).id;
    const a = await createContact(ws, { email: 'alba@norte.test', firstName: 'Alba' });
    const b = await createContact(ws, { email: 'bruno@norte.test', firstName: 'Bruno' });
    const err = await taken(updateContact(ws, b.id, { email: ' ALBA@norte.test ' }));
    expect(err.existing.id).toBe(a.id);
    expect((await getContact(ws, b.id))!.contact.email).toBe('bruno@norte.test');
    // El resto del patch tampoco se aplica cuando el email choca.
    await taken(updateContact(ws, b.id, { email: 'alba@norte.test', firstName: 'Cambiado' }));
    expect((await getContact(ws, b.id))!.contact.first_name).toBe('Bruno');
    expect((await updateContact(ws, b.id, { email: 'Bruno@Norte.test' }))!.email).toBe('Bruno@Norte.test');
    expect((await updateContact(ws, b.id, { email: 'libre@norte.test' }))!.email).toBe('libre@norte.test');
    // Vaciar el email siempre se puede.
    expect((await updateContact(ws, b.id, { email: '' }))!.email).toBe('');
  });

  it('un duplicado de antes se puede seguir editando (solo se chequea cuando el email cambia)', async () => {
    const ws = (await makeUser('legacy')).id;
    const a = await legacyContact(ws, 'doble@antes.test', 'Uno');
    const b = await legacyContact(ws, 'DOBLE@antes.test', 'Dos');
    expect((await updateContact(ws, b, { phone: '+54 11 5555 0101' }))!.phone).toBe('+54 11 5555 0101');
    // Mandar el mismo email (un formulario que manda todo el registro) tampoco choca.
    expect((await updateContact(ws, a, { email: 'doble@antes.test', jobTitle: 'Ventas' }))!.job_title).toBe('Ventas');
    // Pero no se suma un tercero.
    await taken(createContact(ws, { email: 'doble@antes.test' }));
    expect(await countByEmail(ws, 'doble@antes.test')).toBe(2);
  });

  it('papelera: un contacto borrado no bloquea el alta; restaurarlo con el email tomado se rechaza y no se pierde', async () => {
    const ws = (await makeUser('trash')).id;
    const old = await createContact(ws, { email: 'ida@vuelta.test', firstName: 'Vieja' });
    expect(await deleteContact(ws, old.id)).toBe(true);
    const fresh = await createContact(ws, { email: 'IDA@vuelta.test', firstName: 'Nueva' });

    const [entry] = await listTrash(ws);
    const res = await restoreTrash(ws, entry.id);
    expect(res).toMatchObject({ ok: false, reason: 'email_taken' });
    if (!res.ok && res.reason === 'email_taken') expect(res.existing.id).toBe(fresh.id);
    // No se restauró nada y la entrada sigue en la papelera.
    expect(await countByEmail(ws, 'ida@vuelta.test')).toBe(1);
    expect(await listTrash(ws)).toHaveLength(1);

    // Liberado el email (se cambia el del contacto nuevo), se restaura.
    await updateContact(ws, fresh.id, { email: 'otra@vuelta.test' });
    expect(await restoreTrash(ws, entry.id)).toMatchObject({ ok: true, recordId: old.id });
    expect((await findContactByEmail(ws, 'ida@vuelta.test'))?.id).toBe(old.id);
    expect(await listTrash(ws)).toHaveLength(0);
  });

  it('restaurar con el email libre anda como siempre', async () => {
    const ws = (await makeUser('trash')).id;
    const c = await createContact(ws, { email: 'sola@vuelta.test' });
    await deleteContact(ws, c.id);
    const [entry] = await listTrash(ws);
    expect(await restoreTrash(ws, entry.id)).toMatchObject({ ok: true, recordId: c.id });
  });

  it('otro workspace: el mismo email no choca ni se encuentra', async () => {
    const a = (await makeUser('wsa')).id;
    const b = (await makeUser('wsb')).id;
    const inA = await createContact(a, { email: 'compartido@dos.test', firstName: 'En A' });
    expect(await findContactByEmail(b, 'compartido@dos.test')).toBeNull();
    const inB = await createContact(b, { email: 'compartido@dos.test', firstName: 'En B' });
    expect(inB.id).not.toBe(inA.id);
    // Editar en B hacia un email que solo existe en A tampoco choca.
    const other = await createContact(b, { email: 'otro@dos.test' });
    await createContact(a, { email: 'solo-en-a@dos.test' });
    expect((await updateContact(b, other.id, { email: 'solo-en-a@dos.test' }))!.email).toBe('solo-en-a@dos.test');
    expect(await findDuplicateContacts(a)).toEqual([]);
    expect(await findDuplicateContacts(b)).toEqual([]);
  });

  it('fusionar un par de duplicados deja un solo contacto con ese email', async () => {
    const ws = (await makeUser('merge')).id;
    const keep = await legacyContact(ws, 'par@fusion.test', 'Queda');
    const drop = await legacyContact(ws, 'PAR@fusion.test', 'Sale');
    expect((await mergeContacts(ws, keep, drop))?.id).toBe(keep);
    expect(await countByEmail(ws, 'par@fusion.test')).toBe(1);
    expect(await findDuplicateContacts(ws)).toEqual([]);
  });
});

describe('email único: duplicados que ya existen', () => {
  it('lista los grupos que comparten email, el más antiguo primero, y nada más', async () => {
    const ws = (await makeUser('dups')).id;
    const db = getDb();
    const a = await legacyContact(ws, 'nora@grupo.test', 'Nora');
    const b = await legacyContact(ws, ' NORA@grupo.test', 'Nora bis');
    await db.prepare("UPDATE crm_contacts SET created_at = '2026-01-01 10:00:00' WHERE id = ?").run(a);
    await db.prepare("UPDATE crm_contacts SET created_at = '2026-02-01 10:00:00' WHERE id = ?").run(b);
    await createContact(ws, { email: 'unica@grupo.test' });
    await createContact(ws, { firstName: 'Sin email 1' });
    await createContact(ws, { firstName: 'Sin email 2' });

    const groups = await findDuplicateContacts(ws);
    expect(groups).toHaveLength(1);
    expect(groups[0].email).toBe('nora@grupo.test');
    expect(groups[0].contacts.map((c) => c.id)).toEqual([a, b]);
    expect(groups[0].contacts[0]).not.toHaveProperty('email_key');

    expect(await findDuplicateContacts(ws, { contactId: b })).toHaveLength(1);
    const lone = (await findContactByEmail(ws, 'unica@grupo.test'))!;
    expect(await findDuplicateContacts(ws, { contactId: lone.id })).toEqual([]);
  });

  it('la ruta solo muestra lo que cada persona ve, y a otro workspace nada', async () => {
    const w = await workspaceWithMember('dupvis');
    await setMemberVisibility(w.owner.id, 'mine');
    // Par del owner y par repartido entre el owner y `member`.
    await legacyContact(w.owner.id, 'del-owner@vis.test', 'A', w.owner.id);
    await legacyContact(w.owner.id, 'del-owner@vis.test', 'B', w.owner.id);
    await legacyContact(w.owner.id, 'mixto@vis.test', 'C', w.owner.id);
    await legacyContact(w.owner.id, 'mixto@vis.test', 'D', w.member.id);
    const get = async () => {
      const res = await duplicatesRoute.GET(new NextRequest('http://x/api/crm/contacts/duplicates'));
      return { status: res.status, body: (await res.json()) as { groups?: Array<{ email: string; contacts: Array<{ id: string }> }> } };
    };
    for (const r of roles(w)) {
      session.user = r.user;
      const { status, body } = await get();
      if (r.name === 'anonymous') expect(status).toBe(401);
      else if (r.name === 'owner') expect(body.groups!.map((g) => g.email).sort()).toEqual(['del-owner@vis.test', 'mixto@vis.test']);
      // `member` solo ve un contacto de cada grupo: no hay nada que fusionar ni que mostrarle.
      else expect(body.groups).toEqual([]);
    }
  });
});

describe('email único: rutas (409 y visibilidad)', () => {
  async function setup() {
    const w = await workspaceWithMember('r409');
    await setMemberVisibility(w.owner.id, 'mine');
    const hidden = await createContact(w.owner.id, { email: 'privada@cartera.test', firstName: 'Irene', lastName: 'Privada', ownerId: w.friend.id });
    const mine = await createContact(w.owner.id, { email: 'propia@cartera.test', firstName: 'Mora', lastName: 'Propia', ownerId: w.member.id });
    return { w, hidden, mine };
  }

  it('sesión: crear con un email que existe da 409 y no crea nada; el nombre y el id solo si se ve', async () => {
    const { w, hidden, mine } = await setup();
    const post = async (email: string) => {
      const res = await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { email, firstName: 'Intento' }));
      return { status: res.status, text: await res.text() };
    };

    session.user = asMember(w.owner, w.member);
    const seen = await post('PROPIA@cartera.test');
    expect(seen.status).toBe(409);
    expect(JSON.parse(seen.text)).toEqual({ error: 'contact_email_taken', existing: { id: mine.id, name: 'Mora Propia' } });

    const blind = await post('privada@cartera.test');
    expect(blind.status).toBe(409);
    expect(JSON.parse(blind.text)).toEqual({ error: 'contact_email_taken', existing: null });
    for (const leak of [hidden.id, 'Irene', 'Privada', w.friend.id]) expect(blind.text).not.toContain(leak);

    // El owner sí lo ve.
    session.user = asOwner(w.owner);
    expect(JSON.parse((await post('privada@cartera.test')).text).existing).toEqual({ id: hidden.id, name: 'Irene Privada' });

    expect(await countByEmail(w.owner.id, 'privada@cartera.test')).toBe(1);
    expect(await countByEmail(w.owner.id, 'propia@cartera.test')).toBe(1);

    session.user = null;
    expect((await post('privada@cartera.test')).status).toBe(401);
  });

  it('sesión: editar hacia un email que existe da 409 con la misma regla de visibilidad', async () => {
    const { w, hidden, mine } = await setup();
    session.user = asMember(w.owner, w.member);
    const res = await contactRoute.PATCH(json(`http://x/api/crm/contacts/${mine.id}`, 'PATCH', { email: 'privada@cartera.test' }), ctx(mine.id));
    expect(res.status).toBe(409);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'contact_email_taken', existing: null });
    expect(text).not.toContain(hidden.id);
    expect((await getContact(w.owner.id, mine.id))!.contact.email).toBe('propia@cartera.test');

    session.user = asOwner(w.owner);
    const asAdmin = await contactRoute.PATCH(json(`http://x/api/crm/contacts/${mine.id}`, 'PATCH', { email: 'privada@cartera.test' }), ctx(mine.id));
    expect(await asAdmin.json()).toEqual({ error: 'contact_email_taken', existing: { id: hidden.id, name: 'Irene Privada' } });
  });

  it('otro workspace: el mismo email se crea sin enterarse de nada', async () => {
    const { w } = await setup();
    session.user = asOwner(w.stranger);
    const res = await contactsRoute.POST(json('http://x/api/crm/contacts', 'POST', { email: 'privada@cartera.test', firstName: 'Ajena' }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as CrmContactRow).user_id).toBe(w.stranger.id);
    expect(await countByEmail(w.owner.id, 'privada@cartera.test')).toBe(1);
    expect(await countByEmail(w.stranger.id, 'privada@cartera.test')).toBe(1);
  });

  it('API v1: 409 con código estable; existingId solo si la key ve el contacto', async () => {
    const { w, hidden, mine } = await setup();
    const ownerKey = (await createApiKey(w.owner.id, 'owner', w.owner.id)).key;
    const memberKey = (await createApiKey(w.owner.id, 'member', w.member.id)).key;
    const strangerKey = (await createApiKey(w.stranger.id, 'stranger', w.stranger.id)).key;
    const post = async (key: string, email: string) => {
      const res = await v1Contacts.POST(json('http://x/api/v1/crm/contacts', 'POST', { email }, key));
      return { status: res.status, text: await res.text() };
    };

    const seen = await post(ownerKey, 'Privada@cartera.test');
    expect(seen.status).toBe(409);
    expect(JSON.parse(seen.text).error).toMatchObject({ code: 'contact_email_taken', existingId: hidden.id });

    const blind = await post(memberKey, 'privada@cartera.test');
    expect(blind.status).toBe(409);
    expect(JSON.parse(blind.text).error.code).toBe('contact_email_taken');
    expect(JSON.parse(blind.text).error).not.toHaveProperty('existingId');
    for (const leak of [hidden.id, 'Irene', 'Privada']) expect(blind.text).not.toContain(leak);

    expect(JSON.parse((await post(memberKey, 'propia@cartera.test')).text).error.existingId).toBe(mine.id);

    // PATCH: mismo código.
    const patch = await v1Contact.PATCH(json(`http://x/api/v1/crm/contacts/${mine.id}`, 'PATCH', { email: 'privada@cartera.test' }, memberKey), ctx(mine.id));
    expect(patch.status).toBe(409);
    const patchBody = (await patch.json()) as { error: Record<string, unknown> };
    expect(patchBody.error.code).toBe('contact_email_taken');
    expect(patchBody.error).not.toHaveProperty('existingId');

    // La key de otro workspace crea el suyo sin 409.
    expect((await post(strangerKey, 'privada@cartera.test')).status).toBe(201);
    expect(await countByEmail(w.owner.id, 'privada@cartera.test')).toBe(1);
  });

  it('restaurar desde la papelera: 409 con el existente solo si se ve', async () => {
    const { w, mine } = await setup();
    await deleteContact(w.owner.id, mine.id);
    const now = await createContact(w.owner.id, { email: 'propia@cartera.test', firstName: 'Nuevo', lastName: 'Dueño', ownerId: w.friend.id });
    const [entry] = await listTrash(w.owner.id);
    const restore = async () => {
      const res = await restoreRoute.POST(new NextRequest(`http://x/api/crm/trash/${entry.id}/restore`, { method: 'POST' }), ctx(entry.id));
      return { status: res.status, text: await res.text() };
    };
    // `member` ve su entrada en la papelera pero no el contacto que ahora tiene el email.
    session.user = asMember(w.owner, w.member);
    const blind = await restore();
    expect(blind.status).toBe(409);
    expect(JSON.parse(blind.text)).toEqual({ error: 'contact_email_taken', existing: null });
    expect(blind.text).not.toContain(now.id);
    session.user = asOwner(w.owner);
    expect(JSON.parse((await restore()).text)).toEqual({ error: 'contact_email_taken', existing: { id: now.id, name: 'Nuevo Dueño' } });
  });

  it('emailTakenInfo usa el email como nombre cuando el contacto no tiene', async () => {
    const ws = (await makeUser('info')).id;
    const c = await createContact(ws, { email: 'sin-nombre@info.test' });
    expect(emailTakenInfo(c, null)).toEqual({ existing: { id: c.id, name: 'sin-nombre@info.test' } });
    expect(emailTakenInfo(c, ['otra-persona'])).toEqual({ existing: null });
  });
});

describe('email único: entradas automáticas actualizan el contacto que ya existe', () => {
  it('findOrCreateContact (Cal, Chat, agentes, Shop, Voice): usa el existente y completa el teléfono vacío', async () => {
    const ws = (await makeUser('foc')).id;
    const existing = await createContact(ws, { email: 'lia@bosque.test', firstName: 'Lía' });
    const res = await findOrCreateContact(ws, { email: ' LIA@bosque.test ', name: 'Otro Nombre', phone: '+54 11 5555 0102' });
    expect(res.created).toBe(false);
    expect(res.contact.id).toBe(existing.id);
    expect(res.contact).toMatchObject({ first_name: 'Lía', phone: '+54 11 5555 0102' });
    expect(await countByEmail(ws, 'lia@bosque.test')).toBe(1);
  });

  it('findOrCreateContact a la vez: todas las llamadas terminan en el mismo contacto', async () => {
    const ws = (await makeUser('foc')).id;
    const all = await Promise.all(Array.from({ length: 5 }, () => findOrCreateContact(ws, { email: 'junta@bosque.test', name: 'Junta Uno' })));
    expect(new Set(all.map((r) => r.contact.id)).size).toBe(1);
    expect(all.filter((r) => r.created)).toHaveLength(1);
    expect(await countByEmail(ws, 'junta@bosque.test')).toBe(1);
  });

  it('Cal: la reserva de un email que existe deja la reunión en ese contacto', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const u = await makeUser('cal');
    const existing = await createContact(u.id, { email: 'Reserva@Agenda.test', firstName: 'Rita' });
    await getOrCreateCalendarUser(u.id);
    const et = await createEventType(u.id, {
      slug: `e-${crypto.randomUUID().slice(0, 6)}`,
      title: 'Intro call',
      durationMin: 30,
      active: true,
    } as Parameters<typeof createEventType>[1]);
    await setAvailability(et.id, { rules: [{ dayOfWeek: 1, startTime: '09:00', endTime: '12:00' }] });
    const d = new Date(Date.now() + 3 * 86_400_000);
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
    const booking = await createBooking({
      eventTypeId: et.id,
      email: 'reserva@agenda.test',
      name: 'Otro Nombre',
      start: `${d.toISOString().slice(0, 10)}T09:00:00.000Z`,
      locale: 'en',
    });
    await recordBookingInCrm(u.id, 'created', booking, 'Intro call');
    expect(await countByEmail(u.id, 'reserva@agenda.test')).toBe(1);
    const timeline = await listTimeline(u.id, { contactId: existing.id });
    expect(timeline.map((t) => t.type)).toEqual(['meeting']);
    expect((await getContact(u.id, existing.id))!.contact.first_name).toBe('Rita');
    vi.restoreAllMocks();
  });

  it('Chat: guardar la conversación de un email que existe la deja en ese contacto', async () => {
    const u = await makeUser('chat');
    const existing = await createContact(u.id, { email: 'visita@chat.test', firstName: 'Vito' });
    const visitor = {
      id: crypto.randomUUID(),
      widget_id: 'w',
      external_id: 'x',
      email: 'VISITA@chat.test',
      email_verified: 1,
      name: 'Otro Nombre',
      notes: null,
      metadata: '{}',
      created_at: '2026-10-12 10:00:00',
    } as unknown as ChatVisitorRow;
    const res = await logChatToCrm(u.id, {
      conversationId: 'conv-dup',
      subject: 'Precios',
      visitor,
      messages: [{ sender_type: 'visitor', body: 'Hola', created_at: '2026-10-12 10:00:00' }],
    });
    expect(res).toMatchObject({ created: false });
    if ('contact' in res) expect(res.contact.id).toBe(existing.id);
    expect(await countByEmail(u.id, 'visita@chat.test')).toBe(1);
    expect(await listTimeline(u.id, { contactId: existing.id })).toHaveLength(1);
  });

  const FIELDS: FormField[] = [
    { id: 'email', type: 'email', label: 'Email', property: 'email', required: true },
    { id: 'name', type: 'text', label: 'Name', property: 'fullName', required: false },
    { id: 'phone', type: 'text', label: 'Phone', property: 'phone', required: false },
  ];

  it('formulario del CRM sin "actualizar existentes": no crea otro contacto, completa lo vacío y no pisa', async () => {
    const ws = (await makeUser('form')).id;
    const existing = await createContact(ws, { email: 'eva@forma.test', firstName: 'Eva' });
    const form = await createForm(ws, { name: 'Contacto', fields: FIELDS, settings: { minSubmitSeconds: 0, updateExisting: false } });
    const res = await submitForm(form.token, { values: { email: 'EVA@forma.test', name: 'Otra Persona', phone: '+54 11 5555 0103' }, elapsedMs: 9000 });
    expect(res).toMatchObject({ ok: true, created: false, contactId: existing.id });
    expect(await countByEmail(ws, 'eva@forma.test')).toBe(1);
    const after = (await getContact(ws, existing.id))!.contact;
    // El nombre que tenía queda; el teléfono vacío se completa.
    expect(after).toMatchObject({ first_name: 'Eva', last_name: '', phone: '+54 11 5555 0103', email: 'eva@forma.test' });
    // El envío queda en el timeline del contacto que ya existía.
    expect((await listTimeline(ws, { contactId: existing.id })).length).toBeGreaterThan(0);
  });

  it('formulario del CRM con "actualizar existentes": pisa con lo que vino y nunca con vacíos', async () => {
    const ws = (await makeUser('form')).id;
    const existing = await createContact(ws, { email: 'ivo@forma.test', firstName: 'Ivo', phone: '+54 11 5555 0104' });
    const form = await createForm(ws, { name: 'Contacto', fields: FIELDS, settings: { minSubmitSeconds: 0, updateExisting: true } });
    const res = await submitForm(form.token, { values: { email: 'ivo@forma.test', name: 'Ivo Renovado', phone: '' }, elapsedMs: 9000 });
    expect(res).toMatchObject({ ok: true, created: false, contactId: existing.id });
    expect((await getContact(ws, existing.id))!.contact).toMatchObject({ first_name: 'Ivo', last_name: 'Renovado', phone: '+54 11 5555 0104' });
    expect(await countByEmail(ws, 'ivo@forma.test')).toBe(1);
  });

  it('import CSV: "skip" saltea y "update" actualiza el existente, también con otras mayúsculas y espacios', async () => {
    const ws = (await makeUser('csv')).id;
    const existing = await createContact(ws, { email: 'ana@planilla.test', firstName: 'Ana', phone: '+54 11 5555 0105' });
    const skip = await importContacts(ws, [{ email: ' ANA@planilla.test ', firstName: 'Pisada' }, { email: 'nueva@planilla.test', firstName: 'Nueva' }], 'skip');
    expect(skip).toMatchObject({ created: 1, skipped: 1, updated: 0 });
    expect((await getContact(ws, existing.id))!.contact.first_name).toBe('Ana');
    const update = await importContacts(ws, [{ email: 'Ana@Planilla.test', firstName: 'Ana María' }], 'update');
    expect(update).toMatchObject({ created: 0, updated: 1 });
    // Actualiza lo que vino y no vacía lo demás.
    expect((await getContact(ws, existing.id))!.contact).toMatchObject({ first_name: 'Ana María', phone: '+54 11 5555 0105' });
    expect(await countByEmail(ws, 'ana@planilla.test')).toBe(1);
    // Dos filas con el mismo email en la misma planilla: una sola alta.
    const twice = await importContacts(ws, [{ email: 'doble@planilla.test' }, { email: 'DOBLE@planilla.test' }], 'skip');
    expect(twice).toMatchObject({ created: 1, skipped: 1 });
    expect(await countByEmail(ws, 'doble@planilla.test')).toBe(1);
  });

  it('import CSV de deals: el contacto por email se reutiliza', async () => {
    const ws = (await makeUser('csvd')).id;
    const pipeline = await createPipeline(ws, 'Ventas');
    await createStage(ws, pipeline.id, { name: 'Nuevo' });
    const existing = await createContact(ws, { email: 'comprador@planilla.test' });
    const res = await importDeals(ws, [{ name: 'Plan anual', contactEmail: 'COMPRADOR@planilla.test' }], 'skip');
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(1);
    expect(await countByEmail(ws, 'comprador@planilla.test')).toBe(1);
    const link = (await getDb().prepare('SELECT COUNT(*) AS c FROM crm_deal_contacts WHERE contact_id = ?').get(existing.id)) as { c: number };
    expect(link.c).toBe(1);
  });

  it('import desde HubSpot: un email que ya existe (con otras mayúsculas) no se duplica', async () => {
    const ws = (await makeUser('hs')).id;
    const existing = await createContact(ws, { email: 'Person1@Company1.example', firstName: 'Local', phone: '+54 11 5555 0106' });
    process.env.CRM_IMPORT_FAKE = '1';
    const preview = await createImportPreview(ws, ws, 'hubspot', 'fake');
    if (!preview.ok) throw new Error(preview.code);
    const started = await startImportJob(ws, preview.job.id, { groups: ['companies', 'contacts'], ownerMap: preview.job.options.ownerMap, defaultOwnerId: ws });
    if (!started.ok) throw new Error(started.code);
    for (let i = 0; i < 500; i++) {
      const r = await runImportStep(started.job.id, { maxPages: 1 });
      if (r === 'done' || r === 'failed' || r === 'cancelled') break;
    }
    expect(await countByEmail(ws, 'person1@company1.example')).toBe(1);
    // Lo que el contacto local ya tenía no se pisa (se completa lo vacío).
    expect((await getContact(ws, existing.id))!.contact).toMatchObject({ first_name: 'Local', phone: '+54 11 5555 0106' });
    expect(await findDuplicateContacts(ws)).toEqual([]);
  });

  it('Robots: una fila con un email que existe actualiza según la regla del destino y no duplica', async () => {
    const { runDestinations } = await import('@/lib/robots-destinations');
    const ws = (await makeUser('robot')).id;
    const existing = await createContact(ws, { email: 'Lead@Robot.test', firstName: 'Lena' });
    await runDestinations({
      workspaceId: ws,
      robot: { id: crypto.randomUUID(), created_by: ws, name: 'Leads' },
      vars: { items: [{ email: 'lead@robot.test', name: 'Otro', phone: '+54 11 5555 0107' }] },
      datasetVariable: null,
      dataset: null,
      secrets: [],
      destinations: [
        { id: 'c', kind: 'crm', enabled: true, variable: 'items', object: 'contacts', mapping: { email: 'email', firstName: 'name', phone: 'phone' }, onExisting: 'fill' },
      ] as never,
    });
    expect(await countByEmail(ws, 'lead@robot.test')).toBe(1);
    expect((await getContact(ws, existing.id))!.contact).toMatchObject({ first_name: 'Lena', phone: '+54 11 5555 0107' });
  });

  it('Flow: el paso "crear contacto" usa el que ya existe y solo completa lo vacío', async () => {
    const ws = (await makeUser('flow')).id;
    const existing = await createContact(ws, { email: 'paso@flujo.test', firstName: 'Pía' });
    const graph: FlowGraph = {
      nodes: [
        { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
        { id: 'c', type: 'app.crm_contact', position: { x: 0, y: 0 }, config: { email: ' PASO@flujo.test ', firstName: 'Otra', phone: '+54 11 5555 0108' } },
      ] as FlowGraph['nodes'],
      edges: [{ id: 't-out-c', source: 't', target: 'c', sourceHandle: null }],
    };
    const flow = await createFlow(ws, ws, { name: 'F', graph });
    if (!flow.ok) throw new Error(flow.error);
    const run = await runFlowNow(ws, flow.flow.id, {});
    expect(run.ok && run.run?.status).toBe('success');
    const out = run.ok ? run.run?.steps.find((s) => s.nodeId === 'c')?.output : null;
    expect(out).toMatchObject({ created: false, contact: { id: existing.id } });
    expect(await countByEmail(ws, 'paso@flujo.test')).toBe(1);
    expect((await getContact(ws, existing.id))!.contact).toMatchObject({ first_name: 'Pía', phone: '+54 11 5555 0108' });
  });

  it('Flow: "actualizar contacto" hacia un email tomado falla con un código claro y no escribe', async () => {
    const ws = (await makeUser('flow')).id;
    await createContact(ws, { email: 'tomado@flujo.test' });
    const target = await createContact(ws, { email: 'mio@flujo.test' });
    const graph: FlowGraph = {
      nodes: [
        { id: 't', type: 'trigger.manual', position: { x: 0, y: 0 }, config: { sample: '{}' } },
        { id: 'u', type: 'app.crm_update', position: { x: 0, y: 0 }, config: { entity: 'contact', recordId: target.id, fields: [{ key: 'email', value: 'TOMADO@flujo.test' }] } },
      ] as FlowGraph['nodes'],
      edges: [{ id: 't-out-u', source: 't', target: 'u', sourceHandle: null }],
    };
    const flow = await createFlow(ws, ws, { name: 'F', graph });
    if (!flow.ok) throw new Error(flow.error);
    const run = await runFlowNow(ws, flow.flow.id, {});
    const step = run.ok ? run.run?.steps.find((s) => s.nodeId === 'u') : null;
    expect(step?.status).toBe('failed');
    expect(JSON.stringify(step)).toContain('contact_email_taken');
    expect((await getContact(ws, target.id))!.contact.email).toBe('mio@flujo.test');
  });

  it('extensión de Gmail: si el destinatario ya es contacto de otra persona no crea otro ni devuelve nada de él', async () => {
    const w = await workspaceWithMember('ext');
    const hidden = await createContact(w.owner.id, { email: 'cliente@correo.test', firstName: 'Clara', ownerId: w.friend.id });
    const actor = { workspaceId: w.owner.id, personId: w.member.id, scope: [w.member.id] };
    const res = await trackExtensionEmail(actor, { to: 'Cliente <CLIENTE@correo.test>', subject: 'Hola', body: 'Te escribo' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.createdContact).toBe(false);
    expect(res.contactIds).toEqual([]);
    expect(JSON.stringify(res)).not.toContain(hidden.id);
    expect(await countByEmail(w.owner.id, 'cliente@correo.test')).toBe(1);
    // El envío queda en el contacto que ya existía.
    const linked = (await getDb().prepare('SELECT contact_id FROM crm_emails WHERE id = ?').get(res.emailId)) as { contact_id: string };
    expect(linked.contact_id).toBe(hidden.id);
  });

  it('asistente: no prepara ni crea un contacto con un email que existe; nombra al existente solo si se ve', async () => {
    const w = await workspaceWithMember('asst');
    await setMemberVisibility(w.owner.id, 'mine');
    const hidden = await createContact(w.owner.id, { email: 'oculta@asistente.test', firstName: 'Olga', ownerId: w.friend.id });
    const tool = (user: UserRow | SessionUser) =>
      toolsFor(user as SessionUser).find((t) => t.name === 'propose_crm_create_contact') as WriteTool;
    const owner = asOwner(w.owner);
    const member = asMember(w.owner, w.member);

    const seen = (await tool(owner).prepare(toolCtx(owner, 'en'), { email: 'OCULTA@asistente.test' })) as { error?: string };
    expect(seen.error).toContain('contact_email_taken');
    expect(seen.error).toContain(hidden.id);

    const blind = (await tool(member).prepare(toolCtx(member, 'en'), { email: 'oculta@asistente.test' })) as { error?: string };
    expect(blind.error).toContain('contact_email_taken');
    for (const leak of [hidden.id, 'Olga']) expect(blind.error).not.toContain(leak);

    // Confirmar una tarjeta preparada antes de que el email existiera tampoco duplica.
    const late = await tool(member).execute(toolCtx(member, 'en'), { email: 'oculta@asistente.test', firstName: 'Tarde' });
    expect(late).toMatchObject({ ok: false, error: 'contact_email_taken' });
    expect(JSON.stringify(late)).not.toContain(hidden.id);
    expect(late.href).toBeUndefined();
    const lateOwner = await tool(owner).execute(toolCtx(owner, 'en'), { email: 'oculta@asistente.test' });
    expect(lateOwner).toMatchObject({ ok: false, error: 'contact_email_taken', href: `/app/crm/contacts/${hidden.id}` });
    expect(await countByEmail(w.owner.id, 'oculta@asistente.test')).toBe(1);
  });
});
