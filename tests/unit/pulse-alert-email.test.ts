import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const sent: Array<{ to: string; subject: string; text?: string }> = [];
vi.mock('@/lib/email', async (orig) => {
  const real = await orig<typeof import('@/lib/email')>();
  return {
    ...real,
    sendEmail: vi.fn(async (opts: { to: string; subject: string; text?: string }) => {
      sent.push({ to: opts.to, subject: opts.subject, text: opts.text });
      return { ok: true, provider: 'test' };
    }),
  };
});

import { getDb, upsertUser } from '@/lib/db';
import { parseIngestBody } from '@/lib/analytics/ingest-core';
import { storeEvents } from '@/lib/analytics/ingest';
import { createProject, getProject, type ProjectRow } from '@/lib/analytics/projects';
import { createInsight } from '@/lib/analytics/records';
import { insightQuerySchema, alertInputSchema } from '@/lib/analytics/types';
import { createAlert, getAlert, runAlertsCron, updateAlert } from '@/lib/analytics/alerts';

const DAY = 86_400_000;
const NOW = Date.now();
const created: string[] = [];

async function setup() {
  const user = await upsertUser({ email: `pulse-alert-mail-${nanoid(8)}@test.dev` });
  const project = await createProject(user.id, user.id, 'P');
  created.push(project.id);
  const insight = await createInsight(project.id, user.id, { name: 'Signups', query: insightQuerySchema.parse({ kind: 'trends', series: [{ event: 'signup' }] }) });
  const fresh = (await getProject(project.workspace_id, project.id)) as ProjectRow;
  const parsed = parseIngestBody(
    JSON.stringify({
      api_key: fresh.public_key,
      batch: ['a', 'b', 'c'].map((d) => ({ event: 'signup', distinct_id: d, timestamp: new Date(NOW - DAY).toISOString(), properties: {} })),
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  await storeEvents(fresh, parsed.events, null);
  return { user, project, insight };
}

const base = { seriesIndex: 0, condition: 'above' as const, threshold: 2, frequency: 'daily' as const, enabled: true, subscribers: [] };
const mailsTo = (email: string) => sent.filter((m) => m.to === email);

beforeEach(() => {
  sent.length = 0;
});

afterAll(async () => {
  for (const id of created) {
    await getDb().prepare('DELETE FROM analytics_events WHERE project_id = ?').run(id);
    await getDb().prepare('DELETE FROM analytics_alerts WHERE project_id = ?').run(id);
    await getDb().prepare('DELETE FROM analytics_projects WHERE id = ?').run(id);
  }
});

describe('Pulse: alertas por email', () => {
  it('el email es opcional y apagado por defecto en la API', () => {
    expect(alertInputSchema.parse({ name: 'a', insightId: 'i', condition: 'above', threshold: 1 }).email).toBe(false);
    expect(alertInputSchema.parse({ name: 'a', insightId: 'i', condition: 'above', threshold: 1, email: true }).email).toBe(true);
  });

  it('con email activado, manda un email al dispararse, con el valor y el link al insight', async () => {
    const { user, project, insight } = await setup();
    const alert = await createAlert(project.id, user.id, { ...base, name: 'Muchos signups', insightId: insight.id, email: true });
    if (typeof alert === 'string') throw new Error(alert);
    expect(alert.email).toBe(true);
    await runAlertsCron({ now: NOW });
    const mails = mailsTo(user.email);
    expect(mails).toHaveLength(1);
    expect(mails[0].subject).toContain('Muchos signups');
    expect(mails[0].text).toContain('3');
    expect(mails[0].text).toContain(`/app/pulse/insights/${insight.id}`);
    // Sigue disparada: no repite el email.
    await getDb().prepare('UPDATE analytics_alerts SET next_check_at = 0 WHERE id = ?').run(alert.id);
    await runAlertsCron({ now: NOW + 1000 });
    expect(mailsTo(user.email)).toHaveLength(1);
  });

  it('sin email, solo el aviso en la app', async () => {
    const { user, project, insight } = await setup();
    const alert = await createAlert(project.id, user.id, { ...base, name: 'Solo app', insightId: insight.id });
    if (typeof alert === 'string') throw new Error(alert);
    expect(alert.email).toBe(false);
    await runAlertsCron({ now: NOW });
    expect(mailsTo(user.email)).toHaveLength(0);
    const notices = await getDb().prepare("SELECT id FROM notifications WHERE user_id = ? AND type = 'analytics_alert'").all(user.id);
    expect(notices).toHaveLength(1);
  });

  it('se puede prender y apagar sin perder el resto de la alerta', async () => {
    const { user, project, insight } = await setup();
    const alert = await createAlert(project.id, user.id, { ...base, name: 'X', insightId: insight.id });
    if (typeof alert === 'string') throw new Error(alert);
    await getDb().prepare("UPDATE analytics_alerts SET state = 'firing' WHERE id = ?").run(alert.id);
    const on = await updateAlert(project.id, alert.id, { email: true });
    expect(on?.email).toBe(true);
    // Cambiar solo el canal no reinicia el estado.
    expect(on?.state).toBe('firing');
    expect(on?.threshold).toBe(2);
    expect((await updateAlert(project.id, alert.id, { email: false }))?.email).toBe(false);
    expect((await getAlert(project.id, alert.id))?.email).toBe(false);
  });

  it('no manda email a quien ya no está en el workspace', async () => {
    const { user, project, insight } = await setup();
    const stranger = await upsertUser({ email: `pulse-alert-stranger-${nanoid(8)}@test.dev` });
    const alert = await createAlert(project.id, user.id, { ...base, name: 'Y', insightId: insight.id, email: true, subscribers: [stranger.id] });
    if (typeof alert === 'string') throw new Error(alert);
    await runAlertsCron({ now: NOW });
    expect(mailsTo(stranger.email)).toHaveLength(0);
  });
});
