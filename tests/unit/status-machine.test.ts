import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, OPEN_AFTER, RESOLVE_AFTER, step, worstStatus, type MachineState } from '@/lib/status/machine';
import type { ComponentStatus } from '@/lib/status/components';
import { dayBars, overallStatus, uptimePct } from '@/lib/status/view';
import { addMinute, diskStatusFromMetrics } from '@/lib/status/store';
import { publicText, redactSecrets } from '@/lib/status/redact';
import { isQuotaError } from '@/lib/status/checks';

function run(results: ComponentStatus[], from: MachineState = INITIAL_STATE) {
  let s = from;
  const events: string[] = [];
  for (const r of results) {
    const out = step(s, r);
    s = out.next;
    events.push(...out.events.map((e) => (e.type === 'open' ? `open:${e.severity}` : e.type === 'change' ? `change:${e.to}` : e.type)));
  }
  return { state: s, events };
}

describe('status: máquina de estados', () => {
  it('abre después de 2 fallas seguidas y no con una', () => {
    expect(OPEN_AFTER).toBe(2);
    expect(run(['down']).events).toEqual([]);
    expect(run(['down', 'down']).events).toEqual(['open:down']);
    expect(run(['down', 'down']).state.incident).toBe('down');
  });

  it('flapping (falla, pasa, falla, pasa) nunca abre', () => {
    const r = run(['down', 'up', 'down', 'up', 'degraded', 'up', 'down', 'up']);
    expect(r.events).toEqual([]);
    expect(r.state.incident).toBeNull();
  });

  it('resuelve con 3 pasadas seguidas; una falla en el medio reinicia la cuenta', () => {
    expect(RESOLVE_AFTER).toBe(3);
    const open = run(['down', 'down']).state;
    expect(run(['up', 'up'], open).state.incident).toBe('down');
    expect(run(['up', 'up', 'up'], open).events).toEqual(['resolve']);
    const r = run(['up', 'up', 'down', 'up', 'up'], open);
    expect(r.state.incident).toBe('down');
    expect(r.events).toEqual(['fail']);
    expect(run(['up'], r.state).events).toEqual(['resolve']);
  });

  it('con el incidente abierto, cada falla se cuenta y empeorar se anota una vez', () => {
    const r = run(['degraded', 'degraded', 'degraded', 'down', 'down', 'degraded']);
    expect(r.events).toEqual(['open:degraded', 'fail', 'fail', 'change:down', 'fail', 'fail']);
    expect(r.state.incident).toBe('down');
  });

  it('unknown (el watcher dejó de reportar) abre su propio incidente y pasa a medido cuando vuelve con datos', () => {
    const r = run(['unknown', 'unknown']);
    expect(r.events).toEqual(['open:unknown']);
    const back = run(['down'], r.state);
    expect(back.events).toEqual(['fail', 'change:down']);
    expect(run(['up', 'up', 'up'], r.state).events).toEqual(['resolve']);
  });

  it('el peor estado ignora unknown si hay algo medido', () => {
    expect(worstStatus(['up', 'unknown'])).toBe('up');
    expect(worstStatus(['up', 'degraded', 'down'])).toBe('down');
    expect(worstStatus(['unknown', 'unknown'])).toBe('unknown');
    expect(overallStatus(['up', 'degraded'])).toBe('degraded');
    expect(overallStatus(['unknown', 'unknown'])).toBe('unknown');
    expect(overallStatus(['up', 'unknown'])).toBe('up');
  });
});

describe('status: barras y disponibilidad', () => {
  it('90 barras terminando hoy, con el tono del peor minuto del día', () => {
    let days = addMinute([], 100, 'up');
    days = addMinute(days, 100, 'down');
    days = addMinute(days, 99, 'degraded');
    days = addMinute(days, 99, 'unknown');
    const bars = dayBars(days, 100);
    expect(bars).toHaveLength(90);
    expect(bars.at(-1)).toMatchObject({ day: 100, tone: 'down', up: 1, down: 1 });
    expect(bars.at(-2)).toMatchObject({ day: 99, tone: 'degraded', degraded: 1 });
    expect(bars[0].tone).toBe('none');
    expect(uptimePct(bars)).toBe(66.66);
    expect(uptimePct(dayBars([], 100))).toBeNull();
  });

  it('los días de más de 90 se descartan', () => {
    let days = addMinute([], 1, 'up');
    days = addMinute(days, 200, 'up');
    expect(days.map((d) => d[0])).toEqual([200]);
  });

  it('el disco: 90 % degraded, 97 % down, aunque el watcher diga up', () => {
    expect(diskStatusFromMetrics({ volumeUsedMB: 300, volumeSizeMB: 500 })).toBe('up');
    expect(diskStatusFromMetrics({ volumeUsedMB: 455, volumeSizeMB: 500 })).toBe('degraded');
    expect(diskStatusFromMetrics({ volumeUsedMB: 499, volumeSizeMB: 500 })).toBe('down');
    expect(diskStatusFromMetrics({ volumeUsedMB: 1, volumeSizeMB: 0 })).toBeNull();
    expect(diskStatusFromMetrics(undefined)).toBeNull();
  });
});

describe('status: textos', () => {
  it('saca secretos de los errores internos', () => {
    process.env.GROUPS_BRIDGE_KEY = 'super-secret-bridge-key-123';
    const s = redactSecrets('fetch https://evo.example.app/x?apikey=super-secret-bridge-key-123 failed; Authorization: Bearer abcdef123456');
    expect(s).not.toContain('super-secret-bridge-key-123');
    expect(s).not.toContain('abcdef123456');
    delete process.env.GROUPS_BRIDGE_KEY;
  });

  it('lo público no lleva URLs, hosts, IPs, emails ni números largos', () => {
    const s = publicText('Postgres at evolution-db.railway.internal:5432 (10.0.0.12) for +54 9 11 5555-1234, see https://railway.app/project/abc and mail ops@zerosoft.ai. zerosoft.ai is fine.');
    expect(s).not.toMatch(/railway|10\.0\.0\.12|5555|ops@|https?:/);
    expect(s).toContain('zerosoft.ai is fine');
  });

  it('reconoce el bloqueo por cuota de Turso', () => {
    expect(isQuotaError('SQL read operations are forbidden (reads blocked)')).toBe(true);
    expect(isQuotaError('BLOCKED: Operation was blocked')).toBe(true);
    expect(isQuotaError('ECONNRESET')).toBe(false);
  });
});
