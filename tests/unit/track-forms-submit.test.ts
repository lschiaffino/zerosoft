import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { addMember, createTeam } from '@/lib/teams';
import { createProject, getIssue, listIssueActivities, updateProject } from '@/lib/track-data';
import { setGuest, setProjectVisibility } from '@/lib/track-access';
import { listIssueSubscriberIds } from '@/lib/track-subscriptions';
import { createTemplate, getTemplate, listWorkspaceFormTemplates } from '@/lib/track-templates';
import { formFieldsSchema } from '@/lib/track-forms';
import { makeUser } from './helpers';

const session = vi.hoisted(() => ({ user: null as null | Record<string, unknown> }));
vi.mock('@/lib/session', () => ({
  getCurrentUser: async () => session.user,
  realUserId: (u: { id: string; actingUser?: { id: string } }) => u.actingUser?.id ?? u.id,
  isWorkspaceAdmin: (u: { role?: string }) => u.role === 'owner' || u.role === 'admin',
}));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: () => {},
}));
vi.mock('@/lib/events', () => ({ emitEvent: async () => {}, emitEventSoon: async () => {} }));

const submit = await import('@/lib/routes/track/templates/[id]/submit/route');
const templatesRoute = await import('@/lib/routes/track/projects/[id]/templates/route');
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new NextRequest('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never;
const uid = () => crypto.randomUUID().slice(0, 6);

const FIELDS = formFieldsSchema.parse([
  { id: 'where', label: 'Where', type: 'select', required: true, options: ['Web', 'Mobile'] },
  { id: 'what', label: 'What happened', type: 'textarea', required: true },
  { id: 'repro', label: 'I can reproduce it', type: 'checkbox' },
]);

async function setup() {
  const owner = await makeUser('frm-own');
  const member = await makeUser('frm-mem');
  const guest = await makeUser('frm-gst');
  const stranger = await makeUser('frm-str');
  const team = await createTeam(owner.id, 'Acme');
  await addMember(team.id, member.id);
  await addMember(team.id, guest.id);
  const open = await createProject(owner.id, team.id, { name: 'Open', slug: `fo-${uid()}` });
  const secret = await createProject(owner.id, team.id, { name: 'Secret', slug: `fs-${uid()}` });
  await setProjectVisibility(secret.id, 'private', owner.id);
  await setGuest(team.id, guest.email, [open.id], owner.id);
  await updateProject(open.id, { triageEnabled: true });
  const form = await createTemplate(open, { name: 'Bug report', title: '[Bug] ', priority: 'high', fields: FIELDS, isDefault: true });
  const plain = await createTemplate(open, { name: 'Plain' });
  const secretForm = await createTemplate(secret, { name: 'Secret form', fields: [FIELDS[1]] });
  const as = {
    owner: { ...owner, team, role: 'owner' },
    member: { ...member, id: owner.id, actingUser: member, team, role: 'member' },
    guest: { ...guest, id: owner.id, actingUser: guest, team, role: 'member' },
    stranger: { ...stranger, team: null, role: 'owner' },
  };
  return { owner, member, guest, team, open, secret, form, plain, secretForm, as };
}

describe('Track: formularios de pedidos', () => {
  it('la plantilla con campos guarda los campos y nunca queda como predeterminada', async () => {
    const s = await setup();
    expect(JSON.parse(s.form.fields)).toHaveLength(3);
    expect(s.form.is_default).toBe(0);
    session.user = s.as.owner;
    const res = await templatesRoute.POST(post({ name: 'Bad', fields: [{ id: 'a', label: 'A', type: 'select', options: [] }] }), params(s.open.id));
    expect(res.status).toBe(400);
    const forms = await listWorkspaceFormTemplates(s.team.id, s.owner.id);
    expect(forms.map((f) => f.name).sort()).toEqual(['Bug report', 'Secret form']);
    session.user = null;
  });

  it('responder crea el issue en triage con las respuestas y suscribe a quien lo mandó', async () => {
    const s = await setup();
    session.user = s.as.member;
    const res = await submit.POST(post({ title: '[Bug] Login fails', answers: { where: 'Web', what: 'Blank page', repro: true }, details: 'Since Monday' }), params(s.form.id));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; identifier: string; triage: boolean };
    expect(body.triage).toBe(true);
    const issue = (await getIssue(body.id))!;
    expect(issue.title).toBe('[Bug] Login fails');
    expect(issue.priority).toBe('high');
    expect(issue.source).toBe('form');
    expect(issue.creator_id).toBe(s.member.id);
    expect(issue.description).toBe('**Where**\nWeb\n\n**What happened**\n\nBlank page\n\n- [x] I can reproduce it\n\nSince Monday');
    expect(await listIssueSubscriberIds(issue.id)).toContain(s.member.id);
    const created = (await listIssueActivities(issue.id)).find((a) => a.type === 'created');
    expect(JSON.parse(created!.meta)).toMatchObject({ source: 'form' });
    session.user = null;
  });

  it('valida obligatorios y opciones; una plantilla sin campos no es un formulario', async () => {
    const s = await setup();
    session.user = s.as.owner;
    const bad = await submit.POST(post({ title: 'x', answers: { where: 'Desktop' } }), params(s.form.id));
    expect(bad.status).toBe(400);
    const errs = (await bad.json()) as { fields: Array<{ fieldId: string; code: string }> };
    expect(errs.fields).toEqual([
      { fieldId: 'where', code: 'invalid_option' },
      { fieldId: 'what', code: 'required' },
    ]);
    expect((await submit.POST(post({ title: '', answers: {} }), params(s.form.id))).status).toBe(400);
    expect((await submit.POST(post({ title: 'x', answers: {} }), params(s.plain.id))).status).toBe(400);
    session.user = null;
  });

  it('acceso: anónimo, otro workspace, team privado sin acceso e invitado', async () => {
    const s = await setup();
    const ok = { title: 't', answers: { what: 'w' } };
    session.user = null;
    expect((await submit.POST(post(ok), params(s.secretForm.id))).status).toBe(401);
    session.user = s.as.stranger;
    expect((await submit.POST(post(ok), params(s.secretForm.id))).status).toBe(404);
    // Un miembro que no está en el team privado no lo ve.
    session.user = s.as.member;
    expect((await submit.POST(post(ok), params(s.secretForm.id))).status).toBe(404);
    // El invitado solo ve Open: puede mandar ese formulario.
    session.user = s.as.guest;
    expect((await submit.POST(post(ok), params(s.secretForm.id))).status).toBe(404);
    expect((await submit.POST(post({ title: 't', answers: { where: 'Web', what: 'w' } }), params(s.form.id))).status).toBe(201);
    session.user = s.as.owner;
    expect((await submit.POST(post(ok), params(s.secretForm.id))).status).toBe(201);
    expect(await getTemplate(s.secretForm.id)).toBeTruthy();
    session.user = null;
  });
});
