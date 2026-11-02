import { createClient } from '@libsql/client';
import { describe, expect, it } from 'vitest';
import { cleanFrames, exceptionFingerprint, normalizeExceptionProps, normalizeFile, normalizeMessage, parseStack } from '@/lib/analytics/errors-core';
import { allowedByCap, specialClass } from '@/lib/analytics/ingest-special';
import { clampNumber, computeLlm, latencyMs, LLM_MAX, truthy } from '@/lib/analytics/llm-core';
import { issueRef, parseIssueRef, surveyAppearanceSchema, surveyPatchSchema, surveyQuestionSchema, vitalRating, type SurveyQuestion } from '@/lib/analytics/more-types';
import { cleanAnswer, computeQuestionResults, dayToMs, msToDay, npsFrom, parseAppearance, parseQuestions, surveyCsvRow, surveyDisplayStatus, surveyIsLive } from '@/lib/analytics/surveys-core';
import { channelSql, channelType, cleanVital, computeVitals, percentile, webFiltersSql, type ChannelInput } from '@/lib/analytics/web-core';
import { parseWebFilters } from '@/lib/analytics/web-more';

const q = (over: Partial<SurveyQuestion>): SurveyQuestion => ({ id: 'q1', type: 'open', text: 'Q', description: '', scale: 5, lowLabel: '', highLabel: '', choices: [], optional: false, ...over });

describe('encuestas: esquema', () => {
  it('colores solo #rrggbb: nada que pueda inyectar CSS', () => {
    expect(surveyAppearanceSchema.safeParse({ background: '#12abEF' }).success).toBe(true);
    for (const bad of ['red', '#fff', 'url(x)', '#12345g', '#123456;background:url(x)', '#123456\n']) {
      expect(surveyAppearanceSchema.safeParse({ background: bad }).success, bad).toBe(false);
    }
  });

  it('hasta 5 preguntas, opciones sin repetir y al menos 2', () => {
    const six = Array.from({ length: 6 }, (_, i) => q({ id: `q${i}` }));
    expect(surveyPatchSchema.safeParse({ questions: six }).success).toBe(false);
    expect(surveyPatchSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(surveyQuestionSchema.safeParse(q({ type: 'single', choices: ['a'] })).success).toBe(false);
    expect(surveyQuestionSchema.safeParse(q({ type: 'multiple', choices: ['a', 'a'] })).success).toBe(false);
    expect(surveyQuestionSchema.safeParse(q({ type: 'single', choices: ['a', 'b'] })).success).toBe(true);
    expect(surveyQuestionSchema.safeParse(q({ id: 'bad id"' })).success).toBe(false);
  });

  it('lo guardado que no pasa el esquema no llega a la UI ni al snippet', () => {
    expect(parseQuestions('not json')).toEqual([]);
    expect(parseQuestions(JSON.stringify([q({}), { id: 'x', type: 'html', text: '<b>' }]))).toHaveLength(1);
    expect(parseAppearance(JSON.stringify({ background: 'url(evil)' })).background).toBe('#ffffff');
  });
});

describe('encuestas: estado y fechas', () => {
  const NOW = Date.UTC(2026, 10, 1);
  it('running con fin vencido terminó; con inicio futuro está programada', () => {
    expect(surveyDisplayStatus({ status: 'running', startAt: null, endAt: NOW - 1 }, NOW)).toBe('ended');
    expect(surveyDisplayStatus({ status: 'running', startAt: NOW + 1, endAt: null }, NOW)).toBe('scheduled');
    expect(surveyIsLive({ status: 'running', startAt: NOW - 1, endAt: NOW + 1 }, NOW)).toBe(true);
    expect(surveyIsLive({ status: 'paused', startAt: null, endAt: null }, NOW)).toBe(false);
    expect(surveyIsLive({ status: 'draft', startAt: null, endAt: null }, NOW)).toBe(false);
  });
  it('los días van en la zona del proyecto, ida y vuelta', () => {
    const start = dayToMs('2026-11-01', -180, 'start')!;
    expect(new Date(start).toISOString()).toBe('2026-11-01T03:00:00.000Z');
    expect(msToDay(start, -180)).toBe('2026-11-01');
    expect(msToDay(dayToMs('2026-11-01', -180, 'end'), -180)).toBe('2026-11-01');
    expect(dayToMs('nope', 0, 'start')).toBeNull();
  });
});

describe('encuestas: respuestas del cliente', () => {
  it('solo pasa lo que la pregunta permite', () => {
    const rating = q({ type: 'rating', scale: 5 });
    expect(cleanAnswer(rating, 3)).toEqual({ kind: 'rating', value: 3 });
    expect(cleanAnswer(rating, '4')).toEqual({ kind: 'rating', value: 4 });
    for (const bad of [0, 6, 2.5, -1, 'x', {}, [3], true]) expect(cleanAnswer(rating, bad).kind, String(bad)).toBe('invalid');
    const single = q({ type: 'single', choices: ['a', 'b'] });
    expect(cleanAnswer(single, 'a')).toEqual({ kind: 'choices', values: ['a'] });
    expect(cleanAnswer(single, 'nope').kind).toBe('invalid');
    expect(cleanAnswer(single, ['a', 'b']).kind).toBe('invalid');
    const multi = q({ type: 'multiple', choices: ['a', 'b'] });
    expect(cleanAnswer(multi, ['a', 'b', 'a'].slice(0, 2))).toEqual({ kind: 'choices', values: ['a', 'b'] });
    expect(cleanAnswer(multi, ['a', 'x']).kind).toBe('invalid');
    expect(cleanAnswer(multi, Array(50).fill('a')).kind).toBe('invalid');
    const open = q({ type: 'open' });
    expect(cleanAnswer(open, 'x'.repeat(5000))).toEqual({ kind: 'text', value: 'x'.repeat(2000) });
    expect(cleanAnswer(open, { a: 1 }).kind).toBe('invalid');
    expect(cleanAnswer(open, '   ').kind).toBe('none');
    expect(cleanAnswer(open, undefined).kind).toBe('none');
  });

  it('NPS: 9-10 promotores, 7-8 neutros, resto detractores', () => {
    const d = Array(11).fill(0);
    d[10] = 5;
    d[9] = 1;
    d[8] = 2;
    d[1] = 2;
    expect(npsFrom(d)).toEqual({ nps: 40, promoters: 6, passives: 2, detractors: 2 });
    expect(npsFrom(Array(11).fill(0)).nps).toBeNull();
  });

  it('resultados: distribución, opciones y texto, sin contar lo inválido', () => {
    const questions = [q({ id: 'r', type: 'rating', scale: 10 }), q({ id: 'c', type: 'multiple', choices: ['a', 'b'] }), q({ id: 't', type: 'open' })];
    const rows = [
      { ts: 3, distinctId: 'u1', properties: { $survey_response_r: 10, $survey_response_c: ['a', 'b'], $survey_response_t: '<img src=x onerror=alert(1)>' } },
      { ts: 2, distinctId: 'u2', properties: { $survey_response_r: 11, $survey_response_c: ['zzz'], $survey_response_t: { evil: 1 } } },
      { ts: 1, distinctId: 'u3', properties: { $survey_response: 3, $survey_response_c: ['a'] } },
    ];
    const [r, c, t] = computeQuestionResults(questions, rows);
    if (r.type !== 'rating' || (c.type !== 'multiple' && c.type !== 'single') || t.type !== 'open') throw new Error('tipos');
    expect(r.answered).toBe(2);
    expect(r.invalid).toBe(1);
    // Escala de 10: arranca en 0, así que el puntaje es el índice.
    expect(r.distribution).toHaveLength(11);
    expect(r.distribution[10]).toBe(1);
    expect(r.distribution[3]).toBe(1);
    expect(r.nps).toBe(0);
    expect(c.choices).toEqual([{ label: 'a', count: 2 }, { label: 'b', count: 1 }]);
    expect(c.invalid).toBe(1);
    expect(t.answers.map((a) => a.text)).toEqual(['<img src=x onerror=alert(1)>']);
  });

  it('el CSV lleva valores validados', () => {
    const questions = [q({ id: 'r', type: 'rating', scale: 5 }), q({ id: 'c', type: 'multiple', choices: ['a', 'b'] })];
    expect(surveyCsvRow(questions, { ts: 0, distinctId: 'u', properties: { $survey_response_r: 99, $survey_response_c: ['a', 'b'] } })).toEqual(['1970-01-01T00:00:00.000Z', 'u', '', 'a; b']);
  });
});

describe('errores', () => {
  it('lee stacks de Chrome, Firefox y Safari', () => {
    expect(parseStack('TypeError: x\n    at foo (https://a.com/app.js:10:5)\n    at https://a.com/b.js:1:2')).toEqual([
      { function: 'foo', file: 'https://a.com/app.js', line: 10, column: 5 },
      { function: '', file: 'https://a.com/b.js', line: 1, column: 2 },
    ]);
    expect(parseStack('foo@https://a.com/app.js:10:5\n@https://a.com/b.js:1:2')).toEqual([
      { function: 'foo', file: 'https://a.com/app.js', line: 10, column: 5 },
      { function: '', file: 'https://a.com/b.js', line: 1, column: 2 },
    ]);
    expect(parseStack('at '.repeat(100000))).toEqual([]);
  });

  it('valida cuadros y corta a 30', () => {
    expect(cleanFrames([{ file: 'a.js', function: 'f', line: 1, column: '2' }, 'x', null, { nada: 1 }, { file: 'b.js', line: -1, column: 1.5 }])).toEqual([
      { file: 'a.js', function: 'f', line: 1, column: 2 },
      { file: 'b.js', function: '', line: null, column: null },
    ]);
    expect(cleanFrames(Array(100).fill({ file: 'a.js' }))).toHaveLength(30);
    expect(cleanFrames(42)).toEqual([]);
  });

  it('la misma causa da la misma huella aunque cambien ids, líneas y hash de build', () => {
    const f = (file: string, line: number) => [{ file, function: 'load', line, column: 1 }];
    const a = exceptionFingerprint('TypeError', 'Cannot read user 123 of 8f14e45f-ea2e-4d1f-8f5b-1c2d3e4f5a6b', f('https://a.com/assets/app.3f2a9c1b.js', 10));
    const b = exceptionFingerprint('TypeError', 'Cannot read user 987 of 11111111-2222-3333-4444-555555555555', f('https://a.com/assets/app.9d81e0aa.js', 99));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(exceptionFingerprint('RangeError', 'Cannot read user 1', [])).not.toBe(exceptionFingerprint('TypeError', 'Cannot read user 1', []));
    expect(normalizeMessage('At https://x.y/z?a=1 line 42')).toBe('at <url> line <n>');
    expect(normalizeFile('https://a.com/x/app-abcdef12.js?v=1')).toBe('/x/app.js');
  });

  it('la huella del cliente se ignora siempre', () => {
    const p: Record<string, unknown> = { $exception_type: 'Error', $exception_message: 'boom', $exception_stack: [], $exception_fingerprint: 'de-otro-error' };
    normalizeExceptionProps(p);
    expect(p.$exception_fingerprint).toBe(exceptionFingerprint('Error', 'boom', []));
    expect(p.$exception_fingerprint).not.toBe('de-otro-error');
  });

  it('corta textos y entiende $exception_list de posthog-js', () => {
    const p: Record<string, unknown> = { $exception_type: 'x'.repeat(500), $exception_message: 'y'.repeat(5000), $exception_stack: 'nope' };
    normalizeExceptionProps(p);
    expect((p.$exception_type as string).length).toBe(200);
    expect((p.$exception_message as string).length).toBe(1000);
    expect(p.$exception_stack).toEqual([]);
    const ph: Record<string, unknown> = {
      $exception_list: [{ type: 'TypeError', value: 'bad', stacktrace: { frames: [{ filename: 'old.js', function: 'a', lineno: 1, colno: 1 }, { filename: 'top.js', function: 'b', lineno: 2, colno: 2 }] } }],
    };
    normalizeExceptionProps(ph);
    expect(ph.$exception_type).toBe('TypeError');
    expect(ph.$exception_message).toBe('bad');
    expect((ph.$exception_stack as Array<{ file: string }>)[0].file).toBe('top.js');
    expect(ph.$exception_list).toBeUndefined();
  });

  it('la dirección de un error no acepta cualquier cosa', () => {
    const fp = 'a'.repeat(32);
    expect(parseIssueRef(issueRef('ap_x-1', fp))).toEqual({ projectId: 'ap_x-1', fingerprint: fp });
    expect(parseIssueRef(encodeURIComponent(issueRef('ap_x', fp)))).toEqual({ projectId: 'ap_x', fingerprint: fp });
    expect(parseIssueRef('ap_x')).toBeNull();
    expect(parseIssueRef(`ap_x~${'z'.repeat(32)}`)).toBeNull();
    expect(parseIssueRef(`~${fp}`)).toBeNull();
    expect(parseIssueRef('%E0%A4%A')).toBeNull();
  });
});

describe('topes diarios', () => {
  it('deja pasar hasta el tope, parcial en el borde', () => {
    expect(allowedByCap(5, 5, 100)).toBe(5);
    expect(allowedByCap(100, 5, 100)).toBe(5);
    expect(allowedByCap(103, 5, 100)).toBe(2);
    expect(allowedByCap(500, 5, 100)).toBe(0);
  });
  it('solo cuenta los eventos especiales', () => {
    expect(specialClass('$exception')).toBe('exception');
    expect(specialClass('survey sent')).toBe('survey');
    expect(specialClass('$web_vitals')).toBe('vitals');
    expect(specialClass('$ai_generation')).toBe('llm');
    expect(specialClass('$pageview')).toBeNull();
  });
});

describe('LLM', () => {
  it('convierte números, negativos a 0 y absurdos al tope', () => {
    expect(clampNumber('12', 100)).toBe(12);
    expect(clampNumber(-5, 100)).toBe(0);
    expect(clampNumber(1e30, 100)).toBe(100);
    expect(clampNumber(Infinity, 100)).toBe(100);
    for (const bad of ['abc', null, undefined, {}, [], NaN, true, '']) expect(clampNumber(bad, 100)).toBe(0);
    expect(latencyMs(1.5)).toBe(1500);
    expect(latencyMs('x')).toBeNull();
    expect(latencyMs(-1)).toBeNull();
    expect(latencyMs(1e12)).toBe(LLM_MAX.latencySec * 1000);
    expect(truthy('true')).toBe(true);
    expect(truthy(false)).toBe(false);
    expect(truthy('false')).toBe(false);
  });

  it('totales, por modelo, percentiles y por día', () => {
    const DAY = 86_400_000;
    const t0 = Date.UTC(2026, 10, 1);
    const row = (over: Record<string, unknown>) => ({ ts: t0, model: 'm1', provider: 'p', input: 10, output: 5, cost: 0.5, latency: 1, error: false, ...over });
    const r = computeLlm(
      [row({}), row({ latency: 2, cost: -3 }), row({ latency: 3, error: 'true', input: 1e30 }), row({ model: 'm2', ts: t0 + DAY, latency: 'no', cost: 'abc' }), row({ model: null, provider: null })],
      { from: t0, to: t0 + DAY },
      0,
      false,
    );
    expect(r.totals.calls).toBe(5);
    expect(r.totals.errors).toBe(1);
    expect(r.totals.inputTokens).toBe(LLM_MAX.tokens + 40);
    expect(r.totals.costUsd).toBeCloseTo(1.5);
    expect(r.models[0]).toMatchObject({ model: 'm1', calls: 3, errors: 1, p50LatencyMs: 2000, p95LatencyMs: 3000 });
    expect(r.models.find((m) => m.model === 'm2')).toMatchObject({ p50LatencyMs: null });
    expect(r.models.find((m) => m.model === '(unknown)')).toBeTruthy();
    expect(r.callsPerDay).toEqual([4, 1]);
    expect(r.buckets).toHaveLength(2);
  });
});

describe('canales', () => {
  const cases: Array<[ChannelInput, string]> = [
    [{ referringDomain: '$direct' }, 'direct'],
    [{}, 'direct'],
    [{ referringDomain: 'google.com' }, 'organic_search'],
    [{ referringDomain: 'google.com.ar' }, 'organic_search'],
    [{ referringDomain: 'bing.com' }, 'organic_search'],
    [{ referringDomain: 'cn.bing.com' }, 'organic_search'],
    [{ referringDomain: 'ar.search.yahoo.com' }, 'organic_search'],
    [{ referringDomain: 'docs.google.com' }, 'referral'],
    [{ referringDomain: 'mail.google.com' }, 'email'],
    [{ referringDomain: 'mail.yahoo.com' }, 'email'],
    [{ referringDomain: 'l.facebook.com' }, 'organic_social'],
    [{ referringDomain: 't.co' }, 'organic_social'],
    [{ referringDomain: 'notthe-x.com' }, 'referral'],
    [{ referringDomain: 'blog.example.com' }, 'referral'],
    [{ referringDomain: 'google.com', utmMedium: 'cpc' }, 'paid_search'],
    [{ utmSource: 'google', utmMedium: 'CPC' }, 'paid_search'],
    [{ utmSource: 'facebook', utmMedium: 'cpc' }, 'paid_social'],
    [{ referringDomain: 'l.instagram.com', utmMedium: 'paid' }, 'paid_social'],
    [{ utmMedium: 'paid-social' }, 'paid_social'],
    [{ referringDomain: 'google.com', url: 'https://a.com/?gclid=abc' }, 'paid_search'],
    [{ url: 'https://a.com/?ttclid=abc' }, 'paid_social'],
    [{ utmMedium: 'email', utmSource: 'mailchimp' }, 'email'],
    [{ utmSource: 'newsletter' }, 'email'],
    [{ utmMedium: 'social' }, 'organic_social'],
    [{ utmMedium: 'organic' }, 'organic_search'],
    [{ utmSource: 'partner-site' }, 'referral'],
  ];

  it.each(cases)('%j → %s', (input, want) => {
    expect(channelType(input)).toBe(want);
  });

  it('el SQL da lo mismo que la función', async () => {
    const db = createClient({ url: ':memory:' });
    await db.execute('CREATE TABLE e (referring_domain TEXT, utm_source TEXT, utm_medium TEXT, url TEXT)');
    for (const [input, want] of cases) {
      const r = await db.execute({
        sql: `SELECT ${channelSql('t')} AS c FROM (SELECT ? AS referring_domain, ? AS utm_source, ? AS utm_medium, ? AS url) t`,
        args: [input.referringDomain ?? null, input.utmSource ?? null, input.utmMedium ?? null, input.url ?? null],
      });
      expect(r.rows[0].c, JSON.stringify(input)).toBe(want);
    }
    db.close();
  });
});

describe('filtros de la página web', () => {
  it('todo valor va como parámetro; (none) es NULL', () => {
    const f = webFiltersSql([
      { key: 'path', value: "/x' OR 1=1 --" },
      { key: 'country', value: '(none)' },
    ]);
    expect(f.sql).toBe('e.pathname = ? AND e.country IS NULL');
    expect(f.args).toEqual(["/x' OR 1=1 --"]);
    expect(webFiltersSql([]).sql).toBe('');
    expect(webFiltersSql([{ key: 'channel', value: 'email' }]).sql).toContain('CASE');
  });
  it('parsea ?f= solo con claves conocidas', () => {
    expect(parseWebFilters(['path:/a:b', 'nope:x', 'device:', 'sinpuntos', 'host:a.com'])).toEqual([
      { key: 'path', value: '/a:b' },
      { key: 'host', value: 'a.com' },
    ]);
  });
});

describe('web vitals', () => {
  it('percentil y calificación', () => {
    expect(percentile([1, 2, 3, 4], 75)).toBe(3);
    expect(percentile([], 75)).toBeNull();
    expect(percentile([5], 95)).toBe(5);
    expect(vitalRating('LCP', 2500)).toBe('good');
    expect(vitalRating('LCP', 2501)).toBe('needs_improvement');
    expect(vitalRating('LCP', 4001)).toBe('poor');
    expect(vitalRating('CLS', 0.1)).toBe('good');
    expect(vitalRating('INP', 501)).toBe('poor');
  });
  it('descarta valores imposibles', () => {
    expect(cleanVital('LCP', 1000)).toBe(1000);
    expect(cleanVital('LCP', '1000')).toBe(1000);
    for (const bad of [-1, 1e9, 'x', null, undefined, NaN, Infinity, {}]) expect(cleanVital('LCP', bad)).toBeNull();
    expect(cleanVital('CLS', 51)).toBeNull();
  });
  it('p75 global y por página, con las páginas más medidas primero', () => {
    const r = computeVitals(
      [
        { path: '/a', LCP: 1000, CLS: 0.01 },
        { path: '/a', LCP: 2000 },
        { path: '/a', LCP: 3000 },
        { path: '/a', LCP: 9e9 },
        { path: '/b', LCP: 5000, INP: 600 },
        { path: '/c', LCP: 'nope' },
      ],
      false,
    );
    expect(r.samples).toBe(4);
    expect(r.metrics.find((m) => m.metric === 'LCP')).toMatchObject({ samples: 4, p75: 3000, rating: 'needs_improvement' });
    expect(r.metrics.find((m) => m.metric === 'FCP')).toMatchObject({ samples: 0, p75: null, rating: null });
    expect(r.pages.map((p) => p.path)).toEqual(['/a', '/b']);
    expect(r.pages[1].metrics.find((m) => m.metric === 'INP')).toMatchObject({ p75: 600, rating: 'poor' });
  });
});
