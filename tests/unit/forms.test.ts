import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { ensureWorkspace, canUseApp } from '@/lib/workspace';
import { toolsFor } from '@/lib/assistant/tools';
import { formsTools } from '@/lib/assistant/tools-forms';
import type { ToolCtx } from '@/lib/assistant/registry';
import { csvCell } from '@/lib/form-engine';
import { FORM_EMBED_SCRIPT } from '@/lib/form-engine-embed';
import { createForm as createCrmForm } from '@/lib/crm-forms';
import {
  answerDisplay,
  checkAnswer,
  checkDefinition,
  checkResponse,
  computePath,
  emptyDefinition,
  escapeHtml,
  evalCondition,
  localize,
  pipe,
  responsesCsv,
  summarize,
  translatableStrings,
} from '@/lib/forms/engine';
import { templateDefinition, TEMPLATE_IDS } from '@/lib/forms/templates';
import { canAccess, createForm, getForm, listForms, slugTaken, updateForm } from '@/lib/forms/core';
import { deleteResponses, exportCsv, fileForMember, formSummary, getResponse, listResponses, purgeFormsRetention, savePartial, submitResponse, trackVisit, uploadPublicFile } from '@/lib/forms/responses';
import { syncCrmContact } from '@/lib/forms/integrations';
import { sniffFormFile } from '@/lib/forms/files';
import { searchForms } from '@/lib/forms/search';
import { FormsError, type FormDefinition, type FormsActor, type Question } from '@/lib/forms/types';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-forms-uploads-${process.pid}`);
process.env.RATE_LIMIT_DISABLED = 'true';

const uid = () => Math.random().toString(36).slice(2, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');
// PNG de 1x1 (firma).
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

async function world() {
  const o = await upsertUser({ email: `forms-owner-${uid()}@example.com`, name: 'Owner', image: null });
  const team = await ensureWorkspace(o.id);
  const owner: FormsActor = { ws: o.id, person: o.id, admin: true, crm: true };
  const member = async (apps = '["forms"]', role: 'member' | 'admin' = 'member'): Promise<FormsActor> => {
    const u = await upsertUser({ email: `forms-${uid()}@example.com`, name: `Member ${uid()}`, image: null });
    await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(team.id, u.id, role, apps);
    return { ws: o.id, person: u.id, admin: role === 'admin', crm: apps.includes('crm') || apps === '*' };
  };
  return { owner, member };
}

async function published(actor: FormsActor, template: string, name = `Form ${uid()}`) {
  const f = await createForm(actor, { name, template, lang: 'en' });
  return (await updateForm(actor, f.id, { status: 'published' }))!;
}

const q = (p: Partial<Question> & Pick<Question, 'id' | 'type'>): Question => ({ ref: p.id.replace(/^q_/, ''), title: p.id, description: '', required: false, ...p });

describe('motor: lógica y ramas', () => {
  it('NPS: cada rango salta a su pregunta y todas siguen al email', () => {
    const def = templateDefinition('nps', 'en');
    expect(computePath(def, { q_score: 3 }).path).toEqual(['q_score', 'q_low', 'q_email']);
    expect(computePath(def, { q_score: 8 }).path).toEqual(['q_score', 'q_mid', 'q_email']);
    expect(computePath(def, { q_score: 10 }).path).toEqual(['q_score', 'q_high', 'q_email']);
  });

  it('lead: equipo chico termina en el final self-serve; grande pasa por el teléfono y va a ventas', () => {
    const def = templateDefinition('lead', 'en');
    const small = computePath(def, { q_size: 'c1' });
    expect(small.endingId).toBe('end_self');
    expect(small.path).not.toContain('q_phone');
    const big = computePath(def, { q_size: 'c4' });
    expect(big.path).toContain('q_phone');
    expect(big.endingId).toBe('end_sales');
  });

  it('quiz: puntos por opción y por regla, y el final según el puntaje', () => {
    const def = templateDefinition('quiz', 'en');
    const good = computePath(def, { q_1: 'c2', q_2: 'c1', q_3: true });
    expect(good.vars.score).toBe(3);
    expect(good.endingId).toBe('end_pass');
    const bad = computePath(def, { q_1: 'c1', q_2: 'c2', q_3: false });
    expect(bad.vars.score).toBe(0);
    expect(bad.endingId).toBe('end_fail');
  });

  it('cálculos: sumar, restar, multiplicar, dividir (por cero no rompe) y fijar', () => {
    const def: FormDefinition = {
      ...emptyDefinition(),
      questions: [q({ id: 'q_n', type: 'number' }), q({ id: 'q_x', type: 'short_text' })],
      variables: [{ name: 'total', initial: 10 }],
      logic: {
        q_n: [
          {
            id: 'r1',
            match: 'all',
            conditions: [],
            actions: [
              { type: 'calc', variable: 'total', op: 'add', value: 'q:q_n' },
              { type: 'calc', variable: 'total', op: 'multiply', value: 2 },
              { type: 'calc', variable: 'total', op: 'divide', value: 0 },
              { type: 'calc', variable: 'score', op: 'set', value: 7 },
              { type: 'calc', variable: 'score', op: 'subtract', value: 2 },
            ],
          },
        ],
      },
    };
    const r = computePath(def, { q_n: 5 });
    expect(r.vars.total).toBe(30);
    expect(r.vars.score).toBe(5);
  });

  it('los saltos solo van hacia adelante y apuntan a algo que existe', () => {
    const def: FormDefinition = { ...emptyDefinition(), questions: [q({ id: 'q_a', type: 'short_text' }), q({ id: 'q_b', type: 'short_text' })] };
    expect(() => checkDefinition({ ...def, logic: { q_b: [{ id: 'r', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'q:q_a' }] }] } })).toThrow(FormsError);
    expect(() => checkDefinition({ ...def, logic: { q_a: [{ id: 'r', match: 'all', conditions: [], actions: [{ type: 'jump', to: 'end:nope' }] }] } })).toThrow(FormsError);
    expect(() => checkDefinition({ ...def, logic: { q_a: [{ id: 'r', match: 'all', conditions: [{ left: 'q:ghost', op: 'answered', value: '' }], actions: [{ type: 'jump', to: 'q:q_b' }] }] } })).toThrow(FormsError);
    expect(() => checkDefinition({ ...def, questions: [...def.questions, q({ id: 'q_c', ref: 'a', type: 'short_text' })] })).toThrow(/duplicate_ref/);
  });

  it('las condiciones se evalúan con una tabla, nunca como código', () => {
    const def: FormDefinition = { ...emptyDefinition(), questions: [q({ id: 'q_t', type: 'short_text' }), q({ id: 'q_m', type: 'multi_choice', choices: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] })], hidden: ['src'] };
    const state = { answers: { q_t: 'Hello World', q_m: ['b'] }, hidden: { src: 'ads' }, vars: { score: 4 } };
    expect(evalCondition(def, { left: 'q:q_t', op: 'contains', value: 'world' }, state)).toBe(true);
    expect(evalCondition(def, { left: 'q:q_m', op: 'includes', value: 'b' }, state)).toBe(true);
    expect(evalCondition(def, { left: 'q:q_m', op: 'not_includes', value: 'a' }, state)).toBe(true);
    expect(evalCondition(def, { left: 'v:score', op: 'gte', value: '4' }, state)).toBe(true);
    expect(evalCondition(def, { left: 'h:src', op: 'is', value: 'ADS' }, state)).toBe(true);
    // Un "valor" con código es solo texto: no se ejecuta ni rompe.
    (globalThis as Record<string, unknown>).__pwned = false;
    expect(evalCondition(def, { left: 'v:score', op: 'gt', value: '0); globalThis.__pwned = true; (1' }, state)).toBe(false);
    expect(evalCondition(def, { left: 'q:q_t', op: 'is', value: '${globalThis.__pwned = true}' }, state)).toBe(false);
    expect((globalThis as Record<string, unknown>).__pwned).toBe(false);
  });

  it('checkResponse: lo que queda fuera por una rama no se exige ni se guarda', () => {
    const def = templateDefinition('rsvp', 'en');
    const res = checkResponse(def, { q_name: 'Ana', q_email: 'ana@example.com', q_attend: false, q_guests: '99', q_diet: 'c2' });
    expect(res.errors).toEqual({});
    expect(res.endingId).toBe('end_no');
    expect(res.answers.q_guests).toBeUndefined();
    expect(res.answers.q_diet).toBeUndefined();
    // Yendo, los invitados se validan (máximo 5).
    expect(checkResponse(def, { q_name: 'Ana', q_email: 'ana@example.com', q_attend: true, q_guests: '99' }).errors.q_guests).toBe('too_large');
  });

  it('todas las plantillas son válidas en los tres idiomas', () => {
    expect(TEMPLATE_IDS).toHaveLength(12);
    for (const id of TEMPLATE_IDS) for (const lang of ['en', 'es', 'pt'] as const) expect(() => checkDefinition(templateDefinition(id, lang))).not.toThrow();
  });
});

describe('motor: validación', () => {
  it('por tipo', () => {
    expect(checkAnswer(q({ id: 'e', type: 'email', required: true }), '')).toEqual({ error: 'required' });
    expect(checkAnswer(q({ id: 'e', type: 'email' }), 'not-an-email').error).toBe('invalid_email');
    expect(checkAnswer(q({ id: 'e', type: 'email' }), ' Ana@Example.com ').value).toBe('ana@example.com');
    expect(checkAnswer(q({ id: 'p', type: 'phone' }), 'abc').error).toBe('invalid_phone');
    expect(checkAnswer(q({ id: 'u', type: 'url' }), 'example.com').value).toBe('https://example.com');
    expect(checkAnswer(q({ id: 'u', type: 'url' }), 'javascript:alert(1)').error).toBe('invalid_url');
    expect(checkAnswer(q({ id: 'n', type: 'number', min: 1, max: 10 }), '11').error).toBe('too_large');
    expect(checkAnswer(q({ id: 'n', type: 'number' }), '3,5').value).toBe(3.5);
    expect(checkAnswer(q({ id: 't', type: 'short_text', min: 3 }), 'ab').error).toBe('too_short');
    expect(checkAnswer(q({ id: 'd', type: 'date' }), '2026-02-30').error).toBe('invalid_date');
    expect(checkAnswer(q({ id: 'd', type: 'date', minDate: '2026-01-01' }), '2025-12-31').error).toBe('too_small');
    const choices = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }];
    expect(checkAnswer(q({ id: 'c', type: 'choice', choices }), 'z').error).toBe('invalid_option');
    expect(checkAnswer(q({ id: 'm', type: 'multi_choice', choices, max: 2 }), ['a', 'b', 'c']).error).toBe('too_many');
    expect(checkAnswer(q({ id: 'r', type: 'ranking', choices }), ['a', 'b']).error).toBe('invalid_option');
    expect(checkAnswer(q({ id: 'r', type: 'ranking', choices }), ['c', 'a', 'b']).value).toEqual(['c', 'a', 'b']);
    expect(checkAnswer(q({ id: 's', type: 'opinion_scale', nps: true }), 0).value).toBe(0);
    expect(checkAnswer(q({ id: 's', type: 'opinion_scale', nps: true }), 11).error).toBe('invalid_option');
    expect(checkAnswer(q({ id: 'r', type: 'rating', steps: 5 }), 0).error).toBe('invalid_option');
    expect(checkAnswer(q({ id: 'y', type: 'yes_no' }), 'no').value).toBe(false);
    const matrix = q({ id: 'x', type: 'matrix', required: true, rows: [{ id: 'r1', label: 'R1' }, { id: 'r2', label: 'R2' }], columns: [{ id: 'k1', label: 'K1' }] });
    expect(checkAnswer(matrix, { r1: 'k1' }).error).toBe('required');
    expect(checkAnswer(matrix, { r1: 'k1', r2: 'k9' }).error).toBe('invalid_option');
    expect(checkAnswer(q({ id: 'f', type: 'file_upload' }), { fileId: '../../etc/passwd', name: 'x', size: 1 }).error).toBe('invalid');
    expect(checkAnswer(q({ id: 's', type: 'signature' }), 'data:text/html;base64,PHNjcmlwdD4=').error).toBe('invalid');
    expect(checkAnswer(q({ id: 'st', type: 'statement', required: true }), undefined)).toEqual({});
  });
});

describe('motor: piping y escape', () => {
  it('el piping inserta texto plano; quien lo muestra lo escapa', () => {
    const def: FormDefinition = { ...emptyDefinition(), questions: [q({ id: 'q_name', ref: 'name', type: 'short_text' }), q({ id: 'q_c', ref: 'color', type: 'choice', choices: [{ id: 'r', label: 'Red' }] })], hidden: ['src'] };
    const evil = '<img src=x onerror=alert(1)>';
    const out = pipe('Hi {{name}}, you chose {{ color }} from {{src}} ({{score}}) {{unknown}}', def, { answers: { q_name: evil, q_c: 'r' }, vars: { score: 2 }, hidden: { src: 'ads' } });
    expect(out).toBe(`Hi ${evil}, you chose Red from ads (2) `);
    // En HTML (emails) se escapa: nada se interpreta.
    expect(escapeHtml(out)).not.toMatch(/<img/);
    expect(escapeHtml(out)).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // Cada valor insertado se corta en 200 caracteres.
    expect(pipe('{{name}}', def, { answers: { q_name: 'x'.repeat(500) } })).toHaveLength(200);
  });

  it('traducciones: lo traducido reemplaza al base y lo vacío queda en el base', () => {
    const def = { ...templateDefinition('contact', 'en'), languages: ['es' as const] };
    def.translations = { es: { 'q.q_name.title': '¿Tu nombre?' } };
    const keys = translatableStrings(def).map((s) => s.key);
    expect(keys).toContain('q.q_email.title');
    expect(keys).toContain('ending.end_thanks.title');
    const es = localize(def, 'es');
    expect(es.questions[0].title).toBe('¿Tu nombre?');
    expect(es.questions[1].title).toBe(def.questions[1].title);
    expect(localize(def, 'pt')).toBe(def);
  });
});

describe('CSV', () => {
  it('guarda de fórmulas en cada celda y una columna por pregunta', () => {
    expect(csvCell('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`);
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    const def = templateDefinition('contact', 'en');
    const csv = responsesCsv(def, [{ id: 'fmr_1', status: 'completed', submittedAt: '2026-10-30T10:00:00Z', createdAt: '2026-10-30T10:00:00Z', lang: 'en', endingId: 'end_thanks', answers: { q_name: '=cmd|calc', q_email: 'a@b.co', q_message: 'hi' }, hidden: {}, vars: { score: 0 } }]);
    const [header, row] = csv.split('\r\n');
    expect(header).toBe('response_id,status,submitted_at,language,ending,What is your name?,What is your email?,"How can we help, {{name}}?",score');
    expect(row).toContain("'=cmd|calc");
  });
});

describe('summary y respuestas', () => {
  it('resumen: conteos, promedio y NPS', () => {
    const def = templateDefinition('nps', 'en');
    const s = summarize(def, [{ answers: { q_score: 10 } }, { answers: { q_score: 9 } }, { answers: { q_score: 3 } }, { answers: { q_score: 7 } }]);
    const nps = s.find((x) => x.id === 'q_score')!;
    expect(nps.nps).toEqual({ score: 25, promoters: 2, passives: 1, detractors: 1 });
    expect(nps.average).toBe(7.25);
    expect(answerDisplay(def.questions[0], 9)).toBe('9');
  });
});

describe('servidor: envío, límites, archivos y permisos', () => {
  it('envío completo con rama, archivo privado y firma; el borrador no existe en público', async () => {
    const { owner } = await world();
    const draft = await createForm(owner, { name: 'Draft', template: 'job', lang: 'en' });
    expect((await submitResponse(draft.slug, { answers: {} })).ok).toBe(false);
    const f = (await updateForm(owner, draft.id, { status: 'published' }))!;
    // El tipo se decide por los bytes: un "PDF" que es HTML no pasa.
    await expect(uploadPublicFile(f.slug, 'q_cv', { bytes: Buffer.from('<html><script>alert(1)</script>'), filename: 'cv.pdf' })).rejects.toMatchObject({ code: 'file_type' });
    await expect(uploadPublicFile(f.slug, 'q_cv', { bytes: Buffer.alloc(6 * 1024 * 1024, 0x25), filename: 'big.pdf' })).rejects.toMatchObject({ code: 'file_size' });
    await expect(uploadPublicFile(f.slug, 'q_name', { bytes: PDF, filename: 'cv.pdf' })).rejects.toMatchObject({ code: 'invalid_question' });
    const file = await uploadPublicFile(f.slug, 'q_cv', { bytes: PDF, filename: 'my cv <x>.pdf' });
    expect(file.name).toBe('my cv _x_.pdf');
    const res = await submitResponse(f.slug, { answers: { q_name: 'Ana Pérez', q_email: 'ana@example.com', q_role: 'c1', q_cv: file }, consent: true, elapsedMs: 5000 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // El mismo archivo no se reusa en otro envío.
    const again = await submitResponse(f.slug, { answers: { q_name: 'Bob', q_email: 'bob@example.com', q_role: 'c1', q_cv: file }, consent: true });
    expect(again.ok).toBe(false);
    const got = await fileForMember(owner, file.fileId);
    expect(got?.mime).toBe('application/pdf');
    // Sin consentimiento obligatorio no se envía.
    expect((await submitResponse(f.slug, { answers: { q_name: 'Bob', q_email: 'bob@example.com', q_role: 'c1' } })).ok).toBe(false);
  });

  it('honeypot y tiempo mínimo: responde ok sin guardar nada', async () => {
    const { owner } = await world();
    const f = await published(owner, 'contact');
    const a = await submitResponse(f.slug, { answers: { q_name: 'Bot', q_email: 'bot@x.io', q_message: 'buy' }, website_url: 'http://spam' });
    const b = await submitResponse(f.slug, { answers: { q_name: 'Bot', q_email: 'bot@x.io', q_message: 'buy' }, elapsedMs: 200 });
    expect(a.ok && a.spam).toBe(true);
    expect(b.ok && b.spam).toBe(true);
    expect((await listResponses(owner, f.id))!.total).toBe(0);
  });

  it('tope de respuestas con envíos simultáneos: nunca se pasa', async () => {
    const { owner } = await world();
    const f = await published(owner, 'contact');
    await updateForm(owner, f.id, { settings: { responseLimit: 3 } });
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => submitResponse(f.slug, { answers: { q_name: `P${i}`, q_email: `p${i}@example.com`, q_message: 'hi' } })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(results.filter((r) => !r.ok && r.error === 'closed')).toHaveLength(7);
    expect((await listResponses(owner, f.id))!.total).toBe(3);
    expect((await getForm(owner, f.id))!.closedReason).toBe('limit');
    // Borrar una respuesta libera un lugar.
    const one = (await listResponses(owner, f.id))!.rows[0];
    await deleteResponses(owner, f.id, [one.id]);
    expect((await getForm(owner, f.id))!.open).toBe(true);
  });

  it('límite por IP y cierre por fecha', async () => {
    const { owner } = await world();
    const f = await published(owner, 'contact');
    await updateForm(owner, f.id, { settings: { perIpLimit: 1 } });
    const body = { answers: { q_name: 'Ana', q_email: 'ana@example.com', q_message: 'hi' } };
    expect((await submitResponse(f.slug, body, { ip: '203.0.113.9' })).ok).toBe(true);
    const second = await submitResponse(f.slug, body, { ip: '203.0.113.9' });
    expect(!second.ok && second.error).toBe('ip_limit');
    expect((await submitResponse(f.slug, body, { ip: '203.0.113.10' })).ok).toBe(true);
    await updateForm(owner, f.id, { settings: { closeAt: new Date(Date.now() - 1000).toISOString() } });
    const closed = await submitResponse(f.slug, body, { ip: '203.0.113.11' });
    expect(!closed.ok && closed.reason).toBe('date');
  });

  it('parciales: solo con consentimiento, y el envío final completa la misma fila', async () => {
    const { owner } = await world();
    const f = await published(owner, 'contact');
    await expect(savePartial(f.slug, { answers: { q_name: 'Ana' }, consent: true })).rejects.toMatchObject({ code: 'partials_off' });
    await updateForm(owner, f.id, { settings: { partials: true } });
    await expect(savePartial(f.slug, { answers: { q_name: 'Ana' }, consent: false })).rejects.toMatchObject({ code: 'partials_off' });
    const saved = await savePartial(f.slug, { answers: { q_name: 'Ana' }, consent: true });
    expect(saved?.token).toMatch(/^[a-f0-9]{32}$/);
    expect((await listResponses(owner, f.id, { status: 'partial' }))!.total).toBe(1);
    const done = await submitResponse(f.slug, { answers: { q_name: 'Ana', q_email: 'ana@example.com', q_message: 'hi' }, resumeToken: saved!.token });
    expect(done.ok).toBe(true);
    expect((await listResponses(owner, f.id, { status: 'partial' }))!.total).toBe(0);
    expect((await listResponses(owner, f.id))!.total).toBe(1);
  });

  it('acceso: sin la app no hay herramientas; con la app solo los forms compartidos con la persona', async () => {
    const { owner, member } = await world();
    expect(canUseApp({ role: 'member', apps: ['crm'] }, 'forms')).toBe(false);
    const names = (apps: '*' | Array<'crm' | 'forms'>) => toolsFor({ role: 'member', apps }).map((t) => t.name);
    expect(names(['crm'])).not.toContain('forms_response_count');
    expect(names(['forms'])).toContain('forms_response_count');
    expect(toolsFor({ role: 'guest', apps: '*' }).map((t) => t.name)).not.toContain('forms_list');

    const alice = await member();
    const bob = await member();
    const f = await published(owner, 'job', `Private hiring ${uid()}`);
    await updateForm(owner, f.id, { sharing: 'people', members: [alice.person] });
    const file = await uploadPublicFile(f.slug, 'q_cv', { bytes: PDF, filename: 'cv.pdf' });
    const res = await submitResponse(f.slug, { answers: { q_name: 'Ana', q_email: 'ana@example.com', q_role: 'c1', q_cv: file }, consent: true });
    expect(res.ok).toBe(true);
    const rid = res.ok ? res.responseId! : '';

    expect(await getForm(alice, f.id)).not.toBeNull();
    expect(await getForm(bob, f.id)).toBeNull();
    expect(await listResponses(bob, f.id)).toBeNull();
    expect(await getResponse(bob, f.id, rid)).toBeNull();
    expect(await exportCsv(bob, f.id)).toBeNull();
    expect(await formSummary(bob, f.id)).toBeNull();
    expect(await fileForMember(bob, file.fileId)).toBeNull();
    expect(await fileForMember(alice, file.fileId)).not.toBeNull();
    expect((await listForms(bob)).some((x) => x.id === f.id)).toBe(false);
    expect((await searchForms(bob, 'Private hiring')).length).toBe(0);
    expect((await searchForms(alice, 'Private hiring')).length).toBe(1);
    await expect(deleteResponses(bob, f.id, [rid])).rejects.toMatchObject({ code: 'not_found' });
    // Solo quien lo creó o un admin cambia quién lo ve.
    await expect(updateForm(alice, f.id, { sharing: 'workspace' })).rejects.toMatchObject({ code: 'forbidden' });
    // Otro workspace nunca.
    const other = await world();
    expect(await canAccess(other.owner, { id: f.id, workspace_id: owner.ws, sharing: 'workspace', created_by: owner.person })).toBe(false);
    // El asistente respeta el mismo acceso.
    const ctx = (a: FormsActor): ToolCtx => ({ user: { id: a.ws, role: 'member', apps: ['forms'] } as never, workspaceId: a.ws, personId: a.person, locale: 'en', isAdmin: a.admin });
    const count = formsTools.find((t) => t.name === 'forms_response_count')!;
    if (count.kind !== 'read') throw new Error('read tool');
    expect(await count.run(ctx(bob), { form: f.name, period: 'all' })).toMatchObject({ error: 'form_not_found' });
    expect(await count.run(ctx(alice), { form: f.name, period: 'all' })).toMatchObject({ responses: 1 });
    // Avisos solo a quienes tienen acceso: Bob en la lista no recibe nada.
    await updateForm(owner, f.id, { settings: { notifyPeople: [alice.person, bob.person] } });
    expect((await getForm(owner, f.id))!.settings.notifyPeople).toEqual([alice.person]);
  });

  it('CRM: un email nuevo crea el contacto; uno existente no se toca (nota sin verificar)', async () => {
    const { owner } = await world();
    const crm = await import('@/lib/crm');
    const existing = await crm.createContact(owner.ws, { firstName: 'Real', lastName: 'Person', email: 'real@example.com', phone: '' });
    const f = await published(owner, 'lead');
    await updateForm(owner, f.id, { settings: { crm: { enabled: true, email: 'q_email', name: 'q_name', phone: 'q_phone', company: 'q_company' } } });
    const row = (await getDb().prepare('SELECT * FROM forms_forms WHERE id = ?').get(f.id)) as never;
    const def = (await getForm(owner, f.id))!.definition;

    const fresh = await syncCrmContact(row, def, { q_email: 'new-lead@example.com', q_name: '=Evil Name', q_phone: '+54 11 5555 0000' });
    expect(fresh.created).toBe(true);
    const c = (await getDb().prepare('SELECT first_name, last_name, phone FROM crm_contacts WHERE id = ?').get(fresh.contactId!)) as { first_name: string; last_name: string; phone: string };
    expect(c.first_name).toBe('Evil');
    expect(c.phone).toBe('+54 11 5555 0000');

    const hijack = await syncCrmContact(row, def, { q_email: 'REAL@example.com', q_name: 'Attacker', q_phone: '+1 999 999 9999' });
    expect(hijack).toEqual({ contactId: null, created: false, unverified: true });
    const after = (await getDb().prepare('SELECT first_name, last_name, phone FROM crm_contacts WHERE id = ?').get(existing.id)) as { first_name: string; last_name: string; phone: string };
    expect(after).toEqual({ first_name: 'Real', last_name: 'Person', phone: '' });
    const note = (await getDb().prepare("SELECT subject, contact_id FROM crm_activities WHERE user_id = ? AND subject LIKE '%unverified%' ORDER BY rowid DESC LIMIT 1").get(owner.ws)) as { subject: string; contact_id: string | null };
    expect(note.contact_id).toBeNull();

    // Prender el CRM requiere tener la app.
    const noCrm: FormsActor = { ...owner, admin: true, crm: false };
    const g = await createForm(noCrm, { name: 'x', template: 'contact' });
    await expect(updateForm(noCrm, g.id, { settings: { crm: { enabled: true, email: 'q_email', name: '', phone: '', company: '' } } })).rejects.toMatchObject({ code: 'crm_forbidden' });
  });

  it('retención con compare-and-set: dos corridas a la vez borran cada respuesta una sola vez', async () => {
    const { owner } = await world();
    const f = await published(owner, 'contact');
    for (let i = 0; i < 4; i++) await submitResponse(f.slug, { answers: { q_name: `R${i}`, q_email: `r${i}@example.com`, q_message: 'hi' } });
    await updateForm(owner, f.id, { settings: { retentionDays: 30 } });
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await getDb().prepare('UPDATE forms_responses SET submitted_at = ?, updated_at = ? WHERE form_id = ?').run(old, old, f.id);
    // Un archivo huérfano viejo.
    const g = await published(owner, 'job');
    const loose = await uploadPublicFile(g.slug, 'q_cv', { bytes: PDF, filename: 'cv.pdf' });
    await getDb().prepare('UPDATE forms_files SET created_at = ? WHERE id = ?').run(old, loose.fileId);
    const [a, b] = await Promise.all([purgeFormsRetention(), purgeFormsRetention()]);
    expect(a.responses + b.responses).toBeGreaterThanOrEqual(4);
    expect((await listResponses(owner, f.id))!.total).toBe(0);
    expect(a.orphans + b.orphans).toBeGreaterThanOrEqual(1);
    expect(await getDb().prepare('SELECT 1 FROM forms_files WHERE id = ?').get(loose.fileId)).toBeUndefined();
    // Lo reciente no se toca.
    await submitResponse(f.slug, { answers: { q_name: 'New', q_email: 'new@example.com', q_message: 'hi' } });
    await purgeFormsRetention();
    expect((await listResponses(owner, f.id))!.total).toBe(1);
  });

  it('visitas y abandono, firma como archivo privado', async () => {
    const { owner } = await world();
    const f = (await createForm(owner, { name: 'Sign', definition: { ...emptyDefinition(), questions: [q({ id: 'q_a', type: 'short_text' }), q({ id: 'q_sig', type: 'signature', required: true })] } }))!;
    await updateForm(owner, f.id, { status: 'published' });
    await trackVisit(f.slug, 'visit00001aa', 'q_a');
    await trackVisit(f.slug, 'visit00001aa', 'q_sig');
    await trackVisit(f.slug, 'visit00002bb', 'q_a');
    const res = await submitResponse(f.slug, { answers: { q_a: 'x', q_sig: `data:image/png;base64,${PNG_1PX}` }, visitId: 'visit00001aa' });
    expect(res.ok).toBe(true);
    const s = (await formSummary(owner, f.id))!;
    expect(s.visits).toBe(2);
    expect(s.completionRate).toBe(50);
    expect(s.dropOff.find((d) => d.id === 'q_sig')!.reached).toBe(1);
    const r = (await listResponses(owner, f.id))!.rows[0];
    const sig = r.answers.q_sig as { fileId: string };
    expect(sig.fileId).toMatch(/^fmf_/);
    expect((await fileForMember(owner, sig.fileId))?.mime).toBe('image/png');
    expect(sniffFormFile(new Uint8Array(Buffer.from('GIF89a')), 'x.png')?.mime).toBe('image/gif');
  });

  it('el slug de /f/ no choca con los formularios del CRM', async () => {
    const { owner } = await world();
    const crm = await createCrmForm(owner.ws, { name: 'CRM form', slug: `contact-${uid()}` });
    expect(await slugTaken(crm.slug!)).toBe(true);
    const f = await createForm(owner, { name: 'x' });
    await expect(updateForm(owner, f.id, { slug: crm.slug! })).rejects.toMatchObject({ code: 'slug_taken' });
    await expect(createCrmForm(owner.ws, { name: 'dup', slug: f.slug })).rejects.toMatchObject({ code: 'slug_taken' });
  });

  it('el embed común también abre en popup y pasa los parámetros pedidos', () => {
    const inserted: Array<{ src?: string; textContent?: string }> = [];
    const script = {
      src: 'https://zerosoft.ai/api/forms/embed.js',
      getAttribute: (k: string) => ({ 'data-form': 'nps-abc123', 'data-mode': 'popup', 'data-params': 'email', 'data-button': 'Give feedback' })[k] ?? null,
      parentNode: { insertBefore: (el: { src?: string }) => inserted.push(el) },
      dispatchEvent: () => true,
    };
    const created: Array<Record<string, unknown>> = [];
    const el = () => {
      const e: Record<string, unknown> = { style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} };
      created.push(e);
      return e;
    };
    new Function('document', 'window', 'URL', 'URLSearchParams', 'CustomEvent', FORM_EMBED_SCRIPT)(
      { currentScript: script, referrer: '', createElement: el, addEventListener() {}, body: { appendChild() {} } },
      { location: { href: 'https://acme.io/?email=a%40b.co&x=1&utm_source=g' }, addEventListener() {} },
      URL,
      URLSearchParams,
      class {},
    );
    expect(inserted).toHaveLength(1);
    expect(inserted[0].textContent).toBe('Give feedback');
    const frame = created.find((e) => typeof e.src === 'string' && (e.src as string).includes('/f/'))!;
    const src = new URL(frame.src as string);
    expect(src.pathname).toBe('/en/f/nps-abc123');
    expect(src.searchParams.get('email')).toBe('a@b.co');
    expect(src.searchParams.get('x')).toBeNull();
    expect(src.searchParams.get('popup')).toBe('1');
  });
});
