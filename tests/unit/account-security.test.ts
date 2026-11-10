import { describe, expect, it } from 'vitest';
import { getDb, getUserById } from '@/lib/db';
import {
  base32Decode,
  base32Encode,
  confirmMfaSetup,
  createSession,
  describeDevice,
  disableMfa,
  getSessionRow,
  listSessions,
  listUserSecurityEvents,
  listWorkspaceSecurityEvents,
  matchTotp,
  membersWithoutMfa,
  purgeSecurityRecords,
  recordSecurityEvent,
  recoveryCodesLeft,
  revokeOtherSessions,
  revokeSession,
  securityEventsCsv,
  sessionState,
  startMfaSetup,
  totpCode,
  verifyMfa,
} from '@/lib/account-security';
import { addMember, createTeam } from '@/lib/teams';
import { makeUser } from './helpers';

const now = () => Date.now();
const codeNow = (secret: string, offsetSteps = 0) => totpCode(secret, Math.floor(now() / 1000 / 30) + offsetSteps);

describe('TOTP (RFC 6238)', () => {
  // Vectores del apéndice B (SHA-1), recortados a 6 dígitos.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('coincide con los vectores de la RFC', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
  });
  it('acepta ±1 paso y nada más', () => {
    const t = 1_700_000_000_000;
    const step = Math.floor(t / 1000 / 30);
    expect(matchTotp(secret, totpCode(secret, step), t)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), t)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 2), t)).toBeNull();
    expect(matchTotp(secret, 'abcdef', t)).toBeNull();
  });
  it('base32 ida y vuelta', () => {
    const b = Buffer.from([1, 2, 3, 250, 251, 252, 7]);
    expect(base32Decode(base32Encode(b))).toEqual(b);
  });
});

describe('verificación en dos pasos', () => {
  it('alta con código, sin reuso del mismo código, recuperación de un solo uso y baja', async () => {
    const u = await makeUser('mfa');
    const { secret, uri } = await startMfaSetup(u);
    expect(uri).toContain('otpauth://totp/');
    const raw = (await getDb().prepare('SELECT mfa_pending_secret FROM users WHERE id = ?').get(u.id)) as { mfa_pending_secret: string };
    expect(raw.mfa_pending_secret).not.toContain(secret); // cifrado

    expect((await confirmMfaSetup(u.id, '000000', null)).ok).toBe(false);
    const sid = await createSession(u.id, { method: 'google', ip: null, userAgent: null });
    const ok = await confirmMfaSetup(u.id, codeNow(secret), sid);
    expect(ok.ok).toBe(true);
    const codes = ok.ok ? ok.recoveryCodes : [];
    expect(codes).toHaveLength(10);
    expect((await getSessionRow(sid))?.mfa_at).toBeTruthy();
    expect((await getUserById(u.id))?.mfa_enabled_at).toBeTruthy();

    // El código con el que se activó ya no sirve de nuevo; el del paso siguiente sí.
    expect((await verifyMfa(u.id, codeNow(secret), null)).ok).toBe(false);
    expect((await verifyMfa(u.id, codeNow(secret, 1), null)).ok).toBe(true);

    const r1 = await verifyMfa(u.id, codes[0].toUpperCase(), null);
    expect(r1.ok && r1.usedRecovery).toBe(true);
    expect((await verifyMfa(u.id, codes[0], null)).ok).toBe(false);
    expect(await recoveryCodesLeft(u.id)).toBe(9);

    expect((await disableMfa(u.id, 'zzzz-zzzz-zzzz')).ok).toBe(false);
    expect((await disableMfa(u.id, codes[1])).ok).toBe(true);
    expect((await getUserById(u.id))?.mfa_enabled_at).toBeNull();
    expect(await recoveryCodesLeft(u.id)).toBe(0);
  });
});

describe('sesiones del servidor', () => {
  it('estado según la fila, la persona y los dos pasos', async () => {
    const u = await makeUser('ses');
    const sid = await createSession(u.id, { method: 'email', ip: '1.2.3.4', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/130.0' });
    const row = await getSessionRow(sid);
    expect(sessionState(u, sid, row)).toBe('ok');
    expect(sessionState(u, sid, null)).toBe('invalid');
    expect(sessionState({ ...u, id: 'otra' }, sid, row)).toBe('invalid');
    expect(sessionState({ ...u, mfa_enabled_at: '2026-01-01' }, sid, row)).toBe('mfa_pending');
    expect(sessionState({ ...u, mfa_enabled_at: '2026-01-01' }, sid, { ...row!, mfa_at: '2026-01-01' })).toBe('ok');
    expect(sessionState(u, sid, { ...row!, expires_at: '2000-01-01T00:00:00Z' })).toBe('invalid');
    // JWT de antes (sin sid): vale salvo que haya cerrado todo o tenga dos pasos.
    expect(sessionState(u, null, null)).toBe('ok');
    expect(sessionState({ ...u, sessions_revoked_at: '2026-01-01' }, null, null)).toBe('invalid');
    expect(sessionState({ ...u, mfa_enabled_at: '2026-01-01' }, null, null)).toBe('invalid');

    const list = await listSessions(u.id, sid);
    expect(list).toHaveLength(1);
    expect(list[0].current).toBe(true);
    expect(list[0].device).toBe('Chrome · macOS');

    const other = await createSession(u.id, { method: 'google', ip: null, userAgent: null });
    expect(await revokeSession('alguien-mas', other)).toBe(false);
    expect(await revokeOtherSessions(u.id, sid)).toBe(1);
    expect(sessionState(u, other, await getSessionRow(other))).toBe('invalid');
    expect(sessionState(u, sid, await getSessionRow(sid))).toBe('ok');
    expect(await revokeSession(u.id, sid)).toBe(true);
    expect(sessionState(u, sid, await getSessionRow(sid))).toBe('invalid');
  });

  it('describe dispositivos', () => {
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Version/17.0 Mobile Safari/604.1')).toBe('Safari · iOS');
    expect(describeDevice(null, 'desktop')).toBe('zerosoft desktop');
    expect(describeDevice('')).toBe('');
  });
});

describe('registro de seguridad', () => {
  it('el workspace ve sus eventos, los de cuenta de sus miembros y los cambios de miembros', async () => {
    const owner = await makeUser('own');
    const member = await makeUser('mem');
    const outsider = await makeUser('out');
    const team = await createTeam(owner.id, 'Sec');
    await addMember(team.id, member.id, 'member');
    await recordSecurityEvent({ userId: member.id, action: 'login', meta: { method: 'google' }, ip: '9.9.9.9', userAgent: 'x' });
    await recordSecurityEvent({ userId: outsider.id, action: 'login', ip: null, userAgent: null });
    await recordSecurityEvent({ userId: owner.id, teamId: team.id, action: 'api_key.create', target: '=cmd|calc', ip: null, userAgent: null });
    await getDb()
      .prepare("INSERT INTO workspace_audit (id, team_id, actor_id, target_id, target_label, action, before, after) VALUES (?, ?, ?, ?, ?, 'member.role', '{}', '{}')")
      .run(`wa_${crypto.randomUUID()}`, team.id, owner.id, member.id, 'mem');

    const rows = await listWorkspaceSecurityEvents(team.id);
    const actions = rows.map((r) => `${r.source}:${r.action}:${r.actorId}`);
    expect(actions).toContain(`security:login:${member.id}`);
    expect(actions).toContain(`security:api_key.create:${owner.id}`);
    expect(actions).toContain(`members:member.role:${owner.id}`);
    expect(actions.some((a) => a.endsWith(outsider.id))).toBe(false);

    const csv = securityEventsCsv(rows);
    expect(csv.split('\n')[0]).toBe('time,source,action,actor,target,details,ip,user_agent');
    expect(csv).toContain("'=cmd|calc"); // sin fórmulas al abrirlo en una planilla
    expect((await listUserSecurityEvents(member.id)).map((r) => r.action)).toEqual(['login']);

    expect((await membersWithoutMfa(team.id)).map((m) => m.id)).toContain(member.id);
  });

  it('la retención borra lo viejo', async () => {
    const u = await makeUser('ret');
    await getDb()
      .prepare("INSERT INTO security_events (id, user_id, action, created_at) VALUES ('se_old', ?, 'login', '2020-01-01T00:00:00.000Z')")
      .run(u.id);
    const sid = await createSession(u.id, { method: 'google', ip: null, userAgent: null });
    await getDb().prepare("UPDATE user_sessions SET revoked_at = '2020-01-01T00:00:00.000Z' WHERE id = ?").run(sid);
    const res = await purgeSecurityRecords();
    expect(res.events).toBeGreaterThanOrEqual(1);
    expect(res.sessions).toBeGreaterThanOrEqual(1);
    expect(await getSessionRow(sid)).toBeNull();
  });
});
