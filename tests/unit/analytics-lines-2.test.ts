import { describe, expect, it } from 'vitest';
import { analyticsRange } from '@/lib/analytics-kit/period';
import { aggregateForms, isFormsAnalyticsEmpty } from '@/lib/forms/analytics';
import { aggregateSend, isSendAnalyticsEmpty } from '@/lib/send/dashboard';
import { aggregateTrack, isTrackAnalyticsEmpty } from '@/lib/track-analytics';
import type { InsightIssue } from '@/lib/track-planning-core';

const now = new Date('2030-03-12T12:00:00Z');
const range = analyticsRange({ days: 7, tz: 'UTC' }, now);
const dayIdx = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

describe('Forms: analítica con el kit', () => {
  const forms = [
    { id: 'f1', name: 'Contacto', status: 'published' },
    { id: 'f2', name: 'Encuesta', status: 'published' },
    { id: 'f3', name: 'Sin uso', status: 'draft' },
  ];

  it('suma visitas, respuestas y a medias por período y por formulario', () => {
    const d = aggregateForms(
      range,
      forms,
      [
        { form_id: 'f1', cur: 1, day: dayIdx('2030-03-10'), kind: 'view', n: 10 },
        { form_id: 'f1', cur: 1, day: dayIdx('2030-03-10'), kind: 'response', n: 4 },
        { form_id: 'f1', cur: 1, day: 0, kind: 'done', n: 4 },
        { form_id: 'f2', cur: 1, day: dayIdx('2030-03-11'), kind: 'partial', n: 2 },
        { form_id: 'f2', cur: 1, day: dayIdx('2030-03-11'), kind: 'view', n: 6 },
        { form_id: 'f1', cur: 0, day: dayIdx('2030-03-02'), kind: 'response', n: 3 },
        { form_id: 'f1', cur: 0, day: dayIdx('2030-03-02'), kind: 'view', n: 8 },
        { form_id: 'f1', cur: 0, day: 0, kind: 'done', n: 2 },
      ],
      [{ wd: 6, hr: 15, n: 4 }],
    );
    expect(d.kpis.views).toEqual({ value: 16, prev: 8 });
    expect(d.kpis.responses).toEqual({ value: 4, prev: 3 });
    expect(d.kpis.partial).toEqual({ value: 2, prev: 0 });
    expect(d.kpis.completion.value).toBeCloseTo(4 / 16);
    expect(d.kpis.completion.prev).toBeCloseTo(2 / 8);
    expect(d.perDay).toHaveLength(7);
    expect(d.perDay.find((p) => p.day === '2030-03-10')).toMatchObject({ views: 10, responses: 4 });
    // Sin actividad, el formulario no aparece en la tabla; con respuestas, va primero.
    expect(d.forms.map((f) => f.id)).toEqual(['f1', 'f2']);
    expect(d.forms[0]).toMatchObject({ completedViews: 4, prevResponses: 3 });
    expect(d.heat[6][15]).toBe(4);
    expect(d.formCount).toBe(3);
    expect(isFormsAnalyticsEmpty(d)).toBe(false);
  });

  it('sin formularios o sin nada en los dos períodos, está vacío', () => {
    expect(isFormsAnalyticsEmpty(aggregateForms(range, [], [], []))).toBe(true);
    expect(isFormsAnalyticsEmpty(aggregateForms(range, forms, [], []))).toBe(true);
  });
});

describe('Send: analítica con el kit', () => {
  const docs = [
    { id: 'd1', title: 'Propuesta' },
    { id: 'd2', title: 'Deck' },
  ];

  it('suma visitas, tiempo, lectura y descargas; personas por período y por documento', () => {
    const d = aggregateSend(
      range,
      docs,
      [
        { document_id: 'd1', cur: 1, day: dayIdx('2030-03-11'), visits: 3, seconds: 180, downloads: 1, done_sum: 2.5, done_n: 3 },
        { document_id: 'd2', cur: 1, day: dayIdx('2030-03-12'), visits: 1, seconds: 60, downloads: 0, done_sum: 0, done_n: 0 },
        { document_id: 'd1', cur: 0, day: dayIdx('2030-03-01'), visits: 2, seconds: 30, downloads: 0, done_sum: 1, done_n: 2 },
      ],
      [
        { document_id: null, cur: 1, n: 3 },
        { document_id: null, cur: 0, n: 2 },
        { document_id: 'd1', cur: 1, n: 2 },
      ],
      { countries: [{ name: 'AR', n: 3 }, { name: null, n: 1 }], devices: [{ name: 'desktop', n: 4 }] },
      [{ wd: 2, hr: 9, n: 4 }],
    );
    expect(d.kpis.visits).toEqual({ value: 4, prev: 2 });
    expect(d.kpis.viewers).toEqual({ value: 3, prev: 2 });
    expect(d.kpis.avgSeconds).toEqual({ value: 60, prev: 15 });
    expect(d.kpis.completion.value).toBeCloseTo(2.5 / 3);
    expect(d.kpis.downloads).toEqual({ value: 1, prev: 0 });
    expect(d.docs.map((x) => x.id)).toEqual(['d1', 'd2']);
    expect(d.docs[0]).toMatchObject({ viewers: 2, prevVisits: 2, visits: 3 });
    expect(d.docs[1].completion).toBeNull();
    // Un país sin dato no suma una barra sin nombre.
    expect(d.countries).toEqual([{ name: 'AR', count: 3 }]);
    expect(d.perDay.find((p) => p.day === '2030-03-11')).toMatchObject({ visits: 3, minutes: 3 });
    expect(d.heat[2][9]).toBe(4);
    expect(isSendAnalyticsEmpty({ ...d, docCount: 2, docList: docs })).toBe(false);
    expect(isSendAnalyticsEmpty({ ...aggregateSend(range, docs, [], [], { countries: [], devices: [] }, []), docCount: 2, docList: docs })).toBe(true);
  });
});

describe('Track: analítica con el kit', () => {
  const issue = (over: Partial<InsightIssue>): InsightIssue => ({
    id: crypto.randomUUID(),
    identifier: 'ENG-1',
    title: 'Algo',
    projectId: 't1',
    projectName: 'Engineering',
    statusName: 'Todo',
    category: 'todo',
    priority: 'medium',
    assigneeId: 'u1',
    assigneeName: 'Ana',
    labels: [],
    planId: null,
    planName: null,
    cycleId: null,
    cycleName: null,
    estimate: null,
    createdAt: '2030-03-10T10:00:00.000Z',
    startedAt: null,
    completedAt: null,
    ...over,
  });

  it('cuenta creados y terminados por período, medianas de ciclo y total, y abiertos ahora', () => {
    const issues = [
      issue({}),
      issue({ category: 'done', startedAt: '2030-03-10T12:00:00.000Z', completedAt: '2030-03-11T12:00:00.000Z' }),
      issue({ category: 'done', projectId: 't2', projectName: 'Design', assigneeId: null, assigneeName: null, createdAt: '2030-02-01T00:00:00.000Z', completedAt: '2030-03-03T00:00:00.000Z' }),
      issue({ category: 'cancelled', createdAt: '2030-03-04T00:00:00.000Z' }),
    ];
    const d = aggregateTrack(range, issues);
    expect(d.kpis.created).toEqual({ value: 2, prev: 1 });
    expect(d.kpis.completed).toEqual({ value: 1, prev: 1 });
    expect(d.kpis.cycleMin.value).toBe(24 * 60);
    expect(d.kpis.leadMin.value).toBe(26 * 60);
    expect(d.kpis.open).toEqual({ value: 1 });
    expect(d.teams[0]).toMatchObject({ id: 't1', completed: 1, created: 2, open: 1 });
    expect(d.people.find((p) => p.id === '')).toMatchObject({ prevCompleted: 1 });
    // 2030-03-11 fue lunes: fila 0, hora 12 (UTC).
    expect(d.heat[0][12]).toBe(1);
    expect(d.teamList.map((x) => x.name)).toEqual(['Design', 'Engineering']);
    // Filtro por equipo: solo sus issues; la lista de equipos sigue completa.
    const t2 = aggregateTrack(range, issues, 't2');
    expect(t2.kpis.completed).toEqual({ value: 0, prev: 1 });
    expect(t2.teamList).toHaveLength(2);
    expect(isTrackAnalyticsEmpty(aggregateTrack(range, []))).toBe(true);
  });
});
