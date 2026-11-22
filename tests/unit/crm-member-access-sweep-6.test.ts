/**
 * CRM, sexta pasada: el alta de un contacto se vincula sola por el dominio
 * del email solo a una empresa que quien crea ve; el desglose del score sale
 * sin las reglas sobre campos ocultos en toda fila de contacto (listas, API,
 * MCP, eventos, Inbox) con un solo helper; las preguntas de un playbook que
 * van a un campo oculto no se muestran; una secuencia cuyo remitente salió del
 * workspace se pausa y avisa; la papelera no nombra la empresa (que no se ve)
 * en la que se fusionó algo; el MCP respeta "Exigir verificación en dos
 * pasos" también en la API v1; el catálogo de productos y renombrar o borrar
 * tags son de owner y admins; y el asistente lista solo salidas de secuencias
 * de contactos que quien pregunta ve. Miradas: owner, admin, miembro con
 * "mine", miembro de un equipo de ventas y otro workspace. Datos inventados.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCompany, createContact, createCustomField, getContact } from '@/lib/crm';
import { MEMBER_SUBJECT, redactRow, redactScoreBreakdown, setFieldPermissions, type HiddenFieldSet } from '@/lib/crm-field-perms';
import { createSalesTeam, setMemberVisibility } from '@/lib/crm-visibility';
import { contactScores, createScoreRule, recalcContactScore } from '@/lib/crm-scoring';
import { createPlaybook, playbooksForViewer } from '@/lib/crm-playbooks';
import { createSequence, enrollContacts, getEnrollment, processEnrollment, setEnrollmentState, SENDER_LEFT } from '@/lib/crm-sequences';
import { mergeCompanies } from '@/lib/crm-company-merge';
import { listTrash } from '@/lib/crm-trash';
import { createTag } from '@/lib/crm-tags';
import { createProduct } from '@/lib/crm-products';
import { recordEventFor, subscriberFor } from '@/lib/crm-event-privacy';
import { withViewerCrmContact } from '@/lib/chat-crm-contact';
import { createApiKey, requireApiUser } from '@/lib/api-auth';
import { importContacts } from '@/lib/crm-import';
import { logChatToCrm } from '@/lib/crm-integrations';
import { createNumber, upsertChat } from '@/lib/groups';
import { loadChatPage } from '@/lib/groups-page';
import { delegatedMfaOk, runAsDelegated } from '@/lib/mcp/identity';
import { resolvePerson, type McpCaller } from '@/lib/mcp/caller';
import { addMember, removeMember } from '@/lib/teams';
import { getDb, type CrmContactRow, type UserRow } from '@/lib/db';
import type { SessionUser } from '@/lib/session';
import { asMember, asOwner, workspaceWithMember } from './access-helpers';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock('@/lib/session', async (orig) => ({
  ...((await orig()) as object),
  getCurrentUser: async () => session.user,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

const contactsRoute = await import('@/app/api/crm/contacts/route');
const contactRoute = await import('@/lib/routes/crm/contacts/[id]/route');
const v1ContactsRoute = await import('@/app/api/v1/crm/contacts/route');
const playbooksRoute = await import('@/app/api/crm/playbooks/route');
const playbookRoute = await import('@/lib/routes/crm/playbooks/[id]/route');
const trashRoute = await import('@/app/api/crm/trash/route');
const productsRoute = await import('@/app/api/crm/products/route');
const productRoute = await import('@/lib/routes/crm/products/[id]/route');
const v1ProductsRoute = await import('@/app/api/v1/crm/products/route');
const v1ProductRoute = await import('@/lib/routes/v1/crm/products/[id]/route');
const tagsRoute = await import('@/app/api/crm/tags/route');
const tagRoute = await import('@/lib/routes/crm/tags/[id]/route');
const v1TagRoute = await import('@/lib/routes/v1/crm/tags/[id]/route');
const recordTagsRoute = await import('@/app/api/crm/tags/record/route');
const { ALL_TOOLS } = await import('@/lib/assistant/tools');
const { toolCtx } = await import('@/lib/assistant/registry');

beforeEach(() => {
  session.user = null;
  vi.stubEnv('RATE_LIMIT_DISABLED', 'true');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = async <T,>(res: Response) => (await res.json()) as T;
const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  new NextRequest(`http://localhost${url}`, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', ...headers },
  });

/**
 * Workspace con un admin, `secret` (contactos, empresas, deals) oculto para el
 * rol member, un equipo de ventas con `friend` y visibilidad "mine". La empresa
 * del owner (dominio acme-*.test) no la ven ni el member ni el friend; la del
 * friend solo el friend (y owner/admin).
 */
async function setup(label: string) {
  const w = await workspaceWithMember(label);
  const ws = w.owner.id;
  const adminPerson = await makeUser(`${label}-admin`);
  await addMember(w.team.id, adminPerson.id, 'admin');
  await setMemberVisibility(ws, 'mine');
  for (const entity of ['contacts', 'companies', 'deals']) {
    const f = await createCustomField(ws, { entity, name: 'secret', label: 'Secret', type: 'text' });
    await setFieldPermissions(ws, f.id, [{ subject: MEMBER_SUBJECT, access: 'hidden' }]);
  }
  const team = await createSalesTeam(ws, { name: 'Field', members: [w.friend.id] });
  const domain = `acme-${label}.test`;
  const ownerCo = await createCompany(ws, { name: 'Owner Holdings', domain, ownerId: ws });
  const friendDomain = `friendco-${label}.test`;
  const friendCo = await createCompany(ws, { name: 'Friend Partners', domain: friendDomain, ownerId: w.friend.id });
  return { w, ws, adminPerson, team, domain, ownerCo, friendDomain, friendCo };
}

type Setup = Awaited<ReturnType<typeof setup>>;
const owner = (s: Setup) => asOwner(s.w.owner);
const admin = (s: Setup) => asMember(s.w.owner, s.adminPerson, 'admin');
const member = (s: Setup) => asMember(s.w.owner, s.w.member);
const teamMember = (s: Setup) => asMember(s.w.owner, s.w.friend);
const stranger = (s: Setup) => asOwner(s.w.stranger);
const viewerOf = (s: Setup, personId: string, role: SessionUser['role'] = 'member') => ({ workspaceId: s.ws, personId, role });

// ---------- 1. Empresa por dominio al crear un contacto ----------

describe('alta de contacto: la empresa por dominio solo si quien crea la ve', () => {
  const create = async (user: SessionUser, email: string) => {
    session.user = user;
    const res = await contactsRoute.POST(send('POST', '/api/crm/contacts', { firstName: 'Zeta', email }));
    expect(res.status).toBe(201);
    return json<CrmContactRow & { company_private?: boolean }>(res);
  };

  it('owner y admin quedan vinculados a la empresa del dominio', async () => {
    const s = await setup('s6link-adm');
    expect((await create(owner(s), `ana@${s.domain}`)).company_id).toBe(s.ownerCo.id);
    expect((await create(admin(s), `bea@${s.domain}`)).company_id).toBe(s.ownerCo.id);
  });

  it('un miembro con "mine" no queda vinculado a una empresa que no ve, y la respuesta no la nombra', async () => {
    const s = await setup('s6link-mem');
    const c = await create(member(s), `carl@${s.domain}`);
    expect(c.company_id).toBeNull();
    expect(c.company_private).toBeUndefined();
    // En la base tampoco: el contacto queda sin empresa (no se crea otra).
    const stored = await getContact(s.ws, c.id);
    expect(stored?.contact.company_id).toBeNull();
    const companies = (await getDb().prepare('SELECT COUNT(*) AS n FROM crm_companies WHERE user_id = ? AND lower(domain) = ?').get(s.ws, s.domain)) as { n: number };
    expect(Number(companies.n)).toBe(1);
  });

  it('el miembro del equipo de ventas queda vinculado a su empresa, no a la del owner', async () => {
    const s = await setup('s6link-team');
    expect((await create(teamMember(s), `dan@${s.friendDomain}`)).company_id).toBe(s.friendCo.id);
    expect((await create(teamMember(s), `eva@${s.domain}`)).company_id).toBeNull();
    // El member no ve la del friend.
    expect((await create(member(s), `fay@${s.friendDomain}`)).company_id).toBeNull();
  });

  it('una empresa del mismo dominio en otro workspace no se vincula', async () => {
    const s = await setup('s6link-ext');
    const c = await create(stranger(s), `gus@${s.domain}`);
    expect(c.company_id).toBeNull();
  });

  it('al cambiar el email (edición) y por la API v1 vale lo mismo', async () => {
    const s = await setup('s6link-edit');
    const mine = await createContact(s.ws, { firstName: 'Hal', email: 'hal@gmail.com', ownerId: s.w.member.id });
    session.user = member(s);
    const res = await contactRoute.PATCH(send('PATCH', `/api/crm/contacts/${mine.id}`, { email: `hal@${s.domain}` }), ctx(mine.id));
    expect(res.status).toBe(200);
    expect((await json<CrmContactRow>(res)).company_id).toBeNull();
    // El owner sí: su edición vincula.
    const own = await createContact(s.ws, { firstName: 'Ivy', email: 'ivy@gmail.com', ownerId: s.ws });
    session.user = owner(s);
    const res2 = await contactRoute.PATCH(send('PATCH', `/api/crm/contacts/${own.id}`, { email: `ivy@${s.domain}` }), ctx(own.id));
    expect((await json<CrmContactRow>(res2)).company_id).toBe(s.ownerCo.id);
    // Key del member.
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read', 'crm:write']);
    const v1 = await v1ContactsRoute.POST(send('POST', '/api/v1/crm/contacts', { email: `jo@${s.domain}` }, { authorization: `Bearer ${key.key}` }));
    expect(v1.status).toBe(201);
    const body = await json<Record<string, unknown>>(v1);
    expect(body.company_id ?? null).toBeNull();
    expect(body.company_private).toBeUndefined();
  });

  it('sin persona (formularios, integraciones) se vincula como siempre', async () => {
    const s = await setup('s6link-sys');
    const c = await createContact(s.ws, { email: `kim@${s.domain}` });
    expect(c.company_id).toBe(s.ownerCo.id);
  });
});

// ---------- 2. Desglose del score ----------

describe('desglose del score sin las reglas sobre campos ocultos', () => {
  async function seed(label: string) {
    const s = await setup(label);
    await createScoreRule(s.ws, { kind: 'property', name: 'Budget flag', config: { field: 'custom.secret', op: 'is_set', value: '' }, points: 7 });
    await createScoreRule(s.ws, { kind: 'property', name: 'Title rule', config: { field: 'jobTitle', op: 'equals', value: 'CEO' }, points: 5 });
    const c = await createContact(s.ws, { firstName: 'Lu', email: 'lu@gmail.com', jobTitle: 'CEO', ownerId: s.w.member.id, custom: { secret: 'x-val' } });
    await recalcContactScore(s.ws, c.id);
    const fc = await createContact(s.ws, { firstName: 'Mo', email: 'mo@gmail.com', jobTitle: 'CEO', ownerId: s.w.friend.id, custom: { secret: 'x-val' } });
    await recalcContactScore(s.ws, fc.id);
    return { ...s, c, fc };
  }
  type Rule = { name: string; points: number; detail: string };
  const rowsFor = async (user: SessionUser) => {
    session.user = user;
    return (await json<{ rows: Array<CrmContactRow> }>(await contactsRoute.GET(send('GET', '/api/crm/contacts')))).rows;
  };
  const breakdown = (row: { score_breakdown: string } | undefined) => JSON.parse(row?.score_breakdown ?? '[]') as Rule[];

  it('owner y admin ven todas las reglas', async () => {
    const s = await seed('s6score-adm');
    for (const u of [owner(s), admin(s)]) {
      const row = (await rowsFor(u)).find((r) => r.id === s.c.id);
      expect(breakdown(row).map((b) => b.name).sort()).toEqual(['Budget flag', 'Title rule']);
    }
  });

  it('member y friend no ven la regla sobre el campo oculto (ni nombre ni puntos) en la lista, la API v1 ni la ficha', async () => {
    const s = await seed('s6score-mem');
    for (const [u, id] of [
      [member(s), s.c.id],
      [teamMember(s), s.fc.id],
    ] as const) {
      const row = (await rowsFor(u)).find((r) => r.id === id);
      const items = breakdown(row);
      expect(items.map((b) => b.name)).toEqual(['Title rule']);
      expect(JSON.stringify(row)).not.toContain('Budget flag');
      expect(items[0].detail).toBe('');
    }
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read']);
    const v1 = await json<{ contacts: Array<{ id: string; score_breakdown: string }> }>(
      await v1ContactsRoute.GET(send('GET', '/api/v1/crm/contacts', undefined, { authorization: `Bearer ${key.key}` })),
    );
    expect(JSON.stringify(v1.contacts.find((r) => r.id === s.c.id))).not.toContain('Budget flag');
    const stored = (await getDb().prepare('SELECT * FROM crm_contacts WHERE id = ?').get(s.c.id)) as CrmContactRow;
    const scores = await contactScores(s.ws, stored, undefined, viewerOf(s, s.w.member.id));
    expect(scores[0].breakdown.map((b) => b.name)).toEqual(['Title rule']);
    const ownerScores = await contactScores(s.ws, stored, undefined, viewerOf(s, s.ws, 'owner'));
    expect(ownerScores[0].breakdown).toHaveLength(2);
  });

  it('un webhook de un miembro y el Inbox tampoco traen la regla', async () => {
    const s = await seed('s6score-evt');
    const sub = (await subscriberFor(s.ws, s.w.member.id))!;
    const row = (await getDb().prepare('SELECT * FROM crm_contacts WHERE id = ?').get(s.c.id)) as CrmContactRow;
    const evt = await recordEventFor(sub, 'contact', { ...row } as unknown as Record<string, unknown>);
    expect(JSON.stringify(evt)).not.toContain('Budget flag');
    const ownerEvt = await recordEventFor((await subscriberFor(s.ws, s.ws))!, 'contact', { ...row } as unknown as Record<string, unknown>);
    expect(JSON.stringify(ownerEvt)).toContain('Budget flag');
    const conv = { widget_user_id: s.ws, crm_contact: row };
    const forMember = await withViewerCrmContact(conv, member(s));
    expect(forMember.crm_contact?.id).toBe(s.c.id);
    expect(JSON.stringify(forMember)).not.toContain('Budget flag');
    expect(JSON.stringify(forMember)).not.toContain('x-val');
    // El friend no ve ese contacto: la conversación sale sin contacto. Otro workspace, tampoco.
    expect((await withViewerCrmContact(conv, teamMember(s))).crm_contact).toBeNull();
    expect((await withViewerCrmContact(conv, stranger(s))).crm_contact).toBeNull();
    expect(JSON.stringify(await withViewerCrmContact(conv, owner(s)))).toContain('Budget flag');
  });

  it('sin saber las reglas (un set sin ellas) quedan solo las de actividad', () => {
    const sb = JSON.stringify([
      { ruleId: 'p', name: 'Budget flag', points: 7, detail: 'x-val' },
      { ruleId: 'a', name: 'Calls', points: 3, detail: '3 / 30d' },
    ]);
    expect(JSON.parse(redactScoreBreakdown(sb)).map((b: Rule) => b.name)).toEqual(['Calls']);
    const hidden: HiddenFieldSet = new Set(['secret']);
    hidden.scoreRules = new Map([['a', 'activity']]);
    expect(redactRow({ custom: '{}', score_breakdown: sb }, hidden).score_breakdown).not.toContain('Budget');
  });
});

// ---------- 3. Preguntas de playbooks ----------

describe('playbooks: preguntas que van a un campo oculto', () => {
  async function seed(label: string) {
    const s = await setup(label);
    const pb = await createPlaybook(
      s.ws,
      {
        name: 'Discovery',
        body: '',
        questions: [
          { id: 'q1', label: 'Budget code?', type: 'text', options: [], property: 'contact:custom.secret' },
          { id: 'q2', label: 'Role?', type: 'text', options: [], property: 'contact:jobTitle' },
          { id: 'q3', label: 'Deal code?', type: 'text', options: [], property: 'deal:custom.secret' },
        ],
        entities: ['contact', 'deal'],
      },
      s.ws,
    );
    return { ...s, pb };
  }

  it('owner y admin ven todas las preguntas', async () => {
    const s = await seed('s6pb-adm');
    for (const u of [owner(s), admin(s)]) {
      session.user = u;
      const one = await json<{ questions: Array<{ id: string }> }>(await playbookRoute.GET(send('GET', `/api/crm/playbooks/${s.pb.id}`), ctx(s.pb.id)));
      expect(one.questions.map((q) => q.id)).toEqual(['q1', 'q2', 'q3']);
    }
  });

  it('member y friend no ven las preguntas a campos ocultos, ni en la lista ni en la ficha', async () => {
    const s = await seed('s6pb-mem');
    for (const u of [member(s), teamMember(s)]) {
      session.user = u;
      const list = await json<{ rows: Array<{ id: string; questions: Array<{ id: string; label: string; property: string }> }> }>(
        await playbooksRoute.GET(send('GET', '/api/crm/playbooks')),
      );
      const row = list.rows.find((p) => p.id === s.pb.id)!;
      expect(row.questions.map((q) => q.id)).toEqual(['q2']);
      expect(JSON.stringify(list)).not.toContain('custom.secret');
      expect(JSON.stringify(list)).not.toContain('Budget code');
      const one = await json<{ questions: Array<{ id: string }> }>(await playbookRoute.GET(send('GET', `/api/crm/playbooks/${s.pb.id}`), ctx(s.pb.id)));
      expect(one.questions.map((q) => q.id)).toEqual(['q2']);
    }
  });

  it('otro workspace no ve el playbook', async () => {
    const s = await seed('s6pb-ext');
    session.user = stranger(s);
    expect((await playbookRoute.GET(send('GET', `/api/crm/playbooks/${s.pb.id}`), ctx(s.pb.id))).status).toBe(404);
    expect(await playbooksForViewer(viewerOf(s, s.ws, 'owner'), [s.pb])).toEqual([s.pb]);
  });
});

// ---------- 4. Secuencias con remitente que salió ----------

describe('secuencias: remitente que ya no es del workspace', () => {
  async function seed(label: string) {
    const s = await setup(label);
    const seq = await createSequence(s.ws, s.ws, {
      name: 'Follow-up',
      timezone: 'UTC',
      windowStart: '00:00',
      windowEnd: '23:59',
      businessDays: false,
      steps: [{ type: 'task', subject: 'Call back' }],
    });
    const a = await createContact(s.ws, { firstName: 'Na', email: `na-${label}@client.test`, ownerId: s.w.member.id });
    const b = await createContact(s.ws, { firstName: 'Ola', email: `ola-${label}@client.test`, ownerId: s.w.member.id });
    const c = await createContact(s.ws, { firstName: 'Pia', email: `pia-${label}@client.test`, ownerId: s.ws });
    expect(await enrollContacts(s.ws, { sequenceId: seq.id, contactIds: [a.id, b.id], senderId: s.w.member.id, enrolledBy: s.ws })).toMatchObject({ ok: true });
    expect(await enrollContacts(s.ws, { sequenceId: seq.id, contactIds: [c.id], senderId: s.adminPerson.id, enrolledBy: s.ws })).toMatchObject({ ok: true });
    return { ...s, seq, a, b, c };
  }
  const enrollmentOf = async (s: Setup, contactId: string) =>
    (await getDb().prepare('SELECT * FROM crm_sequence_enrollments WHERE user_id = ? AND contact_id = ?').get(s.ws, contactId)) as Parameters<typeof processEnrollment>[0];
  const tasksFor = async (s: Setup, contactId: string) =>
    Number(((await getDb().prepare("SELECT COUNT(*) AS n FROM crm_activities WHERE user_id = ? AND contact_id = ? AND type = 'task'").get(s.ws, contactId)) as { n: number }).n);
  const notices = async (s: Setup, seqId: string) =>
    (await getDb().prepare("SELECT user_id FROM notifications WHERE type = 'crm_sequence' AND source_id = ?").all(seqId)) as Array<{ user_id: string }>;

  it('con el remitente en el workspace, sigue como siempre', async () => {
    const s = await seed('s6seq-ok');
    expect(await processEnrollment(await enrollmentOf(s, s.c.id))).toBe('finished');
    expect(await tasksFor(s, s.c.id)).toBe(1);
  });

  it('si el remitente salió, se pausa sin hacer nada, avisa una vez al owner y no se reanuda', async () => {
    const s = await seed('s6seq-left');
    await removeMember(s.w.team.id, s.w.member.id);
    const first = await enrollmentOf(s, s.a.id);
    expect(await processEnrollment(first)).toBe('paused');
    expect(await processEnrollment(await enrollmentOf(s, s.b.id))).toBe('paused');
    expect(await tasksFor(s, s.a.id)).toBe(0);
    const enr = await getEnrollment(s.ws, first.id);
    expect(enr).toMatchObject({ status: 'paused', exit_reason: SENDER_LEFT });
    // Un solo aviso, para el owner (no para el member ni otro workspace).
    expect((await notices(s, s.seq.id)).map((n) => n.user_id)).toEqual([s.ws]);
    // Reanudar no la vuelve a activar mientras el remitente no sea del workspace.
    expect((await setEnrollmentState(s.ws, first.id, 'resume'))?.status).toBe('paused');
    // La del admin (sigue en el workspace) no se toca.
    expect(await processEnrollment(await enrollmentOf(s, s.c.id))).toBe('finished');
  });

  it('el asistente lista solo salidas de contactos que quien pregunta ve', async () => {
    const s = await seed('s6seq-asst');
    await removeMember(s.w.team.id, s.w.member.id);
    await processEnrollment(await enrollmentOf(s, s.a.id));
    // Otra salida en un contacto del owner (el member no lo ve).
    await getDb().prepare("UPDATE crm_sequence_enrollments SET status = 'exited', exit_reason = 'replied' WHERE user_id = ? AND contact_id = ?").run(s.ws, s.c.id);
    const tool = ALL_TOOLS.find((t) => t.name === 'email_status')!;
    const run = async (u: SessionUser) => ((await (tool as { run: (c: unknown, i: unknown) => Promise<unknown> }).run(toolCtx(u, 'en'), {})) as { sequenceExits: Array<{ exit_reason: string }> }).sequenceExits;
    expect((await run(owner(s))).map((e) => e.exit_reason).sort()).toEqual(['replied', SENDER_LEFT]);
    expect((await run(admin(s))).map((e) => e.exit_reason).sort()).toEqual(['replied', SENDER_LEFT]);
    // El friend (equipo de ventas) no ve ninguno de los dos contactos.
    expect(await run(teamMember(s))).toEqual([]);
    expect(await run(stranger(s))).toEqual([]);
  });
});

// ---------- 5. Papelera: empresa en la que se fusionó ----------

describe('papelera: la empresa en la que se fusionó, como registro privado', () => {
  async function seed(label: string) {
    const s = await setup(label);
    const drop = await createCompany(s.ws, { name: 'Member Dup', ownerId: s.w.member.id });
    expect(await mergeCompanies(s.ws, s.ownerCo.id, drop.id)).toMatchObject({ ok: true });
    return { ...s, drop };
  }
  type Row = { record_id: string; merged_into: string | null; merged_into_name: string | null; merged_into_private?: boolean };
  const rowsFor = async (user: SessionUser) => {
    session.user = user;
    return (await json<{ rows: Row[] }>(await trashRoute.GET(send('GET', '/api/crm/trash')))).rows;
  };

  it('owner y admin ven el nombre', async () => {
    const s = await seed('s6trash-adm');
    for (const u of [owner(s), admin(s)]) {
      const row = (await rowsFor(u)).find((r) => r.record_id === s.drop.id)!;
      expect(row).toMatchObject({ merged_into: s.ownerCo.id, merged_into_name: 'Owner Holdings' });
    }
  });

  it('el member ve su entrada con la empresa como privada (sin id ni nombre)', async () => {
    const s = await seed('s6trash-mem');
    const rows = await rowsFor(member(s));
    const row = rows.find((r) => r.record_id === s.drop.id)!;
    expect(row).toMatchObject({ merged_into: null, merged_into_name: null, merged_into_private: true });
    expect(JSON.stringify(rows)).not.toContain('Owner Holdings');
    expect(JSON.stringify(rows)).not.toContain(s.ownerCo.id);
    expect(await listTrash(s.ws, { ownerScope: [s.w.member.id] })).toEqual(expect.arrayContaining([expect.objectContaining({ merged_into_private: true })]));
  });

  it('friend y otro workspace no ven la entrada', async () => {
    const s = await seed('s6trash-ext');
    expect((await rowsFor(teamMember(s))).some((r) => r.record_id === s.drop.id)).toBe(false);
    expect((await rowsFor(stranger(s))).some((r) => r.record_id === s.drop.id)).toBe(false);
  });
});

// ---------- 6. MCP y "Exigir verificación en dos pasos" ----------

describe('MCP: la API v1 respeta "Exigir verificación en dos pasos"', () => {
  const ENABLED = '2026-06-01T12:00:00.000Z';
  async function seed(label: string) {
    const s = await setup(label);
    await getDb().prepare('UPDATE teams SET require_mfa = 1 WHERE owner_id = ?').run(s.ws);
    await getDb().prepare('UPDATE users SET mfa_enabled_at = ? WHERE id IN (?, ?, ?)').run(ENABLED, s.ws, s.w.member.id, s.adminPerson.id);
    return s;
  }
  const personRow = async (s: Setup, id: string) => ({ ...((await getDb().prepare('SELECT * FROM users WHERE id = ?').get(id)) as UserRow), active_team_id: s.w.team.id });
  const v1As = async (s: Setup, id: string, issuedAt?: string) =>
    runAsDelegated({ real: await personRow(s, id), pinnedTeamId: s.w.team.id, apiPath: '/api/v1/crm/contacts', ...(issuedAt ? { credentialIssuedAt: issuedAt } : {}) }, () =>
      requireApiUser(send('GET', '/api/v1/crm/contacts'), 'crm:read'),
    );
  const caller = (personId: string, teamId: string | null, issuedAt?: string): McpCaller => ({
    kind: 'oauth',
    personId,
    teamId,
    canWrite: true,
    clientId: 'c',
    clientName: 'Test',
    grantId: `g-${personId}`,
    apiKeyId: null,
    rateKey: `mcp:${personId}`,
    ...(issuedAt ? { issuedAt } : {}),
  });

  it('con los dos pasos y una conexión autorizada después, member y admin entran', async () => {
    const s = await seed('s6mfa-ok');
    for (const id of [s.w.member.id, s.adminPerson.id]) {
      const auth = await v1As(s, id, '2026-07-01 09:00:00');
      expect('res' in auth).toBe(false);
      expect(await resolvePerson(caller(id, s.w.team.id, '2026-07-01 09:00:00'))).not.toBeNull();
    }
  });

  it('una conexión OAuth de antes de activarlos no entra (v1 ni MCP), tampoco para el owner', async () => {
    const s = await seed('s6mfa-old');
    for (const id of [s.w.member.id, s.adminPerson.id]) {
      const auth = await v1As(s, id, '2026-05-01 09:00:00');
      expect('res' in auth && auth.res.status).toBe(403);
      if ('res' in auth) expect((await auth.res.json()).error.code).toBe('mfa_required');
      expect(await resolvePerson(caller(id, s.w.team.id, '2026-05-01 09:00:00'))).toBeNull();
    }
    const own = await runAsDelegated({ real: await personRow(s, s.ws), pinnedTeamId: null, apiPath: '/api/v1/crm/contacts', credentialIssuedAt: '2026-05-01 09:00:00' }, () =>
      requireApiUser(send('GET', '/api/v1/crm/contacts'), 'crm:read'),
    );
    expect('res' in own).toBe(true);
  });

  it('sin los dos pasos no entra nadie del equipo; el friend sin activarlos tampoco', async () => {
    const s = await seed('s6mfa-none');
    const auth = await v1As(s, s.w.friend.id, '2026-07-01 09:00:00');
    expect('res' in auth && auth.res.status).toBe(403);
    expect(await resolvePerson(caller(s.w.friend.id, s.w.team.id))).toBeNull();
  });

  it('sin el requisito, una conexión vieja sigue valiendo; otro workspace no cambia', async () => {
    const s = await setup('s6mfa-off');
    const auth = await v1As(s, s.w.member.id, '2020-01-01 00:00:00');
    expect('res' in auth).toBe(false);
    expect(delegatedMfaOk({ mfa_enabled_at: null }, { require_mfa: 0 }, '2020-01-01 00:00:00')).toBe(true);
    expect(delegatedMfaOk({ mfa_enabled_at: ENABLED }, { require_mfa: 1 }, undefined)).toBe(true);
    expect(delegatedMfaOk({ mfa_enabled_at: ENABLED }, { require_mfa: 1 }, 'garbage')).toBe(false);
    const ext = await runAsDelegated({ real: { ...s.w.stranger, active_team_id: null }, pinnedTeamId: null, apiPath: '/api/v1/crm/contacts', credentialIssuedAt: '2020-01-01 00:00:00' }, () =>
      requireApiUser(send('GET', '/api/v1/crm/contacts'), 'crm:read'),
    );
    expect('res' in ext).toBe(false);
  });
});

// ---------- 7. Productos y tags ----------

describe('catálogo de productos y tags compartidos: owner y admins', () => {
  it('productos: owner y admin crean, editan y borran; member y friend solo leen', async () => {
    const s = await setup('s6prod');
    const p = await createProduct(s.ws, { name: 'Seat license', price: 100 });
    for (const u of [owner(s), admin(s)]) {
      session.user = u;
      expect((await productsRoute.POST(send('POST', '/api/crm/products', { name: `Add-on ${u.role}`, price: 10 }))).status).toBe(201);
      expect((await productRoute.PATCH(send('PATCH', `/api/crm/products/${p.id}`, { price: 120 }), ctx(p.id))).status).toBe(200);
    }
    for (const u of [member(s), teamMember(s)]) {
      session.user = u;
      expect((await productsRoute.GET(send('GET', '/api/crm/products'))).status).toBe(200);
      expect((await productsRoute.POST(send('POST', '/api/crm/products', { name: 'Nope', price: 1 }))).status).toBe(403);
      expect((await productRoute.PATCH(send('PATCH', `/api/crm/products/${p.id}`, { price: 1 }), ctx(p.id))).status).toBe(403);
      expect((await productRoute.DELETE(send('DELETE', `/api/crm/products/${p.id}`), ctx(p.id))).status).toBe(403);
    }
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read', 'crm:write']);
    const auth = { authorization: `Bearer ${key.key}` };
    expect((await v1ProductsRoute.POST(send('POST', '/api/v1/crm/products', { name: 'Nope', price: 1 }, auth))).status).toBe(403);
    expect((await v1ProductRoute.DELETE(send('DELETE', `/api/v1/crm/products/${p.id}`, undefined, auth), ctx(p.id))).status).toBe(403);
    const adminKey = await createApiKey(s.ws, 'k', s.adminPerson.id, ['crm:read', 'crm:write']);
    expect((await v1ProductRoute.DELETE(send('DELETE', `/api/v1/crm/products/${p.id}`, undefined, { authorization: `Bearer ${adminKey.key}` }), ctx(p.id))).status).toBe(204);
    // Otro workspace no toca el catálogo ajeno.
    session.user = stranger(s);
    const other = await createProduct(s.ws, { name: 'Other', price: 5 });
    expect((await productRoute.DELETE(send('DELETE', `/api/crm/products/${other.id}`), ctx(other.id))).status).toBe(404);
  });

  it('tags: cualquiera crea y etiqueta lo que ve; renombrar y borrar, solo owner y admins', async () => {
    const s = await setup('s6tags');
    const res = await createTag(s.ws, { name: 'Priority' });
    if (!res.ok) throw new Error('tag');
    const tag = res.tag;
    const mine = await createContact(s.ws, { firstName: 'Quin', email: 'quin@gmail.com', ownerId: s.w.member.id });
    for (const u of [member(s), teamMember(s)]) {
      session.user = u;
      expect((await tagsRoute.POST(send('POST', '/api/crm/tags', { name: `New ${u.actingUser?.id}` }))).status).toBe(201);
      expect((await tagRoute.PATCH(send('PATCH', `/api/crm/tags/${tag.id}`, { name: 'Renamed' }), ctx(tag.id))).status).toBe(403);
      expect((await tagRoute.DELETE(send('DELETE', `/api/crm/tags/${tag.id}`), ctx(tag.id))).status).toBe(403);
    }
    session.user = member(s);
    expect((await recordTagsRoute.PUT(send('PUT', '/api/crm/tags/record', { entity: 'contact', recordId: mine.id, tagIds: [tag.id] }))).status).toBe(200);
    session.user = teamMember(s);
    expect((await recordTagsRoute.PUT(send('PUT', '/api/crm/tags/record', { entity: 'contact', recordId: mine.id, tagIds: [tag.id] }))).status).toBe(404);
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read', 'crm:write']);
    expect((await v1TagRoute.DELETE(send('DELETE', `/api/v1/crm/tags/${tag.id}`, undefined, { authorization: `Bearer ${key.key}` }), ctx(tag.id))).status).toBe(403);
    session.user = admin(s);
    expect((await tagRoute.PATCH(send('PATCH', `/api/crm/tags/${tag.id}`, { name: 'Renamed' }), ctx(tag.id))).status).toBe(200);
    session.user = stranger(s);
    expect((await tagRoute.DELETE(send('DELETE', `/api/crm/tags/${tag.id}`), ctx(tag.id))).status).toBe(404);
    session.user = owner(s);
    expect((await tagRoute.DELETE(send('DELETE', `/api/crm/tags/${tag.id}`), ctx(tag.id))).status).toBe(204);
  });
});

// ---------- Ajustes de la revisión ----------

describe('revisión: import, eventos, Inbox, total del score, papelera, Lines', () => {
  it('el import de un miembro no actualiza ni vincula lo que no ve, ni crea un duplicado', async () => {
    const s = await setup('s6imp');
    const hidden = await createContact(s.ws, { firstName: 'Owner', email: `vip@${s.domain}`, jobTitle: 'Keep', ownerId: s.ws });
    const before = Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_companies WHERE user_id = ?').get(s.ws)) as { n: number }).n);
    const scope = [s.w.member.id];
    const res = await importContacts(
      s.ws,
      [
        { email: `vip@${s.domain}`, jobTitle: 'Changed' },
        { email: 'new1@gmail.com', companyDomain: s.domain },
        { email: 'new2@gmail.com', companyName: 'Owner Holdings' },
      ],
      'update',
      { linkScope: scope },
    );
    expect(res.updated).toBe(0);
    const stored = (await getDb().prepare('SELECT job_title FROM crm_contacts WHERE id = ?').get(hidden.id)) as { job_title: string };
    expect(stored.job_title).toBe('Keep');
    const created = (await getDb().prepare("SELECT company_id FROM crm_contacts WHERE user_id = ? AND email IN ('new1@gmail.com', 'new2@gmail.com')").all(s.ws)) as Array<{ company_id: string | null }>;
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.company_id === null)).toBe(true);
    expect(Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_companies WHERE user_id = ?').get(s.ws)) as { n: number }).n)).toBe(before);
    // El owner sí actualiza y vincula.
    const own = await importContacts(s.ws, [{ email: `vip@${s.domain}`, jobTitle: 'Changed', companyDomain: s.domain }], 'update', { linkScope: null });
    expect(own.updated).toBe(1);
  });

  it('company.deleted de un merge no lleva el id de la empresa que el miembro no ve', async () => {
    const s = await setup('s6evt-merge');
    const sub = (await subscriberFor(s.ws, s.w.member.id))!;
    const data = { id: 'gone', label: 'Member Dup', deletedBy: null, mergedInto: s.ownerCo.id };
    const out = await recordEventFor(sub, 'company', data, { ownerId: s.w.member.id });
    expect(out).toMatchObject({ mergedInto: null, merged_into_private: true });
    expect(JSON.stringify(out)).not.toContain(s.ownerCo.id);
    const ownerOut = await recordEventFor((await subscriberFor(s.ws, s.ws))!, 'company', data, { ownerId: s.w.member.id });
    expect(ownerOut).toMatchObject({ mergedInto: s.ownerCo.id });
  });

  it('el total del score no delata la regla oculta, y score_changed no le llega', async () => {
    const s = await setup('s6score-total');
    await createScoreRule(s.ws, { kind: 'property', name: 'Budget flag', config: { field: 'custom.secret', op: 'is_set', value: '' }, points: 7 });
    await createScoreRule(s.ws, { kind: 'property', name: 'Title rule', config: { field: 'jobTitle', op: 'equals', value: 'CEO' }, points: 5 });
    const c = await createContact(s.ws, { firstName: 'Lu', email: 'lu2@gmail.com', jobTitle: 'CEO', ownerId: s.w.member.id, custom: { secret: 'x-val' } });
    await recalcContactScore(s.ws, c.id);
    session.user = member(s);
    const row = (await json<{ rows: Array<CrmContactRow> }>(await contactsRoute.GET(send('GET', '/api/crm/contacts')))).rows.find((r) => r.id === c.id)!;
    expect(row.score).toBe(5);
    session.user = owner(s);
    const ownRow = (await json<{ rows: Array<CrmContactRow> }>(await contactsRoute.GET(send('GET', '/api/crm/contacts')))).rows.find((r) => r.id === c.id)!;
    expect(ownRow.score).toBe(12);
    const stored = (await getDb().prepare('SELECT * FROM crm_contacts WHERE id = ?').get(c.id)) as CrmContactRow;
    expect((await contactScores(s.ws, stored, undefined, viewerOf(s, s.w.member.id)))[0].score).toBe(5);
    const evt = { id: c.id, scoreId: 'x', primary: true, oldScore: 5, newScore: 12, breakdown: [] };
    const { scoreChangedFor } = await import('@/lib/crm-event-privacy');
    expect(await scoreChangedFor((await subscriberFor(s.ws, s.w.member.id))!, evt)).toBeNull();
    expect(await scoreChangedFor((await subscriberFor(s.ws, s.ws))!, evt)).toEqual(evt);
  });

  it('guardar un chat en el CRM no toca ni nombra un contacto que el miembro no ve', async () => {
    const s = await setup('s6chatlog');
    const hidden = await createContact(s.ws, { firstName: 'Vip', email: 'vip-chat@gmail.com', ownerId: s.ws });
    const visitor = { email: 'vip-chat@gmail.com', email_verified: 1, name: 'Vip' } as never;
    const res = await logChatToCrm(s.ws, { conversationId: 'conv-s6', subject: null, visitor, messages: [{ sender_type: 'visitor', body: 'hola', created_at: '2026-01-01T00:00:00' }] as never, actorId: s.w.member.id, scope: [s.w.member.id] });
    expect(res).toEqual({ error: 'contact_email_taken' });
    const notes = Number(((await getDb().prepare('SELECT COUNT(*) AS n FROM crm_activities WHERE contact_id = ?').get(hidden.id)) as { n: number }).n);
    expect(notes).toBe(0);
    // Uno nuevo, del dominio de una empresa que no ve: sin empresa.
    const fresh = await logChatToCrm(s.ws, { conversationId: 'conv-s6b', subject: null, visitor: { email: `new@${s.domain}`, email_verified: 1, name: 'N' } as never, messages: [], actorId: s.w.member.id, scope: [s.w.member.id] });
    expect('contact' in fresh && fresh.contact.company_id).toBeNull();
  });

  it('papelera: owner y admin siguen viendo el id aunque la empresa ya no exista', async () => {
    const s = await setup('s6trash-gone');
    const drop = await createCompany(s.ws, { name: 'Dup', ownerId: s.w.member.id });
    expect(await mergeCompanies(s.ws, s.ownerCo.id, drop.id)).toMatchObject({ ok: true });
    await getDb().prepare('DELETE FROM crm_companies WHERE id = ?').run(s.ownerCo.id);
    const row = (await listTrash(s.ws, {})).find((r) => r.record_id === drop.id)!;
    expect(row.merged_into).toBe(s.ownerCo.id);
  });

  it('tags por la API v1: un miembro no renombra', async () => {
    const s = await setup('s6tag-v1');
    const res = await createTag(s.ws, { name: 'Shared' });
    if (!res.ok) throw new Error('tag');
    const key = await createApiKey(s.ws, 'k', s.w.member.id, ['crm:read', 'crm:write']);
    expect((await v1TagRoute.PATCH(send('PATCH', `/api/v1/crm/tags/${res.tag.id}`, { name: 'X' }, { authorization: `Bearer ${key.key}` }), ctx(res.tag.id))).status).toBe(403);
  });

  it('Lines: los detalles del chat no nombran una empresa que el miembro no ve, ni la deja vincular', async () => {
    vi.stubEnv('GROUPS_FAKE', '1');
    const s = await setup('s6lines');
    const n = await createNumber(s.ws, s.ws, { provider: 'fake' });
    const chat = await upsertChat({ id: n.id, user_id: s.ws }, { providerChatId: `1203630${Date.now()}@g.us`, kind: 'group', name: 'Clientes' }, { silent: true });
    await getDb().prepare('UPDATE groups_chats SET crm_company_id = ? WHERE id = ?').run(s.ownerCo.id, chat.id);
    const ownerPage = await loadChatPage(owner(s), chat.id);
    expect(ownerPage?.crm?.company?.name).toBe('Owner Holdings');
    const memberPage = await loadChatPage(member(s), chat.id);
    expect(memberPage).not.toBeNull();
    expect(memberPage!.crm?.company ?? null).toBeNull();
    expect(memberPage!.chat.crmCompanyId).toBeNull();
    expect(JSON.stringify(memberPage)).not.toContain('Owner Holdings');
    const linesChatRoute = await import('@/lib/routes/groups/chats/[id]/route');
    session.user = member(s);
    const link = await linesChatRoute.PATCH(send('PATCH', `/api/groups/chats/${chat.id}`, { crmCompanyId: s.ownerCo.id }), ctx(chat.id));
    expect(link.status).toBe(400);
    session.user = owner(s);
    expect((await linesChatRoute.PATCH(send('PATCH', `/api/groups/chats/${chat.id}`, { crmCompanyId: s.ownerCo.id }), ctx(chat.id))).status).toBe(200);
  });
});

describe('responder en un thread: solo uno con un contacto que quien envía ve', () => {
  async function thread(s: Setup, contactId: string, threadId: string) {
    const id = crypto.randomUUID();
    await getDb()
      .prepare("INSERT INTO crm_emails (id, user_id, contact_id, gmail_id, thread_id, message_id, direction, subject, sent_at) VALUES (?, ?, ?, ?, ?, ?, 'in', 'Hello', datetime('now'))")
      .run(id, s.ws, contactId, `g-${id}`, threadId, `<m-${id}@mail.test>`);
    await getDb().prepare('INSERT INTO crm_email_contacts (email_id, contact_id, user_id) VALUES (?, ?, ?)').run(id, contactId, s.ws);
  }

  it('un miembro no responde en un thread de un contacto que no ve (ni desde un registro suyo); el owner sí', async () => {
    const s = await setup('s6reply');
    const { sendCrmEmailAndSave } = await import('@/lib/crm-workflows');
    const hidden = await createContact(s.ws, { firstName: 'Vip', email: 'vip-thread@gmail.com', ownerId: s.ws });
    const mine = await createContact(s.ws, { firstName: 'Own', email: 'own-thread@gmail.com', ownerId: s.w.member.id });
    await thread(s, hidden.id, 'thr-hidden-s6');
    await thread(s, mine.id, 'thr-mine-s6');
    const base = { recordType: 'contact' as const, recordId: mine.id, to: 'own-thread@gmail.com', subject: 'Re', body: 'Hi', fromEmail: 'm@x.test' };
    expect(await sendCrmEmailAndSave(s.ws, { ...base, senderId: s.w.member.id, threadId: 'thr-hidden-s6', inReplyTo: '<forged@x>' })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await sendCrmEmailAndSave(s.ws, { ...base, senderId: s.w.friend.id, threadId: 'thr-mine-s6' })).toMatchObject({ ok: false, error: 'not_found' });
    const own = await sendCrmEmailAndSave(s.ws, { ...base, senderId: s.w.member.id, threadId: 'thr-mine-s6' });
    expect(own.error).not.toBe('not_found');
    const byOwner = await sendCrmEmailAndSave(s.ws, { ...base, recordId: hidden.id, to: 'vip-thread@gmail.com', senderId: s.ws, threadId: 'thr-hidden-s6' });
    expect(byOwner.error).not.toBe('not_found');
  });
});
