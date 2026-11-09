import { beforeAll, describe, expect, it } from 'vitest';
import { getDb, upsertUser } from '@/lib/db';
import { runAnalyticsCron } from '@/lib/analytics/cron';
import { issueDetail, listIssues, runErrorRegressions, updateIssue } from '@/lib/analytics/errors';
import { storeEvents } from '@/lib/analytics/ingest';
import { capSpecialEvents, DAILY_CAPS } from '@/lib/analytics/ingest-special';
import type { CleanEvent } from '@/lib/analytics/ingest-core';
import { llmOverview, llmTraces } from '@/lib/analytics/llm';
import { createProject, deleteProject, toProjectDto, updateProject, type ProjectRow } from '@/lib/analytics/projects';
import { runWeb } from '@/lib/analytics/query';
import { createSurvey, forgetSurveysCache, getSurvey, hasLivePopover, listSurveys, surveyResults, surveysFor, updateSurvey } from '@/lib/analytics/surveys';
import { createFlag } from '@/lib/analytics/records';
import { defaultAppearance } from '@/lib/analytics/surveys-core';
import { webVitals, liveVisitors } from '@/lib/analytics/web-more';

const OWNER = 'anm-owner';
let project: ProjectRow;
let n = 0;

const ev = (event: string, distinctId: string, properties: Record<string, unknown>, agoMs = 1000): CleanEvent => ({
  event,
  distinctId,
  properties,
  ts: Date.now() - agoMs,
  uuid: `anm-${Date.now()}-${n++}`,
  set: null,
  setOnce: null,
});

beforeAll(async () => {
  await upsertUser({ id: OWNER, email: 'anm-owner@test.local', name: 'Owner' });
  project = await createProject(OWNER, OWNER, 'More');
});

describe('ajustes nuevos', () => {
  it('apagados por defecto y se prenden por proyecto', async () => {
    expect(toProjectDto(project)).toMatchObject({ captureExceptions: false, webVitals: false });
    const p = await updateProject(OWNER, project.id, { captureExceptions: true, webVitals: true });
    expect(toProjectDto(p!)).toMatchObject({ captureExceptions: true, webVitals: true });
    await updateProject(OWNER, project.id, { captureExceptions: false, webVitals: false });
  });
});

describe('encuestas', () => {
  it('borrador no se ofrece; al aire sí, y un sitio sin encuestas no pide nada', async () => {
    const s = await createSurvey(project.id, OWNER, { name: 'S1' });
    expect(await hasLivePopover(project.id)).toBe(false);
    expect(await surveysFor(project.id, 'u1')).toEqual([]);
    await updateSurvey(project.id, s.id, { status: 'running' });
    expect(await hasLivePopover(project.id)).toBe(true);
    const list = await surveysFor(project.id, 'u1');
    expect(list.map((x) => x.id)).toEqual([s.id]);
    expect(list[0]).not.toHaveProperty('name');
    expect(list[0]).not.toHaveProperty('targeting');
    await updateSurvey(project.id, s.id, { status: 'paused' });
    expect(await hasLivePopover(project.id)).toBe(false);
    // Fin vencido: fuera aunque siga "running".
    await updateSurvey(project.id, s.id, { status: 'running', endAt: Date.now() - 1000 });
    expect(await hasLivePopover(project.id)).toBe(false);
    await updateSurvey(project.id, s.id, { status: 'ended', endAt: null });
  });

  it('flag, propiedad de la persona y muestreo se resuelven en el servidor', async () => {
    const p = await createProject(OWNER, OWNER, 'Targeting');
    await storeEvents(p, [{ ...ev('$set', 'pro-user', {}), set: { plan: 'pro' } }], null);
    await createFlag(p.id, OWNER, { key: 'beta', name: '', active: true, rollout: 100, variants: [], conditions: [{ key: 'plan', op: 'eq', value: 'pro', type: 'person' }] });
    const s = await createSurvey(p.id, OWNER, { name: 'T' });
    const base = { urlContains: '', flagKey: null, personFilter: null, showOnce: true, delaySeconds: 0, sampling: 100 };
    await updateSurvey(p.id, s.id, { status: 'running', targeting: { ...base, personFilter: { key: 'plan', op: 'eq', value: 'pro' } } });
    expect(await surveysFor(p.id, 'pro-user')).toHaveLength(1);
    expect(await surveysFor(p.id, 'stranger')).toHaveLength(0);
    await updateSurvey(p.id, s.id, { targeting: { ...base, flagKey: 'beta' } });
    expect(await surveysFor(p.id, 'pro-user')).toHaveLength(1);
    expect(await surveysFor(p.id, 'stranger')).toHaveLength(0);
    await updateSurvey(p.id, s.id, { targeting: { ...base, sampling: 50 } });
    const seen = await Promise.all(Array.from({ length: 200 }, (_, i) => surveysFor(p.id, `u${i}`)));
    const yes = seen.filter((x) => x.length).length;
    expect(yes).toBeGreaterThan(60);
    expect(yes).toBeLessThan(140);
    // La misma persona siempre del mismo lado.
    expect((await surveysFor(p.id, 'u3')).length).toBe(seen[3].length);
  });

  it('resultados y cuenta de la lista salen de los eventos, validados', async () => {
    const s = await createSurvey(project.id, OWNER, { name: 'R' });
    const qid = s.questions[0].id;
    await storeEvents(
      project,
      [
        ev('survey shown', 'a', { $survey_id: s.id }),
        ev('survey shown', 'b', { $survey_id: s.id }),
        ev('survey dismissed', 'b', { $survey_id: s.id }),
        ev('survey sent', 'a', { $survey_id: s.id, [`$survey_response_${qid}`]: 10 }),
        ev('survey sent', 'evil', { $survey_id: s.id, [`$survey_response_${qid}`]: 999 }),
        ev('survey sent', 'z', { $survey_id: 'otra', [`$survey_response_${qid}`]: 1 }),
      ],
      null,
    );
    const r = await surveyResults(project, (await getSurvey(project.id, s.id))!, { from: '-7d' });
    expect(r).toMatchObject({ shown: 2, dismissed: 1, sent: 2 });
    const q = r.questions[0];
    expect(q.answered).toBe(1);
    expect(q.invalid).toBe(1);
    if (q.type === 'rating') expect(q.nps).toBe(100);
    expect((await listSurveys(project.id)).find((x) => x.id === s.id)?.responses).toBe(2);
  });

  it('otro proyecto no ve la encuesta', async () => {
    const s = await createSurvey(project.id, OWNER, { name: 'Mine' });
    const other = await createProject(OWNER, OWNER, 'Other');
    expect(await getSurvey(other.id, s.id)).toBeNull();
    expect(await updateSurvey(other.id, s.id, { name: 'Hack' })).toBeNull();
    expect((await getSurvey(project.id, s.id))?.name).toBe('Mine');
    forgetSurveysCache();
  });

  it('no guarda un color que no sea hexadecimal', async () => {
    const s = await createSurvey(project.id, OWNER, { name: 'C' });
    await expect(updateSurvey(project.id, s.id, { appearance: { ...defaultAppearance(), background: 'url(x)' } })).rejects.toThrow();
  });
});

describe('errores', () => {
  const exc = (who: string, msg: string, agoMs = 1000, extra: Record<string, unknown> = {}) =>
    ev('$exception', who, { $exception_type: 'TypeError', $exception_message: msg, $exception_stack: [{ file: 'https://a.test/app.js', function: 'load', line: 1, column: 1 }], $exception_fingerprint: 'mentira', ...extra }, agoMs);

  it('agrupa con la huella del servidor', async () => {
    const p = await createProject(OWNER, OWNER, 'Errs');
    await storeEvents(p, [exc('a', 'Bad id 1'), exc('b', 'Bad id 2'), exc('b', 'Bad id 3'), ev('$exception', 'c', { $exception_type: 'RangeError', $exception_message: 'other' })], null);
    const { issues } = await listIssues(p, { from: '-7d' });
    expect(issues).toHaveLength(2);
    const main = issues.find((i) => i.type === 'TypeError')!;
    expect(main).toMatchObject({ occurrences: 3, people: 2, status: 'open' });
    expect(main.fingerprint).toMatch(/^[0-9a-f]{32}$/);
    expect(main.spark.reduce((a, b) => a + b, 0)).toBe(3);
    const d = await issueDetail(p, main.fingerprint, { from: '-7d' });
    expect(d).toMatchObject({ occurrences: 3, people: 2 });
    expect(d?.frames[0]).toMatchObject({ function: 'load' });
    expect(d?.topPeople).toHaveLength(2);
    expect(d?.series.reduce((a, b) => a + b, 0)).toBe(3);
    // Búsqueda y estado.
    expect((await listIssues(p, { q: 'other' })).issues).toHaveLength(1);
    await updateIssue(p, main.fingerprint, { status: 'ignored' });
    expect((await listIssues(p, {})).issues.map((i) => i.type)).toEqual(['RangeError']);
    expect((await listIssues(p, { status: 'ignored' })).issues).toHaveLength(1);
  });

  it('un resuelto que vuelve es regresión, el cron avisa una sola vez al responsable', async () => {
    const member = 'anm-member';
    await upsertUser({ id: member, email: 'anm-member@test.local', name: 'Member' });
    const p = await createProject(OWNER, OWNER, 'Regress');
    await storeEvents(p, [exc('a', 'Boom 1', 60 * 60_000)], null);
    const fp = (await listIssues(p, {})).issues[0].fingerprint;
    await updateIssue(p, fp, { status: 'resolved', assigneeId: OWNER });
    expect((await listIssues(p, { status: 'resolved' })).issues).toHaveLength(1);
    const now = Date.now();
    let run = await runErrorRegressions({ left: () => 5000, now });
    expect(run.regressions).toBe(0);

    // Una aparición más nueva: regresión al leer, aun sin cron.
    await new Promise((r) => setTimeout(r, 5));
    await storeEvents(p, [exc('b', 'Boom 2', 0)], null);
    await new Promise((r) => setTimeout(r, 5));
    expect((await listIssues(p, {})).issues[0].status).toBe('regression');

    // El claim de checked_at evita volver a mirar enseguida; más tarde, sí.
    run = await runErrorRegressions({ left: () => 5000, now: now + 1000 });
    expect(run.regressions).toBe(0);
    await getDb().prepare('UPDATE analytics_error_issues SET checked_at = NULL WHERE project_id = ?').run(p.id);
    run = await runErrorRegressions({ left: () => 5000, now: now + 2000 });
    expect(run.regressions).toBe(1);
    const stored = (await getDb().prepare('SELECT status, regressed_at FROM analytics_error_issues WHERE project_id = ?').get(p.id)) as { status: string; regressed_at: number };
    expect(stored.status).toBe('regression');
    const notif = (await getDb().prepare(`SELECT * FROM notifications WHERE user_id = ? AND type = 'analytics_regression' AND source_id = ?`).all(OWNER, `${p.id}:${fp}`)) as Array<{ title: string; href: string }>;
    expect(notif).toHaveLength(1);
    expect(notif[0].title).toContain('TypeError');
    expect(notif[0].href).toBe(`/app/pulse/errors/${p.id}~${fp}`);
    // Otra corrida no repite.
    await getDb().prepare('UPDATE analytics_error_issues SET checked_at = NULL WHERE project_id = ?').run(p.id);
    await runErrorRegressions({ left: () => 5000, now: now + 3000 });
    expect(((await getDb().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE source_id = ?`).get(`${p.id}:${fp}`)) as { n: number }).n).toBe(1);
  });

  it('sin presupuesto no hace nada, y un responsable que ya no está no recibe aviso', async () => {
    const p = await createProject(OWNER, OWNER, 'Budget');
    await storeEvents(p, [exc('a', 'Gone 1', 60 * 60_000)], null);
    const fp = (await listIssues(p, {})).issues[0].fingerprint;
    await updateIssue(p, fp, { status: 'resolved', assigneeId: 'anm-left' });
    await storeEvents(p, [{ ...exc('b', 'Gone 2', 0), ts: Date.now() + 5 }], null);
    const stop = await runErrorRegressions({ left: () => 0, now: Date.now() });
    expect(stop.checked).toBe(0);
    const run = await runErrorRegressions({ left: () => 5000, now: Date.now() });
    expect(run.regressions).toBeGreaterThanOrEqual(1);
    expect(((await getDb().prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'anm-left'`).get()) as { n: number }).n).toBe(0);
  });

  it('el cron purga encuestas y errores de un proyecto borrado', async () => {
    const p = await createProject(OWNER, OWNER, 'Purge');
    await createSurvey(p.id, OWNER, { name: 'X' });
    await storeEvents(p, [exc('a', 'x')], null);
    const fp = (await listIssues(p, {})).issues[0].fingerprint;
    await updateIssue(p, fp, { status: 'ignored' });
    await deleteProject(OWNER, p.id);
    await runAnalyticsCron({ budgetMs: 20_000 });
    for (const table of ['analytics_surveys', 'analytics_error_issues']) {
      const r = (await getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ?`).get(p.id)) as { n: number };
      expect(Number(r.n), table).toBe(0);
    }
  });
});

describe('tope diario', () => {
  it('corta los eventos especiales de más y deja pasar el resto', async () => {
    const p = await createProject(OWNER, OWNER, 'Caps');
    const day = Math.floor(Date.now() / 86_400_000) * 86_400_000;
    await getDb().prepare('INSERT INTO rate_limits (key, window_start, count, expires_at) VALUES (?, ?, ?, ?)').run(`adaily:exception:${p.id}`, day, DAILY_CAPS.exception - 1, day + 86_400_000);
    const kept = await capSpecialEvents(p.id, [ev('$exception', 'a', {}), ev('$exception', 'a', {}), ev('$pageview', 'a', {}), ev('$ai_generation', 'a', {})]);
    expect(kept.map((e) => e.event)).toEqual(['$exception', '$pageview', '$ai_generation']);
  });
});

describe('LLM', () => {
  it('limpia lo que informa el cliente', async () => {
    const p = await createProject(OWNER, OWNER, 'Llm');
    await storeEvents(
      p,
      [
        ev('$ai_generation', 'a', { $ai_model: 'm', $ai_input_tokens: 10, $ai_output_tokens: 5, $ai_total_cost_usd: 1, $ai_latency: 2, $ai_trace_id: 't' }),
        ev('$ai_generation', 'a', { $ai_model: 'm', $ai_input_tokens: -10, $ai_output_tokens: 'x', $ai_total_cost_usd: 1e30, $ai_is_error: true, $ai_trace_id: 't' }),
      ],
      null,
    );
    const o = await llmOverview(p, { from: '-7d' });
    expect(o.totals).toMatchObject({ calls: 2, inputTokens: 10, outputTokens: 5, costUsd: 1001, errors: 1 });
    const t = await llmTraces(p, { from: '-7d' });
    expect(t[0]).toMatchObject({ traceId: 't', generations: 2, inputTokens: 10, outputTokens: 5, costUsd: 1001, errors: 1 });
  });
});

describe('web', () => {
  it('filtros y canales en runWeb; sesiones filtradas también', async () => {
    const p = await createProject(OWNER, OWNER, 'Web');
    const pv = (who: string, path: string, props: Record<string, unknown>) => ev('$pageview', who, { $session_id: `s-${who}`, $pathname: path, $current_url: `https://a.test${path}`, $host: 'a.test', ...props });
    await storeEvents(
      p,
      [
        pv('a', '/x', { $referrer: 'https://google.com/', $referring_domain: 'google.com' }),
        pv('b', '/x', { utm_medium: 'email', $referrer: '$direct', $referring_domain: '$direct' }),
        pv('c', '/y', { $referrer: '$direct', $referring_domain: '$direct' }),
      ],
      null,
    );
    const all = await runWeb(p, { kind: 'web', dateRange: { from: '-7d' }, compare: false });
    expect(all.stats.visitors.value).toBe(3);
    expect(Object.fromEntries(all.channels.map((c) => [c.key, c.visitors]))).toEqual({ organic_search: 1, email: 1, direct: 1 });
    expect(all.hosts[0].key).toBe('a.test');
    expect(all.hasPageviews).toBe(true);
    const byPath = await runWeb(p, { kind: 'web', dateRange: { from: '-7d' }, compare: true, filters: [{ key: 'path', value: '/x' }] });
    expect(byPath.stats.visitors.value).toBe(2);
    expect(byPath.stats.sessions.value).toBe(2);
    expect(byPath.pages.map((x) => x.key)).toEqual(['/x']);
    const both = await runWeb(p, { kind: 'web', dateRange: { from: '-7d' }, compare: false, filters: [{ key: 'path', value: '/x' }, { key: 'channel', value: 'email' }] });
    expect(both.stats.visitors.value).toBe(1);
    const none = await runWeb(p, { kind: 'web', dateRange: { from: '-7d' }, compare: false, filters: [{ key: 'country', value: "x' OR 1=1 --" }] });
    expect(none.stats.pageviews.value).toBe(0);
    expect(none.hasPageviews).toBe(true);
    const empty = await createProject(OWNER, OWNER, 'Empty');
    expect((await runWeb(empty, { kind: 'web', dateRange: { from: '-7d' }, compare: false })).hasPageviews).toBe(false);
  });

  it('en vivo: personas de los últimos 5 minutos', async () => {
    const p = await createProject(OWNER, OWNER, 'Live');
    await storeEvents(p, [ev('$pageview', 'a', {}), ev('$pageview', 'a', {}), ev('x', 'b', {}), ev('$pageview', 'old', {}, 10 * 60_000)], null);
    expect(await liveVisitors(p)).toBe(2);
  });

  it('vitals: p75 acotado y números imposibles fuera', async () => {
    const p = await createProject(OWNER, OWNER, 'Vitals');
    await storeEvents(
      p,
      [
        ev('$web_vitals', 'a', { $pathname: '/a', $web_vitals_LCP_value: 1000 }),
        ev('$web_vitals', 'b', { $pathname: '/a', $web_vitals_LCP_value: 5000 }),
        ev('$web_vitals', 'c', { $pathname: '/b', $web_vitals_LCP_value: 9e12, $web_vitals_CLS_value: -1 }),
      ],
      null,
    );
    const v = await webVitals(p, { from: '-7d' });
    expect(v.metrics.find((m) => m.metric === 'LCP')).toMatchObject({ samples: 2, p75: 5000, rating: 'poor' });
    expect(v.pages.map((x) => x.path)).toEqual(['/a']);
    const filtered = await webVitals(p, { from: '-7d', filters: [{ key: 'path', value: '/zzz' }] });
    expect(filtered.samples).toBe(0);
  });
});
