import { describe, expect, it } from 'vitest';
import { activeToday, decideNext, digestKey, isoWeek, LIFECYCLE_LIMITS, parseTime, sequenceCandidates } from '@/lib/lifecycle/rules';
import { chosenApps } from '@/lib/lifecycle/signals';
import { DEFAULT_PREFS, type EmailPrefs, type LifecycleSignals, type SentRecord } from '@/lib/lifecycle/types';

const DAY = 86_400_000;
const NOW = new Date('2026-11-10T15:00:00Z'); // martes

function signals(over: Partial<LifecycleSignals> = {}): LifecycleSignals {
  return {
    userId: 'u1',
    email: 'ana@example.com',
    name: 'Ana',
    locale: 'es',
    timeZone: 'UTC',
    createdAt: iso(-5 * DAY),
    onboardedAt: iso(-5 * DAY),
    apps: ['docs'],
    sourceTool: null,
    role: null,
    workspaceOwnerId: 'u1',
    teamId: 'ws_u1',
    isTeamAdmin: false,
    teamName: 'Acme',
    memberCount: 1,
    pendingInvites: 0,
    oldestPendingInviteAt: null,
    createdFirstItem: {},
    imported: false,
    calendarConnected: false,
    whatsappConnected: false,
    desktopInstalled: false,
    usedVoice: false,
    usedAssistant: false,
    usedMcp: false,
    ...over,
  };
}

function iso(offsetMs: number, from = NOW): string {
  return new Date(from.getTime() + offsetMs).toISOString();
}

const welcomeSent: SentRecord = { key: 'welcome', template: 'welcome', category: 'onboarding', at: iso(-5 * DAY) };

function decide(opts: { s?: Partial<LifecycleSignals>; created?: number; lastActive?: number | null; sent?: SentRecord[]; prefs?: Partial<EmailPrefs>; legacy?: boolean; done?: boolean; now?: Date } = {}) {
  const now = opts.now ?? NOW;
  return decideNext({
    signals: signals(opts.s),
    state: {
      legacy: opts.legacy ? 1 : 0,
      created_at: iso(opts.created ?? -5 * DAY, now),
      last_active_at: opts.lastActive === null ? null : iso(opts.lastActive ?? -2 * DAY, now),
      done_at: opts.done ? iso(-DAY, now) : null,
    },
    sent: opts.sent ?? [welcomeSent],
    prefs: { ...DEFAULT_PREFS, optedOut: [], ...opts.prefs },
    now,
  });
}

describe('reglas de ciclo de vida', () => {
  it('manda la bienvenida el día 0 apenas termina el onboarding', () => {
    expect(decide({ created: -10 * 60_000, sent: [], lastActive: 0 })).toMatchObject({ action: 'send', template: 'welcome', key: 'welcome' });
  });

  it('sin onboarding, la bienvenida espera 2 horas desde el alta', () => {
    const d = decide({ created: -30 * 60_000, sent: [], s: { onboardedAt: null } });
    expect(d).toMatchObject({ action: 'wait', reason: 'welcome_grace' });
    expect(decide({ created: -3 * 3_600_000, sent: [], s: { onboardedAt: null } })).toMatchObject({ action: 'send', template: 'welcome' });
  });

  it('las cuentas legacy no reciben la serie', () => {
    expect(decide({ legacy: true, sent: [] })).toEqual({ action: 'done', reason: 'legacy' });
  });

  it('respeta el tope de un email cada 2 días', () => {
    const d = decide({ sent: [{ ...welcomeSent, at: iso(-DAY) }] });
    expect(d).toMatchObject({ action: 'wait', reason: 'frequency', until: iso(DAY) });
  });

  it('no manda empujones si la persona entró hoy', () => {
    expect(decide({ lastActive: -60_000 })).toMatchObject({ action: 'wait', reason: 'active_today' });
  });

  it('"hoy" es el día local de la persona', () => {
    // 01:30 en Buenos Aires del 10/11 es 04:30 UTC; la actividad de las 23:00 locales del 9/11 fue "ayer".
    const now = new Date('2026-11-10T04:30:00Z');
    expect(activeToday('2026-11-10T02:00:00Z', now, 'America/Argentina/Buenos_Aires')).toBe(false);
    expect(activeToday('2026-11-10T03:30:00Z', now, 'America/Argentina/Buenos_Aires')).toBe(true);
    expect(activeToday('2026-11-10T02:00:00Z', now, 'UTC')).toBe(true);
  });

  it('elige el paso de configuración antes que funciones y tips', () => {
    expect(decide()).toMatchObject({ action: 'send', template: 'setup_first_item', app: 'docs', key: 'setup:first:docs' });
    const done = decide({ s: { createdFirstItem: { docs: true } } });
    expect(done).toMatchObject({ action: 'send', template: 'feature_assistant' });
  });

  it('importar desde la herramienta de origen va después de crear lo primero', () => {
    const s = { apps: ['track' as const], sourceTool: 'linear', createdFirstItem: { track: true } };
    expect(decide({ s })).toMatchObject({ template: 'setup_import', key: 'setup:import:linear' });
    expect(decide({ s: { ...s, imported: true } })).toMatchObject({ template: 'feature_assistant' });
  });

  it('pide conectar calendario o WhatsApp solo a quien eligió Cal o Groups', () => {
    const base = { createdFirstItem: { docs: true, cal: true } };
    expect(sequenceCandidates(signals(base), NOW).map((c) => c.template)).not.toContain('setup_calendar');
    expect(sequenceCandidates(signals({ ...base, apps: ['cal'] }), NOW).map((c) => c.template)).toContain('setup_calendar');
    expect(sequenceCandidates(signals({ ...base, apps: ['groups'] }), NOW).map((c) => c.template)).toContain('setup_whatsapp');
    expect(sequenceCandidates(signals({ ...base, apps: ['groups'], whatsappConnected: true }), NOW).map((c) => c.template)).not.toContain('setup_whatsapp');
  });

  it('invitar al equipo es solo para admins de un workspace de equipo', () => {
    const s = { createdFirstItem: { docs: true } };
    expect(sequenceCandidates(signals(s), NOW).map((c) => c.template)).not.toContain('team_invite');
    expect(decide({ s: { ...s, isTeamAdmin: true } })).toMatchObject({ template: 'team_invite', category: 'team' });
    // Con invitaciones pendientes de hace más de 3 días: el recordatorio de reenviarlas.
    const pending = { ...s, isTeamAdmin: true, pendingInvites: 2, oldestPendingInviteAt: iso(-4 * DAY) };
    expect(decide({ s: pending })).toMatchObject({ template: 'team_pending' });
    // Recientes: todavía no.
    expect(sequenceCandidates(signals({ ...pending, oldestPendingInviteAt: iso(-DAY) }), NOW).map((c) => c.template)).not.toContain('team_pending');
    // Con el equipo ya adentro, nada.
    expect(sequenceCandidates(signals({ ...s, isTeamAdmin: true, memberCount: 3 }), NOW).map((c) => c.template)).not.toContain('team_invite');
  });

  it('no repite lo ya enviado y saltea categorías apagadas', () => {
    const sent: SentRecord[] = [
      { ...welcomeSent, at: iso(-10 * DAY) },
      { key: 'setup:first:docs', template: 'setup_first_item', category: 'onboarding', at: iso(-6 * DAY) },
    ];
    expect(decide({ sent })).toMatchObject({ template: 'feature_assistant' });
    expect(decide({ sent, prefs: { optedOut: ['tips'] } })).toEqual({ action: 'done', reason: 'nothing_left' });
  });

  it('las funciones solo aparecen si sirven para sus apps', () => {
    const s = signals({ apps: ['shop'], createdFirstItem: {} });
    const t = sequenceCandidates(s, NOW).map((c) => c.template);
    expect(t).not.toContain('feature_voice');
    expect(t).not.toContain('feature_mcp');
    expect(sequenceCandidates(signals({ apps: ['shop'], role: 'engineering' }), NOW).map((c) => c.template)).toContain('feature_mcp');
  });

  it('termina cuando no queda nada o pasaron 30 días', () => {
    const all = {
      createdFirstItem: { docs: true },
      usedAssistant: true,
      usedVoice: true,
      desktopInstalled: true,
      usedMcp: true,
    };
    const sent: SentRecord[] = [{ ...welcomeSent, at: iso(-10 * DAY) }, { key: 'tip:search', template: 'tip_search', category: 'tips', at: iso(-3 * DAY) }];
    expect(decide({ s: all, sent })).toEqual({ action: 'done', reason: 'nothing_left' });
    expect(decide({ created: -31 * DAY })).toEqual({ action: 'done', reason: 'sequence_window' });
  });

  it('reengancha después de 14 días sin entrar, como mucho 2 veces y separadas 30 días', () => {
    const lastActive = -15 * DAY;
    expect(decide({ lastActive, created: -40 * DAY })).toMatchObject({ action: 'send', template: 'reengage', key: 'reengage:1', category: 'reengagement' });
    const one: SentRecord = { key: 'reengage:1', template: 'reengage', category: 'reengagement', at: iso(-DAY * 5) };
    expect(decide({ lastActive: -20 * DAY, created: -40 * DAY, sent: [welcomeSent, one] })).toMatchObject({ action: 'wait', reason: 'reengage_gap' });
    const oldOne = { ...one, at: iso(-31 * DAY) };
    expect(decide({ lastActive: -45 * DAY, created: -60 * DAY, sent: [welcomeSent, oldOne] })).toMatchObject({ template: 'reengage', key: 'reengage:2' });
    const two: SentRecord = { key: 'reengage:2', template: 'reengage', category: 'reengagement', at: iso(-31 * DAY) };
    expect(decide({ lastActive: -90 * DAY, created: -100 * DAY, sent: [welcomeSent, oldOne, two], done: true })).toEqual({ action: 'done', reason: 'inactive' });
  });

  it('volver a entrar reinicia el reenganche', () => {
    const one: SentRecord = { key: 'reengage:1', template: 'reengage', category: 'reengagement', at: iso(-40 * DAY) };
    // Volvió hace 20 días (después del primer reenganche) y otra vez se fue: corresponde el segundo.
    expect(decide({ lastActive: -20 * DAY, created: -80 * DAY, sent: [welcomeSent, one] })).toMatchObject({ key: 'reengage:2' });
  });

  it('nada si se dio de baja de todo', () => {
    expect(decide({ prefs: { unsubscribedAll: true }, sent: [] })).toEqual({ action: 'done', reason: 'unsubscribed_all' });
  });

  it('la serie terminada igual puede reenganchar', () => {
    expect(decide({ done: true })).toEqual({ action: 'done', reason: 'sequence_done' });
    expect(decide({ done: true, lastActive: -20 * DAY, created: -50 * DAY })).toMatchObject({ template: 'reengage' });
  });
});

describe('digest semanal', () => {
  const monday9 = new Date('2026-11-09T09:00:00Z');
  const state = { legacy: 0, created_at: '2026-10-01T00:00:00Z', last_active_at: null, done_at: null };
  const on: EmailPrefs = { unsubscribedAll: false, optedOut: [], digest: true };

  it('sale los lunes desde las 8 locales, una vez por semana, solo si lo activó', () => {
    expect(digestKey({ signals: signals(), state, sent: [], prefs: on, now: monday9 })).toBe(`digest:${isoWeek(monday9, 'UTC')}`);
    expect(digestKey({ signals: signals(), state, sent: [], prefs: { ...on, digest: false }, now: monday9 })).toBeNull();
    expect(digestKey({ signals: signals(), state, sent: [], prefs: on, now: new Date('2026-11-09T07:00:00Z') })).toBeNull();
    expect(digestKey({ signals: signals(), state, sent: [], prefs: on, now: NOW })).toBeNull();
    const key = `digest:${isoWeek(monday9, 'UTC')}`;
    expect(digestKey({ signals: signals(), state, sent: [{ key, template: 'digest', category: 'digest', at: monday9.toISOString() }], prefs: on, now: monday9 })).toBeNull();
  });

  it('necesita una semana de cuenta y respeta la baja total', () => {
    expect(digestKey({ signals: signals(), state: { ...state, created_at: '2026-11-05T00:00:00Z' }, sent: [], prefs: on, now: monday9 })).toBeNull();
    expect(digestKey({ signals: signals(), state, sent: [], prefs: { ...on, unsubscribedAll: true }, now: monday9 })).toBeNull();
  });

  it('no cuenta para el tope de la serie', () => {
    const d: SentRecord = { key: 'digest:2026-W46', template: 'digest', category: 'digest', at: iso(-60_000) };
    expect(decide({ sent: [welcomeSent, d] })).toMatchObject({ action: 'send', template: 'setup_first_item' });
  });

  it('semana ISO', () => {
    expect(isoWeek(new Date('2026-01-01T12:00:00Z'), 'UTC')).toBe('2026-W01');
    expect(isoWeek(new Date('2027-01-01T12:00:00Z'), 'UTC')).toBe('2026-W53');
  });
});

describe('señales', () => {
  it('apps elegidas: entrada, objetivos y la de la herramienta de origen, sin repetir', () => {
    expect(chosenApps({ entryApp: 'crm', goals: ['docs', 'crm', 'nada'], sourceTool: 'linear' })).toEqual(['crm', 'docs', 'track']);
    expect(chosenApps({})).toEqual([]);
  });

  it('lee fechas de la base en UTC', () => {
    expect(parseTime('2026-11-10 15:00:00')).toBe(Date.parse('2026-11-10T15:00:00Z'));
    expect(parseTime('2026-11-10T15:00:00.000Z')).toBe(Date.parse('2026-11-10T15:00:00Z'));
    expect(parseTime(null)).toBe(0);
  });

  it('los límites son los acordados', () => {
    expect(LIFECYCLE_LIMITS.minGapMs).toBe(2 * DAY);
    expect(LIFECYCLE_LIMITS.inactiveMs).toBe(14 * DAY);
  });
});
