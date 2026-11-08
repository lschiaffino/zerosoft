import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { applyUnsubscribe, getEmailPrefs, parseUnsubscribeToken, saveEmailPrefs, unsubscribeToken } from '@/lib/lifecycle/prefs';
import { digestCounts, ensureStateRows, lifecycleMode, listLifecycleSends, runLifecycleEmails, touchLifecycleActivity } from '@/lib/lifecycle/scheduler';
import { dbSignalsSource, recordLifecycleEvent } from '@/lib/lifecycle/signals';
import type { sendEmail } from '@/lib/email';
import { makeUser } from './helpers';

type SendArgs = Parameters<typeof sendEmail>[0];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function fakeSender(ok = true) {
  const calls: SendArgs[] = [];
  const send = vi.fn(async (opts: SendArgs) => {
    calls.push(opts);
    return ok ? { ok: true, provider: 'test', id: `msg_${calls.length}` } : { ok: false, provider: 'test', error: 'boom' };
  });
  return { send: send as unknown as typeof sendEmail, calls };
}

/** Persona "nueva" creada hace `ageMs`, con onboarding terminado y su ficha de workspace. */
async function newUser(ageMs = HOUR, profile: Record<string, unknown> = { entryApp: 'docs' }, now = new Date()) {
  const u = await makeUser('lc');
  const created = new Date(now.getTime() - ageMs).toISOString();
  await getDb()
    .prepare("UPDATE users SET created_at = ?, onboarded_at = ?, profile = ?, locale = 'es', time_zone = 'UTC' WHERE id = ?")
    .run(created, created, JSON.stringify(profile), u.id);
  // Otras pruebas del archivo pudieron crear filas antes: se rehace la de esta persona.
  await getDb().prepare('DELETE FROM lifecycle_state WHERE user_id = ?').run(u.id);
  return { ...u, created_at: created };
}

/** Deja solo a esta persona como vencida para el cron (las demás pruebas no se mezclan). */
async function onlyDue(userId: string) {
  await getDb().prepare('UPDATE lifecycle_state SET next_check_at = NULL WHERE user_id <> ?').run(userId);
}

async function sendsOf(userId: string) {
  return (await getDb().prepare('SELECT send_key, template, status, attempts FROM lifecycle_sends WHERE user_id = ? ORDER BY created_at').all(userId)) as Array<{
    send_key: string;
    template: string;
    status: string;
    attempts: number;
  }>;
}

beforeEach(async () => {
  await getDb().prepare('UPDATE lifecycle_state SET next_check_at = NULL').run();
});

describe('modo del motor', () => {
  it('sin proveedor no hace nada y lo dice en el log', async () => {
    expect(lifecycleMode({})).toBe('off');
    expect(lifecycleMode({ RESEND_API_KEY: 're_x' })).toBe('resend');
    expect(lifecycleMode({ LIFECYCLE_EMAILS: 'console' })).toBe('console');
    expect(lifecycleMode({ LIFECYCLE_EMAILS: 'off', RESEND_API_KEY: 're_x' })).toBe('off');
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { send } = fakeSender();
    const u = await newUser();
    const r = await runLifecycleEmails({ mode: 'off', send });
    expect(r).toMatchObject({ mode: 'off', checked: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).toMatch(/no email provider configured/);
    expect(await sendsOf(u.id)).toEqual([]);
    log.mockRestore();
  });
});

describe('cron de ciclo de vida', () => {
  it('manda la bienvenida una sola vez aunque corran dos crons a la vez', async () => {
    const now = new Date();
    const u = await newUser(HOUR, { entryApp: 'docs' }, now);
    await ensureStateRows(now);
    await onlyDue(u.id);
    const { send, calls } = fakeSender();
    const [a, b] = await Promise.all([runLifecycleEmails({ mode: 'console', send, now }), runLifecycleEmails({ mode: 'console', send, now })]);
    expect(a.sent + b.sent).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe(u.email);
    expect(calls[0].subject).toBe('Tu cuenta de zerosoft está lista');
    expect(calls[0].headers?.['List-Unsubscribe']).toMatch(/^<https?:\/\/.+\/api\/email\/unsubscribe\?t=.+>$/);
    expect(calls[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    expect(calls[0].idempotencyKey).toMatch(/^lifecycle-lcs_/);
    expect(await sendsOf(u.id)).toEqual([{ send_key: 'welcome', template: 'welcome', status: 'sent', attempts: 1 }]);

    // Una corrida más tarde ese mismo día: nada nuevo (tope de 2 días).
    await getDb().prepare('UPDATE lifecycle_state SET next_check_at = ? WHERE user_id = ?').run(now.toISOString(), u.id);
    await runLifecycleEmails({ mode: 'console', send, now: new Date(now.getTime() + 5 * 60_000) });
    expect(calls).toHaveLength(1);
  });

  it('después de la bienvenida, el paso que falta; y lo deja cuando ya lo hizo', async () => {
    const now = new Date();
    const u = await newUser(3 * DAY, { entryApp: 'docs' }, now);
    await ensureStateRows(now);
    await getDb()
      .prepare("INSERT INTO lifecycle_sends (id, user_id, send_key, template, category, status, created_at, sent_at) VALUES (?, ?, 'welcome', 'welcome', 'onboarding', 'sent', ?, ?)")
      .run(`lcs_${crypto.randomUUID()}`, u.id, new Date(now.getTime() - 3 * DAY).toISOString(), new Date(now.getTime() - 3 * DAY).toISOString());
    await getDb().prepare('UPDATE lifecycle_state SET last_active_at = ? WHERE user_id = ?').run(new Date(now.getTime() - 2 * DAY).toISOString(), u.id);
    await onlyDue(u.id);
    const { send, calls } = fakeSender();
    await runLifecycleEmails({ mode: 'console', send, now });
    expect(calls.map((c) => c.subject)).toEqual(['Creá tu primera página en Docs']);
    expect(calls[0].html).toContain('/es/app/docs');

    // Crea una página: ese paso ya no aplica y, pasado el tope, sigue con lo próximo.
    await getDb().prepare("INSERT INTO docs_pages (id, user_id, title, created_at) VALUES (?, ?, 'Hola', ?)").run(`pg_${crypto.randomUUID()}`, u.id, new Date(now.getTime() - DAY).toISOString());
    const s = await dbSignalsSource.load(u.id);
    expect(s?.createdFirstItem.docs).toBe(true);
    const later = new Date(now.getTime() + 2 * DAY + HOUR);
    await getDb().prepare('UPDATE lifecycle_state SET next_check_at = ? WHERE user_id = ?').run(now.toISOString(), u.id);
    await runLifecycleEmails({ mode: 'console', send, now: later });
    expect(calls.map((c) => c.subject)[1]).toBe('Pedile cosas al asistente con ⌘J');
  });

  it('no manda empujones si entró hoy', async () => {
    const now = new Date();
    const u = await newUser(5 * DAY, { entryApp: 'docs' }, now);
    await ensureStateRows(now);
    await getDb()
      .prepare("INSERT INTO lifecycle_sends (id, user_id, send_key, template, category, status, created_at) VALUES (?, ?, 'welcome', 'welcome', 'onboarding', 'sent', ?)")
      .run(`lcs_${crypto.randomUUID()}`, u.id, new Date(now.getTime() - 5 * DAY).toISOString());
    await touchLifecycleActivity(u, now);
    await getDb().prepare('UPDATE lifecycle_state SET next_check_at = ? WHERE user_id = ?').run(now.toISOString(), u.id);
    await onlyDue(u.id);
    const { send, calls } = fakeSender();
    const r = await runLifecycleEmails({ mode: 'console', send, now });
    expect(r.checked).toBe(1);
    expect(calls).toHaveLength(0);
    const st = (await getDb().prepare('SELECT next_check_at, claimed_until FROM lifecycle_state WHERE user_id = ?').get(u.id)) as { next_check_at: string; claimed_until: string | null };
    expect(st.claimed_until).toBeNull();
    expect(new Date(st.next_check_at).getTime()).toBeGreaterThan(now.getTime());
  });

  it('un fallo se reintenta (hasta 3 veces) sin duplicar', async () => {
    const now = new Date();
    const u = await newUser(HOUR, { entryApp: 'docs' }, now);
    await ensureStateRows(now);
    await onlyDue(u.id);
    const bad = fakeSender(false);
    await runLifecycleEmails({ mode: 'console', send: bad.send, now });
    expect(await sendsOf(u.id)).toEqual([{ send_key: 'welcome', template: 'welcome', status: 'failed', attempts: 1 }]);
    const good = fakeSender(true);
    const later = new Date(now.getTime() + HOUR + 60_000);
    await runLifecycleEmails({ mode: 'console', send: good.send, now: later });
    expect(good.calls).toHaveLength(1);
    expect(await sendsOf(u.id)).toEqual([{ send_key: 'welcome', template: 'welcome', status: 'sent', attempts: 2 }]);
  });

  it('las cuentas de antes del motor no reciben la serie', async () => {
    const now = new Date();
    const u = await newUser(60 * DAY, { entryApp: 'docs' }, now);
    await ensureStateRows(now);
    const st = (await getDb().prepare('SELECT legacy, next_check_at FROM lifecycle_state WHERE user_id = ?').get(u.id)) as { legacy: number; next_check_at: string | null };
    expect(st).toEqual({ legacy: 1, next_check_at: null });
    // Aunque entre a la app, sigue sin serie.
    await touchLifecycleActivity(u, now);
    const after = (await getDb().prepare('SELECT legacy FROM lifecycle_state WHERE user_id = ?').get(u.id)) as { legacy: number };
    expect(after.legacy).toBe(1);
  });

  it('respeta la baja: nada de la categoría ni, con baja total, nada', async () => {
    const now = new Date();
    const u = await newUser(HOUR, { entryApp: 'docs' }, now);
    await ensureStateRows(now);
    await onlyDue(u.id);
    await applyUnsubscribe(u.id, 'all');
    const { send, calls } = fakeSender();
    await runLifecycleEmails({ mode: 'console', send, now });
    expect(calls).toHaveLength(0);
    const st = (await getDb().prepare('SELECT next_check_at FROM lifecycle_state WHERE user_id = ?').get(u.id)) as { next_check_at: string | null };
    expect(st.next_check_at).toBeNull();
  });

  it('el digest vacío no se manda; con actividad, sí (una vez por semana)', async () => {
    const monday = new Date('2026-11-09T10:00:00Z');
    const u = await newUser(30 * DAY, { entryApp: 'docs' }, monday);
    await ensureStateRows(monday);
    await saveEmailPrefs(u.id, { unsubscribedAll: false, optedOut: [], digest: true });
    await getDb().prepare('UPDATE lifecycle_state SET next_check_at = ?, legacy = 1 WHERE user_id = ?').run(monday.toISOString(), u.id);
    await onlyDue(u.id);
    const { send, calls } = fakeSender();
    await runLifecycleEmails({ mode: 'console', send, now: monday });
    expect(calls).toHaveLength(0);
    expect((await sendsOf(u.id)).map((s) => s.status)).toEqual(['skipped']);

    const next = new Date('2026-11-16T10:00:00Z');
    await getDb().prepare("INSERT INTO docs_pages (id, user_id, title, created_at) VALUES (?, ?, 'Nueva', ?)").run(`pg_${crypto.randomUUID()}`, u.id, '2026-11-14T10:00:00.000Z');
    expect((await digestCounts({ workspaceOwnerId: u.id, teamId: null }, next)).docs).toBe(1);
    await getDb().prepare('UPDATE lifecycle_state SET next_check_at = ? WHERE user_id = ?').run(next.toISOString(), u.id);
    await runLifecycleEmails({ mode: 'console', send, now: next });
    await getDb().prepare('UPDATE lifecycle_state SET next_check_at = ? WHERE user_id = ?').run(next.toISOString(), u.id);
    await runLifecycleEmails({ mode: 'console', send, now: new Date(next.getTime() + 2 * HOUR) });
    expect(calls).toHaveLength(1);
    expect(calls[0].subject).toMatch(/^Tu semana en /);
    expect(calls[0].text).toContain('Páginas nuevas en Docs: 1');
    const log = await listLifecycleSends(500);
    expect(log.some((r) => r.email === u.email && r.template === 'digest' && r.status === 'sent')).toBe(true);
  });
});

describe('señales desde la base', () => {
  it('lee app de escritorio, asistente, calendario y equipo', async () => {
    const u = await newUser(HOUR, { entryApp: 'cal', sourceTool: 'calendly', role: 'founder' });
    let s = await dbSignalsSource.load(u.id);
    expect(s).toMatchObject({ apps: ['cal'], sourceTool: 'calendly', desktopInstalled: false, calendarConnected: false, locale: 'es' });
    await recordLifecycleEvent(u.id, 'desktop_installed');
    await recordLifecycleEvent(u.id, 'desktop_installed');
    await getDb()
      .prepare("INSERT INTO integrations (user_id, provider, access_token) VALUES (?, 'google_calendar', 'x')")
      .run(u.id);
    s = await dbSignalsSource.load(u.id);
    expect(s).toMatchObject({ desktopInstalled: true, calendarConnected: true });
    expect(await dbSignalsSource.load('no-existe')).toBeNull();
  });
});

describe('preferencias y bajas', () => {
  it('el token de baja es por persona y categoría, y no se puede falsificar', async () => {
    const u = await makeUser('unsub');
    const tok = unsubscribeToken(u.id, 'tips');
    expect(parseUnsubscribeToken(tok)).toEqual({ userId: u.id, scope: 'tips' });
    const [body] = tok.split('.');
    const forged = `${Buffer.from(`${u.id}|all`).toString('base64url')}.${tok.split('.')[1]}`;
    expect(parseUnsubscribeToken(forged)).toBeNull();
    expect(parseUnsubscribeToken(`${body}.x`)).toBeNull();
    expect(parseUnsubscribeToken('')).toBeNull();
    expect(parseUnsubscribeToken(null)).toBeNull();
  });

  it('la baja de una categoría deja las otras; volver a guardar las reactiva', async () => {
    const u = await makeUser('prefs');
    expect(await getEmailPrefs(u.id)).toEqual({ unsubscribedAll: false, optedOut: [], digest: false });
    await applyUnsubscribe(u.id, 'tips');
    await applyUnsubscribe(u.id, 'tips');
    expect(await getEmailPrefs(u.id)).toEqual({ unsubscribedAll: false, optedOut: ['tips'], digest: false });
    await saveEmailPrefs(u.id, { unsubscribedAll: false, optedOut: [], digest: true });
    await applyUnsubscribe(u.id, 'digest');
    expect(await getEmailPrefs(u.id)).toMatchObject({ digest: false, optedOut: ['digest'] });
    expect(await applyUnsubscribe('no-existe', 'all')).toBeNull();
  });
});
