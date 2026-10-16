import { describe, expect, it } from 'vitest';
import {
  deriveInputName,
  nameFollowsLabel,
  presetUsesTime,
  scheduleFromPreset,
  schedulePreset,
  scheduleTime,
  stableJson,
} from '@/lib/robots-editor';
import { robotScheduleSchema, validateInputDefs } from '@/lib/robots-schema';

describe('editor de robots: presets de horario', () => {
  it('reconoce cada preset desde lo guardado', () => {
    expect(schedulePreset(null)).toBe('none');
    expect(schedulePreset({ mode: 'interval', every: 1, unit: 'hours', time: '09:00', timezone: 'UTC' })).toBe('hourly');
    expect(schedulePreset({ mode: 'interval', every: 30, unit: 'minutes', time: '09:00', timezone: 'UTC' })).toBe('custom');
    expect(schedulePreset({ mode: 'daily', every: 24, unit: 'hours', time: '08:30', timezone: 'UTC' })).toBe('daily');
    expect(schedulePreset({ mode: 'cron', cron: '15 7 * * 1-5', every: 24, unit: 'hours', time: '09:00', timezone: 'UTC' })).toBe('weekdays');
    expect(schedulePreset({ mode: 'cron', cron: '0 9 * * 1', every: 24, unit: 'hours', time: '09:00', timezone: 'UTC' })).toBe('weekly');
    expect(schedulePreset({ mode: 'cron', cron: '*/20 * * * *', every: 24, unit: 'hours', time: '09:00', timezone: 'UTC' })).toBe('custom');
  });

  it('lee la hora de un cron de preset', () => {
    expect(scheduleTime({ mode: 'cron', cron: '5 7 * * 1-5', every: 24, unit: 'hours', time: '09:00', timezone: 'UTC' })).toBe('07:05');
    expect(scheduleTime({ mode: 'daily', every: 24, unit: 'hours', time: '8:30', timezone: 'UTC' })).toBe('08:30');
    expect(scheduleTime(null)).toBe('09:00');
  });

  it('cada preset arma un horario que la API acepta y vuelve a reconocerse', () => {
    for (const p of ['hourly', 'daily', 'weekdays', 'weekly', 'custom'] as const) {
      const s = scheduleFromPreset(p, null, { time: '07:45', timezone: 'America/Argentina/Buenos_Aires' });
      expect(robotScheduleSchema.safeParse(s).success, p).toBe(true);
      if (p !== 'custom') expect(schedulePreset(s)).toBe(p);
      if (presetUsesTime(p)) expect(scheduleTime(s)).toBe('07:45');
    }
    expect(scheduleFromPreset('none', null)).toBeNull();
  });

  it('elegir Personalizado conserva un horario que ya era personalizado', () => {
    const custom = { mode: 'interval' as const, every: 45, unit: 'minutes' as const, time: '09:00', timezone: 'UTC' };
    expect(scheduleFromPreset('custom', custom)).toBe(custom);
  });
});

describe('editor de robots: cambios sin guardar', () => {
  it('stableJson ignora el orden de las claves y los undefined', () => {
    expect(stableJson({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: undefined } })).toBe(stableJson({ a: { d: [1, { x: 1, y: 2 }] }, b: 1 }));
    expect(stableJson({ a: 1 })).not.toBe(stableJson({ a: 2 }));
    // Un horario armado por el editor equivale al que devuelve la API ya normalizado.
    const local = scheduleFromPreset('weekdays', null, { time: '07:30', timezone: 'UTC' });
    const api = robotScheduleSchema.parse(local);
    expect(stableJson(local)).toBe(stableJson(api));
  });
});

describe('editor de robots: nombres de entradas derivados', () => {
  it('slug válido para la API desde la etiqueta', () => {
    expect(deriveInputName('Email del cliente')).toBe('email_del_cliente');
    expect(deriveInputName('Página de inicio (URL)')).toBe('pagina_de_inicio_url');
    expect(deriveInputName('2do teléfono')).toBe('input_2do_telefono');
    expect(deriveInputName('   ')).toBe('');
    expect(deriveInputName('x'.repeat(80))).toHaveLength(40);
    const res = validateInputDefs([
      { name: deriveInputName('Código postal'), label: 'Código postal', kind: 'text', default: '', required: false },
    ]);
    expect(res.ok).toBe(true);
  });

  it('el nombre sigue a la etiqueta hasta que lo editan a mano', () => {
    expect(nameFollowsLabel('input1', 'Algo')).toBe(true);
    expect(nameFollowsLabel('', '')).toBe(true);
    expect(nameFollowsLabel('email', 'Email')).toBe(true);
    expect(nameFollowsLabel('correo', 'Email')).toBe(false);
  });
});
