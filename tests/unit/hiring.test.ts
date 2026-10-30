import os from 'os';
import path from 'path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { ensureWorkspace } from '@/lib/workspace';
import { canUseApp } from '@/lib/workspace';
import { scopesForApps } from '@/lib/api-scopes';
import { toolsFor } from '@/lib/assistant/tools';
import {
  answerErrors,
  canApproveOffer,
  canSeeApplication,
  canSeeOthersScores,
  failedKnockouts,
  renderTemplate,
  sniffResume,
  type HiringActor,
  type Question,
} from '@/lib/hiring/types';
import { createJob, ensureSettings, listStages, setTeam, updateJob, updateSettings } from '@/lib/hiring/core';
import {
  applyPublic,
  deleteCandidate,
  getCandidateProfile,
  listApplications,
  moveApplication,
  purgeExpiredCandidates,
  searchHiring,
  upsertCandidate,
  forgetByToken,
} from '@/lib/hiring/candidates';
import { submitScorecard, sendFeedbackReminders } from '@/lib/hiring/evaluation';
import { actOnOffer, createOffer, respondToOffer } from '@/lib/hiring/offers';
import { parseHiringAddress, hiringReplyAddress, processHiringInbound } from '@/lib/hiring/comms';
import { registerOnHire, type HireEvent } from '@/lib/hiring/events';
import { jobPostingJsonLd, publishedCareers, publishedJob } from '@/lib/hiring/careers';
import { descriptionHtml } from '@/lib/hiring/markdown';

process.env.UPLOADS_DIR = path.join(os.tmpdir(), `zs-hiring-uploads-${process.pid}`);
process.env.CHAT_INBOUND_DOMAIN = 'inbound.example.test';
process.env.RATE_LIMIT_DISABLED = 'true';

const uid = () => Math.random().toString(36).slice(2, 10);
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n', 'latin1');

interface World {
  owner: HiringActor;
  recruiter: HiringActor;
  manager: HiringActor;
  interviewer: HiringActor;
  interviewer2: HiringActor;
  outsider: HiringActor;
  handle: string;
}

async function person(ws: string, teamId: string, role: 'admin' | 'member', apps = '["hiring"]'): Promise<HiringActor> {
  const u = await upsertUser({ email: `hr-${uid()}@example.com`, name: `Person ${uid()}`, image: null });
  await getDb().prepare('INSERT INTO team_members (team_id, user_id, role, apps) VALUES (?, ?, ?, ?)').run(teamId, u.id, role, apps);
  return { ws, person: u.id, admin: role === 'admin' };
}

async function world(): Promise<World> {
  const o = await upsertUser({ email: `hr-owner-${uid()}@example.com`, name: 'Owner', image: null });
  const team = await ensureWorkspace(o.id);
  const owner = { ws: o.id, person: o.id, admin: true };
  const settings = await ensureSettings(o.id);
  return {
    owner,
    recruiter: await person(o.id, team.id, 'member'),
    manager: await person(o.id, team.id, 'member'),
    interviewer: await person(o.id, team.id, 'member'),
    interviewer2: await person(o.id, team.id, 'member'),
    outsider: await person(o.id, team.id, 'member'),
    handle: settings.handle,
  };
}

const KNOCK: Question[] = [
  { id: 'auth', label: 'Work permit?', type: 'yesno', required: true, options: [], knockout: { accepted: ['yes'], min: null } },
  { id: 'years', label: 'Years', type: 'number', required: false, options: [], knockout: { accepted: [], min: 3 } },
  { id: 'lang', label: 'Language', type: 'select', required: false, options: ['English', 'Spanish', 'French'], knockout: { accepted: ['English', 'Spanish'], min: null } },
  { id: 'why', label: 'Why us?', type: 'textarea', required: false, options: [], knockout: null },
];

/** Puesto publicado con equipo: recruiter, hiring manager y dos interviewers. */
async function setupJob(w: World, questions: Question[] = []) {
  const detail = await createJob(w.recruiter, { title: `Engineer ${uid()}`, description: '## Role\n- Build things', questions });
  await setTeam(w.recruiter, detail.job.id, [
    { userId: w.recruiter.person, role: 'recruiter' },
    { userId: w.manager.person, role: 'hiring_manager' },
    { userId: w.interviewer.person, role: 'interviewer' },
    { userId: w.interviewer2.person, role: 'interviewer' },
  ]);
  await updateJob(w.recruiter, detail.job.id, { status: 'published' });
  const stages = await listStages(detail.job.id);
  return { jobId: detail.job.id, slug: detail.job.slug, stages };
}

async function apply(w: World, slug: string, email: string, answers: Record<string, string> = {}, extra: Partial<Parameters<typeof applyPublic>[2]> = {}) {
  return applyPublic(
    w.handle,
    slug,
    { name: 'Ana Pérez', email, phone: '', linkedin: '', answers, consent: true, keepConsent: false, utm: {}, referrer: '', source: null, ...extra },
    { bytes: PDF, filename: 'cv.pdf' },
  );
}

let w: World;
beforeAll(async () => {
  w = await world();
});

// ---------- Reglas puras ----------

describe('reglas de acceso (puras)', () => {
  it('scorecards: un interviewer no ve los ajenos hasta enviar el suyo', () => {
    expect(canSeeOthersScores({ admin: false, jobRole: 'interviewer', submittedOwn: false })).toBe(false);
    expect(canSeeOthersScores({ admin: false, jobRole: 'interviewer', submittedOwn: true })).toBe(true);
    expect(canSeeOthersScores({ admin: false, jobRole: 'recruiter', submittedOwn: false })).toBe(true);
    expect(canSeeOthersScores({ admin: false, jobRole: 'hiring_manager', submittedOwn: false })).toBe(true);
    expect(canSeeOthersScores({ admin: true, jobRole: null, submittedOwn: false })).toBe(true);
    expect(canSeeOthersScores({ admin: false, jobRole: null, submittedOwn: true })).toBe(false);
  });

  it('postulación: equipo del puesto o admin; el interviewer solo si está asignado', () => {
    expect(canSeeApplication({ admin: false, jobRole: null, assigned: false })).toBe(false);
    expect(canSeeApplication({ admin: false, jobRole: 'interviewer', assigned: false })).toBe(false);
    expect(canSeeApplication({ admin: false, jobRole: 'interviewer', assigned: true })).toBe(true);
    expect(canSeeApplication({ admin: false, jobRole: 'recruiter', assigned: false })).toBe(true);
    expect(canSeeApplication({ admin: true, jobRole: null, assigned: false })).toBe(true);
  });

  it('aprobar ofertas: hiring manager o admin, nunca recruiter ni interviewer', () => {
    expect(canApproveOffer({ admin: false, jobRole: 'recruiter' })).toBe(false);
    expect(canApproveOffer({ admin: false, jobRole: 'interviewer' })).toBe(false);
    expect(canApproveOffer({ admin: false, jobRole: null })).toBe(false);
    expect(canApproveOffer({ admin: false, jobRole: 'hiring_manager' })).toBe(true);
    expect(canApproveOffer({ admin: true, jobRole: null })).toBe(true);
  });

  it('knock-out: sí/no, mínimo numérico y opciones aceptadas', () => {
    expect(failedKnockouts(KNOCK, { auth: 'yes', years: '5', lang: 'Spanish' })).toEqual([]);
    expect(failedKnockouts(KNOCK, { auth: 'no', years: '5', lang: 'English' })).toEqual(['auth']);
    expect(failedKnockouts(KNOCK, { auth: 'yes', years: '2', lang: 'French' })).toEqual(['years', 'lang']);
    // Sin respuesta en una knock-out = no la cumple.
    expect(failedKnockouts(KNOCK, { auth: 'yes' })).toEqual(['years', 'lang']);
    expect(answerErrors(KNOCK, {})).toEqual(['auth']);
    expect(answerErrors(KNOCK, { auth: 'maybe' })).toEqual(['auth']);
    expect(answerErrors(KNOCK, { auth: 'yes', lang: 'German' })).toEqual(['lang']);
  });

  it('resume: solo PDF, DOCX o DOC por sus bytes', () => {
    expect(sniffResume(new Uint8Array(PDF.subarray(0, 8)), 'x.pdf')?.ext).toBe('pdf');
    expect(sniffResume(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'cv.docx')?.ext).toBe('docx');
    expect(sniffResume(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]), 'cv.zip')).toBeNull();
    expect(sniffResume(new Uint8Array(Buffer.from('<html><script>')), 'cv.pdf')).toBeNull();
  });

  it('plantillas y descripción: variables y HTML escapado', () => {
    expect(renderTemplate('Hi {{candidate.firstName}} ({{unknown}})', { 'candidate.firstName': 'Ana' })).toBe('Hi Ana ()');
    const html = descriptionHtml('## Role\n- <b>x</b>\n[a](javascript:alert(1)) [b](https://ok.example)');
    expect(html).toContain('<h2>Role</h2>');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('javascript:alert(1)"');
    expect(html).toContain('href="https://ok.example"');
  });
});

// ---------- Duplicados ----------

describe('duplicados por email', () => {
  it('el mismo email (otra mayúscula) se une al candidato existente', async () => {
    const email = `dup-${uid()}@Example.com`;
    const a = await upsertCandidate(w.owner.ws, { email, name: 'Ana' });
    const b = await upsertCandidate(w.owner.ws, { email: email.toUpperCase(), name: 'Ana P.', phone: '+54 11 5555' });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.candidate.id).toBe(a.candidate.id);
    expect(b.candidate.phone).toBe('+54 11 5555');
  });

  it('postularse dos veces al mismo puesto no crea otra postulación; a otro puesto sí, con el mismo candidato', async () => {
    const j1 = await setupJob(w);
    const j2 = await setupJob(w);
    const email = `twice-${uid()}@example.com`;
    const first = await apply(w, j1.slug, email);
    const again = await apply(w, j1.slug, email);
    expect(again.applicationId).toBe(first.applicationId);
    expect(again.existing).toBe(true);
    const other = await apply(w, j2.slug, email);
    expect(other.duplicate).toBe(true);
    const rows = (await getDb().prepare('SELECT DISTINCT candidate_id FROM hiring_applications WHERE id IN (?, ?)').all(first.applicationId, other.applicationId)) as unknown[];
    expect(rows).toHaveLength(1);
  });
});

// ---------- Knock-out de punta a punta ----------

describe('postulación con knock-out', () => {
  it('marca la postulación para revisar sin rechazarla', async () => {
    const j = await setupJob(w, KNOCK);
    await expect(apply(w, j.slug, `ko-${uid()}@example.com`, {})).rejects.toMatchObject({ code: 'invalid_answers' });
    const res = await apply(w, j.slug, `ko-${uid()}@example.com`, { auth: 'no', years: '10', lang: 'English' });
    const row = (await getDb().prepare('SELECT knocked_out, status FROM hiring_applications WHERE id = ?').get(res.applicationId)) as { knocked_out: number; status: string };
    expect(row).toEqual({ knocked_out: 1, status: 'active' });
    const ok = await apply(w, j.slug, `ok-${uid()}@example.com`, { auth: 'yes', years: '10', lang: 'English' });
    expect(((await getDb().prepare('SELECT knocked_out FROM hiring_applications WHERE id = ?').get(ok.applicationId)) as { knocked_out: number }).knocked_out).toBe(0);
    const flagged = await listApplications(w.recruiter, { jobId: j.jobId, knockedOut: true });
    expect(flagged.map((a) => a.id)).toEqual([res.applicationId]);
  });

  it('sin consentimiento o con un CV que no es PDF/DOC no entra', async () => {
    const j = await setupJob(w);
    await expect(
      applyPublic(w.handle, j.slug, { name: 'X', email: `nc-${uid()}@example.com`, phone: '', linkedin: '', answers: {}, consent: false, keepConsent: false, utm: {}, referrer: '', source: null }, { bytes: PDF, filename: 'cv.pdf' }),
    ).rejects.toMatchObject({ code: 'consent_required' });
    await expect(
      applyPublic(w.handle, j.slug, { name: 'X', email: `bad-${uid()}@example.com`, phone: '', linkedin: '', answers: {}, consent: true, keepConsent: false, utm: {}, referrer: '', source: null }, { bytes: Buffer.from('<svg onload=alert(1)>'), filename: 'cv.pdf' }),
    ).rejects.toMatchObject({ code: 'resume_type' });
  });
});

// ---------- PII del equipo ----------

describe('datos del candidato: solo el equipo del puesto y admins', () => {
  it('fuera del equipo no lo ve en listas, perfil ni búsqueda; el interviewer solo si lo asignaron', async () => {
    const j = await setupJob(w);
    const email = `pii-${uid()}@example.com`;
    const { applicationId } = await apply(w, j.slug, email);
    const app = (await getDb().prepare('SELECT candidate_id FROM hiring_applications WHERE id = ?').get(applicationId)) as { candidate_id: string };

    // Recruiter, hiring manager y admin lo ven.
    for (const a of [w.recruiter, w.manager, w.owner]) {
      expect((await listApplications(a, { jobId: j.jobId })).some((x) => x.id === applicationId)).toBe(true);
      expect(await getCandidateProfile(a, app.candidate_id)).not.toBeNull();
    }
    // Alguien fuera del equipo: nada, tampoco en Cmd+K.
    expect(await listApplications(w.outsider, { jobId: j.jobId })).toEqual([]);
    expect(await getCandidateProfile(w.outsider, app.candidate_id)).toBeNull();
    expect((await searchHiring(w.outsider, email)).filter((h) => h.kind === 'candidate')).toEqual([]);
    expect((await searchHiring(w.recruiter, email)).some((h) => h.kind === 'candidate' && h.id === app.candidate_id)).toBe(true);
    // Interviewer sin asignar: tampoco.
    expect(await getCandidateProfile(w.interviewer, app.candidate_id)).toBeNull();

    // Al entrar a la entrevista (etapa con criterios) se asigna a los interviewers: ahora sí lo ven.
    const interview = j.stages.find((s) => s.kind === 'interview')!;
    await moveApplication(w.recruiter, applicationId, interview.id);
    expect(await getCandidateProfile(w.interviewer, app.candidate_id)).not.toBeNull();
    expect((await listApplications(w.interviewer, {})).some((x) => x.id === applicationId)).toBe(true);
    // Pero no puede moverlo (no gestiona el puesto).
    await expect(moveApplication(w.interviewer, applicationId, j.stages[0].id)).rejects.toMatchObject({ code: 'forbidden' });

    // Si sale del equipo, deja de verlo.
    await setTeam(w.recruiter, j.jobId, [
      { userId: w.recruiter.person, role: 'recruiter' },
      { userId: w.manager.person, role: 'hiring_manager' },
    ]);
    expect(await getCandidateProfile(w.interviewer, app.candidate_id)).toBeNull();

    // Fuera del equipo tampoco puede borrarlo.
    await expect(deleteCandidate(w.outsider, app.candidate_id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('acceso por app: sin Hiring no hay scopes ni herramientas del asistente', () => {
    expect(canUseApp({ role: 'member', apps: '["crm"]' }, 'hiring')).toBe(false);
    expect(canUseApp({ role: 'member', apps: '["hiring"]' }, 'hiring')).toBe(true);
    expect(canUseApp({ role: 'guest', apps: '*' }, 'hiring')).toBe(false);
    expect(scopesForApps(['hiring:read', 'crm:read'], ['crm'])).toEqual(['crm:read']);
    const names = (apps: string) => toolsFor({ role: 'member', apps: apps === '*' ? '*' : JSON.parse(apps) }).map((t) => t.name);
    expect(names('["crm"]')).not.toContain('hiring_candidates');
    expect(names('["hiring"]')).toContain('hiring_candidates');
  });
});

// ---------- Scorecards ----------

describe('scorecards: nada de espiar antes de enviar el propio', () => {
  it('el interviewer ve los ajenos recién después de enviar el suyo (también en la línea de tiempo)', async () => {
    const j = await setupJob(w);
    const { applicationId } = await apply(w, j.slug, `sc-${uid()}@example.com`);
    const cand = ((await getDb().prepare('SELECT candidate_id FROM hiring_applications WHERE id = ?').get(applicationId)) as { candidate_id: string }).candidate_id;
    const interview = j.stages.find((s) => s.kind === 'interview')!;
    await moveApplication(w.recruiter, applicationId, interview.id);
    const crit = Object.fromEntries((JSON.parse((await listStages(j.jobId)).find((s) => s.id === interview.id)!.criteria) as Array<{ id: string }>).map((c) => [c.id, 3]));

    await submitScorecard(w.interviewer2, applicationId, { stageId: interview.id, ratings: crit, overall: 'strong_yes', notes: 'Great' });

    const before = (await getCandidateProfile(w.interviewer, cand))!.applications[0];
    expect(before.scorecards).toEqual([]);
    expect(before.othersHidden).toBe(1);
    expect((await getCandidateProfile(w.interviewer, cand))!.timeline.some((e) => e.kind === 'score')).toBe(false);
    // El hiring manager ve todo sin enviar.
    expect((await getCandidateProfile(w.manager, cand))!.applications[0].scorecards).toHaveLength(1);

    await submitScorecard(w.interviewer, applicationId, { stageId: interview.id, ratings: crit, overall: 'no', notes: 'Meh' });
    const after = (await getCandidateProfile(w.interviewer, cand))!.applications[0];
    expect(after.scorecards).toHaveLength(2);
    expect(after.othersHidden).toBe(0);

    // Quien no está asignado ni gestiona no puede puntuar; criterios ajenos a la etapa tampoco.
    await expect(submitScorecard(w.outsider, applicationId, { stageId: interview.id, ratings: {}, overall: 'yes', notes: '' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(submitScorecard(w.interviewer, applicationId, { stageId: interview.id, ratings: { nope: 2 }, overall: 'yes', notes: '' })).rejects.toMatchObject({ code: 'invalid_criterion' });
  });

  it('recordatorio de feedback: uno por evaluador, reclamado con compare-and-set', async () => {
    const j = await setupJob(w);
    const { applicationId } = await apply(w, j.slug, `rem-${uid()}@example.com`);
    await moveApplication(w.recruiter, applicationId, j.stages.find((s) => s.kind === 'interview')!.id);
    const later = new Date(Date.now() + 2 * 86_400_000);
    const [a, b] = await Promise.all([sendFeedbackReminders(later), sendFeedbackReminders(later)]);
    const mine = (await getDb().prepare('SELECT reminded_at FROM hiring_evaluators WHERE application_id = ?').all(applicationId)) as Array<{ reminded_at: string | null }>;
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((r) => r.reminded_at)).toBe(true);
    // Entre las dos corridas, cada evaluador de esta postulación se avisó una sola vez.
    const notes = (await getDb().prepare("SELECT COUNT(*) AS n FROM notifications WHERE source_id = ? AND body = 'scorecard'").get(applicationId)) as { n: number };
    expect(Number(notes.n)).toBe(mine.length);
    expect(a.reminded + b.reminded).toBeGreaterThanOrEqual(mine.length);
    expect((await sendFeedbackReminders(later)).reminded).toBe(0);
  });
});

// ---------- Ofertas ----------

describe('ofertas: aprobación y respuesta', () => {
  it('el recruiter la arma pero no la aprueba; se envía solo aprobada; aceptar contrata y corre onHire', async () => {
    const j = await setupJob(w);
    const { applicationId } = await apply(w, j.slug, `of-${uid()}@example.com`);
    const offer = await createOffer(w.recruiter, applicationId, { salary: 60000, currency: 'USD', startDate: '2026-12-01', templateId: null });
    expect(offer.status).toBe('pending_approval');
    expect(offer.body).toContain('Ana Pérez');

    await expect(actOnOffer(w.recruiter, offer.id, { action: 'send', templateId: null })).rejects.toMatchObject({ code: 'offer_not_approved' });
    await expect(actOnOffer(w.recruiter, offer.id, { action: 'approve', templateId: null })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(actOnOffer(w.interviewer, offer.id, { action: 'approve', templateId: null })).rejects.toMatchObject({ status: 404 });
    await expect(actOnOffer(w.outsider, offer.id, { action: 'approve', templateId: null })).rejects.toMatchObject({ status: 404 });

    const approved = await actOnOffer(w.manager, offer.id, { action: 'approve', templateId: null });
    expect(approved.offer.status).toBe('approved');
    const sent = await actOnOffer(w.recruiter, offer.id, { action: 'send', templateId: null });
    expect(sent.offer.status).toBe('sent');
    const token = sent.link!.split('/').pop()!;

    const hires: HireEvent[] = [];
    const off = registerOnHire((e) => {
      hires.push(e);
    });
    await expect(respondToOffer({ token, action: 'accept', signedName: 'Someone Else', agree: true, reason: '' }, { ip: '1.2.3.4', ua: 'test' })).rejects.toMatchObject({ code: 'name_mismatch' });
    await expect(respondToOffer({ token, action: 'accept', signedName: 'ana perez', agree: false, reason: '' }, { ip: '1.2.3.4', ua: 'test' })).rejects.toMatchObject({ code: 'agree_required' });
    expect(await respondToOffer({ token, action: 'accept', signedName: 'ana perez', agree: true, reason: '' }, { ip: '1.2.3.4', ua: 'test' })).toBe('accepted');
    off();
    // Una sola vez.
    await expect(respondToOffer({ token, action: 'decline', signedName: '', agree: false, reason: '' }, { ip: '1.2.3.4', ua: 'test' })).rejects.toMatchObject({ code: 'offer_closed' });

    const app = (await getDb().prepare('SELECT status, stage_id FROM hiring_applications WHERE id = ?').get(applicationId)) as { status: string; stage_id: string };
    expect(app.status).toBe('hired');
    expect(app.stage_id).toBe(j.stages.find((s) => s.kind === 'hired')!.id);
    expect(hires).toHaveLength(1);
    expect(hires[0]).toMatchObject({ applicationId, offer: { salary: 60000, startDate: '2026-12-01' }, candidate: { name: 'Ana Pérez' } });
    const audit = (await getDb().prepare('SELECT signed_name, signed_ip, body_hash FROM hiring_offers WHERE id = ?').get(offer.id)) as Record<string, string>;
    expect(audit.signed_name).toBe('ana perez');
    expect(audit.signed_ip).toBe('1.2.3.4');
    expect(audit.body_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('un admin puede aprobar', async () => {
    const j = await setupJob(w);
    const { applicationId } = await apply(w, j.slug, `of2-${uid()}@example.com`);
    const offer = await createOffer(w.recruiter, applicationId, { salary: null, currency: 'USD', startDate: null, templateId: null });
    expect((await actOnOffer(w.owner, offer.id, { action: 'approve', templateId: null })).offer.status).toBe('approved');
  });
});

// ---------- Retención ----------

describe('retención: borra con compare-and-set', () => {
  it('borra lo inactivo una sola vez y respeta consentimiento y contratados', async () => {
    const o = await upsertUser({ email: `ret-${uid()}@example.com`, name: 'Ret', image: null });
    await ensureWorkspace(o.id);
    const owner = { ws: o.id, person: o.id, admin: true };
    await ensureSettings(o.id);
    await updateSettings(owner, { retentionMonths: 6 });
    const job = await createJob(owner, { title: 'Ret job', description: 'x' });
    const db = getDb();
    const old = new Date(Date.now() - 400 * 86_400_000).toISOString();
    const mk = async (label: string, keep: boolean) => {
      const { candidate } = await upsertCandidate(o.id, { email: `${label}-${uid()}@example.com`, name: label, keepConsent: keep });
      await db.prepare('UPDATE hiring_candidates SET last_activity_at = ? WHERE id = ?').run(old, candidate.id);
      return candidate.id;
    };
    const stale = await mk('stale', false);
    const kept = await mk('kept', true);
    const hired = await mk('hired', false);
    const stage = (await listStages(job.job.id))[0];
    await db
      .prepare("INSERT INTO hiring_applications (id, workspace_id, job_id, candidate_id, stage_id, status, stage_changed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'hired', ?, ?, ?)")
      .run(`app_${uid()}`, o.id, job.job.id, hired, stage.id, old, old, old);
    const fresh = (await upsertCandidate(o.id, { email: `fresh-${uid()}@example.com`, name: 'fresh' })).candidate.id;

    // Otra corrida ya lo reclamó hace un instante: esta no lo toca.
    await db.prepare('UPDATE hiring_candidates SET purge_claimed_at = ? WHERE id = ?').run(new Date().toISOString(), stale);
    await purgeExpiredCandidates(new Date(), 500);
    expect(await db.prepare('SELECT 1 FROM hiring_candidates WHERE id = ?').get(stale)).toBeTruthy();

    // Un reclamo viejo (corrida caída) se puede volver a tomar; dos corridas a la vez borran una sola vez.
    await db.prepare('UPDATE hiring_candidates SET purge_claimed_at = ? WHERE id = ?').run(new Date(Date.now() - 3_600_000).toISOString(), stale);
    const [r1, r2] = await Promise.all([purgeExpiredCandidates(new Date(), 500), purgeExpiredCandidates(new Date(), 500)]);
    expect(await db.prepare('SELECT 1 FROM hiring_candidates WHERE id = ?').get(stale)).toBeFalsy();
    const mineDeleted = [r1.purged, r2.purged].reduce((s, n) => s + n, 0);
    expect(mineDeleted).toBeGreaterThanOrEqual(1);
    for (const id of [kept, hired, fresh]) expect(await db.prepare('SELECT 1 FROM hiring_candidates WHERE id = ?').get(id)).toBeTruthy();
  });

  it('el candidato borra sus datos con el token del email', async () => {
    const { candidate, forgetToken } = await upsertCandidate(w.owner.ws, { email: `forget-${uid()}@example.com`, name: 'Forget me' });
    expect(await forgetByToken('x'.repeat(30))).toBe(false);
    expect(await forgetByToken(forgetToken)).toBe(true);
    expect(await getDb().prepare('SELECT 1 FROM hiring_candidates WHERE id = ?').get(candidate.id)).toBeFalsy();
  });
});

// ---------- Respuestas por email y página pública ----------

describe('respuestas por email y página de empleos', () => {
  it('una respuesta a hire+ firmada entra a la línea de tiempo solo si la manda el candidato', async () => {
    const j = await setupJob(w);
    const email = `reply-${uid()}@example.com`;
    const { applicationId } = await apply(w, j.slug, email);
    const addr = hiringReplyAddress(applicationId)!;
    expect(parseHiringAddress([`Team <${addr}>`])).toBe(applicationId.toLowerCase());
    expect(parseHiringAddress([addr.replace(/\.[0-9a-f]{16}@/, '.0000000000000000@')])).toBeNull();
    const base = { subject: 'Re: hi', text: 'Thanks!\n\nOn Mon, someone wrote:\n> old', headers: {}, authentication: null };
    expect((await processHiringInbound(applicationId, { ...base, emailId: `e-${uid()}`, from: 'intruder@example.com' })).status).toBe('ignored');
    const id = `e-${uid()}`;
    expect((await processHiringInbound(applicationId, { ...base, emailId: id, from: `Ana <${email}>` })).status).toBe('added');
    expect((await processHiringInbound(applicationId, { ...base, emailId: id, from: email })).status).toBe('duplicate');
    const ev = (await getDb().prepare("SELECT data FROM hiring_events WHERE application_id = ? AND kind = 'email_in'").get(applicationId)) as { data: string };
    expect(JSON.parse(ev.data).body).toBe('Thanks!');
  });

  it('JobPosting sin salario si está oculto', async () => {
    const j = await setupJob(w);
    await updateJob(w.recruiter, j.jobId, { salaryMin: 50000, salaryMax: 70000, salaryPublic: false, workplace: 'remote', location: 'Argentina' });
    const c = (await publishedCareers(w.handle))!;
    const job = (await publishedJob(c.settings.workspace_id, j.slug))!;
    expect(job.salaryMin).toBeNull();
    const ld = jobPostingJsonLd(c, job, '<p>x</p>');
    expect(ld).toMatchObject({ '@type': 'JobPosting', jobLocationType: 'TELECOMMUTE' });
    expect(ld.baseSalary).toBeUndefined();
    await updateJob(w.recruiter, j.jobId, { salaryPublic: true });
    const ld2 = jobPostingJsonLd(c, (await publishedJob(c.settings.workspace_id, j.slug))!, '');
    expect(ld2.baseSalary).toMatchObject({ currency: 'USD', value: { minValue: 50000, maxValue: 70000 } });
  });
});
