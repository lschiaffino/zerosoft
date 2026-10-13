import { describe, expect, it } from 'vitest';
import { isValidCron, nextCronRun, nextCronRuns, parseCron } from '@/lib/cron';
import { computeNextRun } from '@/lib/flow';
import { validateGraph } from '@/lib/flow-schema';
import { robotScheduleSchema } from '@/lib/robots-schema';

const at = (iso: string) => new Date(iso);

describe('cron: parser', () => {
  it('acepta campos, listas, rangos, pasos, nombres y atajos', () => {
    const p = parseCron('*/15 9-17 * JAN,mar MON-FRI');
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.schedule.minutes).toEqual([0, 15, 30, 45]);
    expect(p.schedule.hours).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
    expect(p.schedule.months).toEqual([1, 3]);
    expect(p.schedule.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron('0 0 * * 7').ok && (parseCron('0 0 * * 7') as { schedule: { weekdays: number[] } }).schedule.weekdays).toEqual([0]);
    expect(parseCron('5/20 * * * *').ok && (parseCron('5/20 * * * *') as { schedule: { minutes: number[] } }).schedule.minutes).toEqual([5, 25, 45]);
    expect(isValidCron('@daily')).toBe(true);
    expect(isValidCron('@hourly')).toBe(true);
  });

  it('rechaza expresiones inválidas', () => {
    for (const bad of ['', '* * * *', '60 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '5-1 * * * *', '*/0 * * * *', 'a b c d e', '* * * * * *']) {
      expect(isValidCron(bad)).toBe(false);
    }
  });
});

describe('cron: próxima corrida', () => {
  it('calcula en UTC y avanza al minuto siguiente', () => {
    expect(nextCronRun('0 9 * * *', 'UTC', at('2026-03-10T08:59:30Z'))?.toISOString()).toBe('2026-03-10T09:00:00.000Z');
    expect(nextCronRun('0 9 * * *', 'UTC', at('2026-03-10T09:00:00Z'))?.toISOString()).toBe('2026-03-11T09:00:00.000Z');
    expect(nextCronRun('*/15 * * * *', 'UTC', at('2026-03-10T10:07:00Z'))?.toISOString()).toBe('2026-03-10T10:15:00.000Z');
    // Lunes a viernes: desde un sábado salta al lunes.
    expect(nextCronRun('30 8 * * 1-5', 'UTC', at('2026-03-14T12:00:00Z'))?.toISOString()).toBe('2026-03-16T08:30:00.000Z');
    // Fin de mes / año.
    expect(nextCronRun('0 0 1 1 *', 'UTC', at('2026-12-31T23:59:00Z'))?.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('respeta la zona horaria (y el cambio de horario)', () => {
    // Buenos Aires = UTC-3.
    expect(nextCronRun('0 9 * * *', 'America/Argentina/Buenos_Aires', at('2026-03-10T10:00:00Z'))?.toISOString()).toBe(
      '2026-03-10T12:00:00.000Z',
    );
    // Nueva York pasa a horario de verano el 8/3/2026: 9:00 local = 14:00Z antes, 13:00Z después.
    const runs = nextCronRuns('0 9 * * *', 'America/New_York', 2, at('2026-03-07T00:00:00Z')).map((d) => d.toISOString());
    expect(runs).toEqual(['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z']);
  });

  it('día del mes y día de la semana: alcanza con uno (como Vixie cron)', () => {
    // Día 13 o viernes: desde el jueves 12/3/2026 → viernes 13.
    expect(nextCronRun('0 0 13 * 5', 'UTC', at('2026-03-11T00:00:00Z'))?.toISOString()).toBe('2026-03-13T00:00:00.000Z');
    expect(nextCronRun('0 0 31 2 *', 'UTC', at('2026-01-01T00:00:00Z'))).toBeNull();
  });

  it('Flow y Robots usan el mismo parser', () => {
    const from = at('2026-03-10T12:00:00Z');
    expect(computeNextRun({ mode: 'cron', cron: '0 */6 * * *', timezone: 'UTC' }, from).toISOString()).toBe('2026-03-10T18:00:00.000Z');
    const graph = (cron: string, timezone = 'UTC') => ({
      nodes: [{ id: 't', type: 'trigger.schedule', position: { x: 0, y: 0 }, config: { mode: 'cron', cron, timezone } }],
      edges: [],
    });
    expect(validateGraph(graph('0 9 * * 1-5'))).toMatchObject({ ok: true });
    expect(validateGraph(graph('0 25 * * *'))).toMatchObject({ ok: false, error: 'invalid_cron' });
    expect(validateGraph(graph('0 9 * * *', 'Mars/Base'))).toMatchObject({ ok: false, error: 'invalid_timezone' });
    expect(robotScheduleSchema.safeParse({ mode: 'cron', cron: '*/30 * * * *', timezone: 'UTC' }).success).toBe(true);
    expect(robotScheduleSchema.safeParse({ mode: 'cron', cron: 'nope', timezone: 'UTC' }).success).toBe(false);
  });
});
