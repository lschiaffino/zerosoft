import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db';
import { seal } from '@/lib/secret-box';
import {
  createActivity,
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  deleteContact,
  listTimeline,
  updateContact,
  updateStage,
} from '@/lib/crm';
import { acceptQuote, addLineItem, createQuote, getPublicQuote, markQuoteSent, updateQuote } from '@/lib/crm-products';
import { claimDelivery, emitWebhook, listDeliveries, resendDelivery, retryDueWebhooks } from '@/lib/webhooks';
import { matchesCrmFilter, normalizeCrmFilter, parseCrmFilter, WEBHOOK_EVENTS } from '@/lib/webhooks-events';
import {
  isAutomationHookUrl,
  isSlackWebhookUrl,
  maskSecret,
  slackText,
  withZoomLine,
} from '@/lib/crm-apps-schema';
import {
  AppError,
  connectAutomation,
  connectSlack,
  connectStripe,
  connectZoom,
  createZoomForActivity,
  disconnectApp,
  handleStripeAppWebhook,
  listApps,
  notifyApps,
  setStripeWebhookSecret,
} from '@/lib/crm-apps';
import { signStripePayload } from '@/lib/calendar-payments';
import { cleanSignatureImage, getQuoteSignature, quoteContentHash, signatureCertificate } from '@/lib/crm-quote-sign';
import { canPayQuote, createQuoteCheckout, reconcileQuoteCheckout } from '@/lib/crm-quote-pay';
import { buildPdf, jpegSize, wrapText } from '@/lib/pdf-lite';
import {
  dealNameFor,
  formSteps,
  isFieldVisible,
  ownerFromRules,
  validateSubmission,
  DEFAULT_FORM_SETTINGS,
  type FormField,
} from '@/lib/crm-forms-schema';
import { createForm, submitForm, toPublicForm } from '@/lib/crm-forms';
import { clampSeconds, fmtDuration, mergePages, topPages, watchedPct } from '@/lib/crm-media-schema';
import {
  createDocument,
  createDocumentLink,
  createVideo,
  isOwnUploadUrl,
  listDocumentLinks,
  searchMedia,
  trackDocumentView,
  trackVideoView,
} from '@/lib/crm-media';
import { makeUser } from './helpers';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Webhook directo en la base: las entregas quedan registradas aunque la URL no responda. */
async function hook(userId: string, events: string[], crmFilter: unknown = null): Promise<string> {
  const id = crypto.randomUUID();
  await getDb()
    .prepare('INSERT INTO webhooks (id, user_id, url, events, secret, crm_filter) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, 'https://127.0.0.1/hook', JSON.stringify(events), seal('whsec_test'), crmFilter ? JSON.stringify(crmFilter) : null);
  return id;
}

async function deliveries(hookId: string): Promise<Array<{ event: string; payload: Record<string, unknown> }>> {
  const rows = (await getDb()
    .prepare('SELECT event, payload FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at, rowid')
    .all(hookId)) as Array<{ event: string; payload: string }>;
  return rows.map((r) => ({ event: r.event, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

async function stageOf(dealId: string): Promise<string | undefined> {
  return ((await getDb().prepare('SELECT stage_id FROM crm_deals WHERE id = ?').get(dealId)) as { stage_id: string } | undefined)?.stage_id;
}

async function pipelineFor(userId: string) {
  const p = await createPipeline(userId, 'Sales');
  const open = await createStage(userId, p.id, { name: 'New' });
  const won = await createStage(userId, p.id, { name: 'Won', probability: 100 });
  await updateStage(userId, won!.id, { isWon: true });
  return { pipelineId: p.id, stageId: open!.id, wonStageId: won!.id };
}

async function sentQuote(userId: string) {
  const { pipelineId, stageId, wonStageId } = await pipelineFor(userId);
  const res = await createDeal(userId, { name: 'Big deal', pipelineId, stageId, currency: 'USD' });
  if (!res.ok) throw new Error(res.reason);
  await addLineItem(userId, res.deal.id, { name: 'Pro', unitPrice: 100, quantity: 2 });
  const q = await createQuote(userId, res.deal.id, { terms: 'Net 30', recipientEmail: 'ana@buyer.dev' }, userId);
  if (!q.ok) throw new Error(q.error);
  await markQuoteSent(userId, q.quote.id);
  return { deal: res.deal, quote: q.quote, wonStageId };
}

/** JPEG mínimo para los chequeos (SOI + SOF0 con 64x32). */
function fakeJpeg(width = 64, height = 32): Buffer {
  const b = Buffer.alloc(40, 0);
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08], 0);
  b.writeUInt16BE(height, 7);
  b.writeUInt16BE(width, 9);
  return b;
}
const SIGNATURE = `data:image/jpeg;base64,${fakeJpeg().toString('base64')}`;

// ============================================================
// Webhooks salientes
// ============================================================

describe('webhooks del CRM: eventos, filtro de propiedades, claim y reenvío', () => {
  it('el catálogo suma empresa, tareas, cambio de propiedad, borrados, cotizaciones y formularios', () => {
    for (const ev of ['company.created', 'company.deleted', 'contact.property_changed', 'deal.deleted', 'task.created', 'quote.paid', 'form.submitted']) {
      expect(WEBHOOK_EVENTS).toContain(ev);
    }
  });

  it('el filtro de propiedades solo deja pasar esas propiedades y no toca otros eventos', () => {
    const f = normalizeCrmFilter({ properties: ['lifecycle_stage', ' custom.plan ', 'bad name!', 'lifecycle_stage'] });
    expect(f).toEqual({ properties: ['lifecycle_stage', 'custom.plan'] });
    expect(normalizeCrmFilter({ properties: [] })).toBeNull();
    expect(parseCrmFilter('{oops')).toBeNull();
    expect(matchesCrmFilter(f, 'contact.property_changed', { property: 'custom.plan' })).toBe(true);
    expect(matchesCrmFilter(f, 'contact.property_changed', { property: 'city' })).toBe(false);
    expect(matchesCrmFilter(f, 'contact.created', { property: 'city' })).toBe(true);
    expect(matchesCrmFilter(null, 'deal.property_changed', {})).toBe(true);
  });

  it('cambiar un contacto emite un property_changed por propiedad, respetando el filtro', async () => {
    const u = await makeUser('wh-prop');
    const all = await hook(u.id, ['contact.property_changed']);
    const onlyCity = await hook(u.id, ['contact.property_changed'], { properties: ['city'] });
    const c = await createContact(u.id, { firstName: 'Ada', email: 'ada@x.dev' });
    await updateContact(u.id, c.id, { city: 'Córdoba', jobTitle: 'CTO' }, undefined, 'me@x.dev');
    const got = await deliveries(all);
    expect(got.map((d) => (d.payload.data as { property: string }).property).sort()).toEqual(['city', 'job_title']);
    const city = (got.find((d) => (d.payload.data as { property: string }).property === 'city')!.payload.data) as Record<string, unknown>;
    expect(city).toMatchObject({ objectType: 'contact', id: c.id, oldValue: '', newValue: 'Córdoba', changedBy: 'me@x.dev' });
    expect((await deliveries(onlyCity)).map((d) => (d.payload.data as { property: string }).property)).toEqual(['city']);
  });

  it('empresas creadas y contactos borrados salen como webhooks', async () => {
    const u = await makeUser('wh-co');
    const h = await hook(u.id, ['company.created', 'contact.deleted']);
    const co = await createCompany(u.id, { name: 'Acme' });
    const c = await createContact(u.id, { firstName: 'Bo', email: 'bo@x.dev' });
    await deleteContact(u.id, c.id, 'admin@x.dev');
    const got = await deliveries(h);
    expect(got.map((d) => d.event)).toEqual(['company.created', 'contact.deleted']);
    expect(got[0].payload.data).toMatchObject({ id: co.id, name: 'Acme' });
    expect(got[0].payload.data).not.toHaveProperty('user_id');
    expect(got[1].payload.data).toMatchObject({ id: c.id, deletedBy: 'admin@x.dev' });
  });

  it('el claim por entrega evita que dos corridas del cron manden lo mismo', async () => {
    const u = await makeUser('wh-claim');
    const h = await hook(u.id, ['contact.created']);
    await emitWebhook(u.id, 'contact.created', { id: 'c1' });
    const row = (await getDb().prepare('SELECT id, attempts, status FROM webhook_deliveries WHERE webhook_id = ?').get(h)) as {
      id: string;
      attempts: number;
      status: string;
    };
    // 127.0.0.1 es privada: el primer intento falla y queda pendiente con backoff.
    expect(row).toMatchObject({ attempts: 1, status: 'pending' });
    await getDb().prepare('UPDATE webhook_deliveries SET next_attempt_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), row.id);
    const later = new Date();
    const [a, b] = await Promise.all([retryDueWebhooks(50, later), retryDueWebhooks(50, later)]);
    expect(a + b).toBeGreaterThanOrEqual(1);
    const after = (await getDb().prepare('SELECT attempts FROM webhook_deliveries WHERE id = ?').get(row.id)) as { attempts: number };
    expect(after.attempts).toBe(2);
    // Un claim vigente no se puede volver a tomar.
    await getDb().prepare("UPDATE webhook_deliveries SET claimed_until = ? WHERE id = ?").run(new Date(Date.now() + 60_000).toISOString(), row.id);
    expect(await claimDelivery(row.id)).toBe(false);
  });

  it('el log de entregas es del workspace y reenviar crea una entrega nueva con el mismo cuerpo', async () => {
    const u = await makeUser('wh-log');
    const other = await makeUser('wh-log-2');
    const h = await hook(u.id, ['deal.won']);
    await emitWebhook(u.id, 'deal.won', { id: 'd1', name: 'X' });
    const list = await listDeliveries(u.id, h);
    expect(list).toHaveLength(1);
    expect(list![0]).toMatchObject({ event: 'deal.won', status: 'pending', attempts: 1, error: 'private_host' });
    expect(await listDeliveries(other.id, h)).toBeNull();
    expect(await resendDelivery(other.id, list![0].id)).toBeNull();
    const again = await resendDelivery(u.id, list![0].id);
    expect(again).toBeTruthy();
    const both = await listDeliveries(u.id, h);
    expect(both).toHaveLength(2);
    expect(both![0].payload).toBe(both![1].payload);
  });
});

// ============================================================
// Apps
// ============================================================

describe('apps del CRM: Slack, Zoom, Stripe, Zapier y Make', () => {
  it('lógica pura: URLs válidas, textos de Slack y la línea de Zoom', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T0/B0/abc123')).toBe(true);
    expect(isSlackWebhookUrl('https://evil.dev/services/T0/B0/abc')).toBe(false);
    expect(isAutomationHookUrl('zapier', 'https://hooks.zapier.com/hooks/catch/1/abc/')).toBe(true);
    expect(isAutomationHookUrl('zapier', 'http://hooks.zapier.com/hooks/catch/1/abc/')).toBe(false);
    expect(isAutomationHookUrl('make', 'https://hook.eu1.make.com/abc')).toBe(true);
    expect(isAutomationHookUrl('make', 'https://make.com.evil.dev/abc')).toBe(false);
    expect(maskSecret('sk_test_1234567890abcdef')).toBe('sk_test_…cdef');
    const won = slackText('deal.won', { id: 'd1', name: 'Acme <Pro>', amount: 1200, currency: 'USD' }, 'https://zs.dev/');
    expect(won).toContain('<https://zs.dev/en/app/crm/deals/d1|Acme &lt;Pro&gt;>');
    expect(won).toContain('$1,200.00');
    expect(slackText('form.submitted', { form: { name: 'Demo' }, contact: { id: 'c1', email: 'a@b.c' } }, 'https://zs.dev')).toContain('Form "Demo"');
    expect(slackText('link.clicked', {}, 'https://zs.dev')).toBeNull();
    expect(withZoomLine('Agenda\nZoom: https://zoom.us/j/1', 'https://zoom.us/j/2')).toBe('Zoom: https://zoom.us/j/2\nAgenda');
  });

  it('Slack: valida la URL, avisa solo los eventos elegidos y se desconecta', async () => {
    vi.stubEnv('CRM_APPS_FAKE', '1');
    const u = await makeUser('slack');
    await expect(connectSlack(u.id, { webhookUrl: 'https://example.com/x' }, u.id)).rejects.toThrow('invalid_slack_url');
    await connectSlack(u.id, { webhookUrl: 'https://hooks.slack.com/services/T1/B1/secret', events: ['deal.won'] }, u.id);
    await notifyApps(u.id, 'deal.won', { id: 'd1', name: 'Acme', amount: 10, currency: 'USD' });
    await notifyApps(u.id, 'deal.lost', { id: 'd1', name: 'Acme' });
    const slack = (await listApps(u.id)).find((a) => a.key === 'slack')!;
    expect(slack.connected).toBe(true);
    expect(slack.hint).not.toContain('secret');
    expect(slack.log.map((l) => l.event)).toEqual(['deal.won', 'connected']);
    // El secreto se guarda cifrado.
    const raw = (await getDb().prepare("SELECT secrets FROM crm_apps WHERE user_id = ? AND app = 'slack'").get(u.id)) as { secrets: string };
    expect(raw.secrets.startsWith('enc:v1:')).toBe(true);
    expect(await disconnectApp(u.id, 'slack')).toBe(true);
    expect((await listApps(u.id)).find((a) => a.key === 'slack')!.connected).toBe(false);
  });

  it('Zoom: crea el link en una reunión y rechaza otras actividades', async () => {
    vi.stubEnv('CRM_APPS_FAKE', '1');
    const u = await makeUser('zoom');
    const meeting = await createActivity(u.id, { type: 'meeting', subject: 'Demo', body: 'Agenda' });
    const note = await createActivity(u.id, { type: 'note', subject: 'Nota' });
    await expect(createZoomForActivity(u.id, meeting.id)).rejects.toThrow('zoom_not_connected');
    await connectZoom(u.id, { accountId: 'acc', clientId: 'cid', clientSecret: 'sec' }, u.id);
    const { joinUrl } = await createZoomForActivity(u.id, meeting.id);
    expect(joinUrl).toMatch(/^https:\/\/zoom\.us\/j\/\d+/);
    const body = ((await getDb().prepare('SELECT body FROM crm_activities WHERE id = ?').get(meeting.id)) as { body: string }).body;
    expect(body).toBe(`Zoom: ${joinUrl}\nAgenda`);
    await expect(createZoomForActivity(u.id, note.id)).rejects.toThrow('not_a_meeting');
    const other = await makeUser('zoom-2');
    await connectZoom(other.id, { accountId: 'a', clientId: 'b', clientSecret: 'c' }, other.id);
    await expect(createZoomForActivity(other.id, meeting.id)).rejects.toThrow('not_found');
  });

  it('Stripe: webhook firmado, pagos al timeline, deal ganado por metadata y eventos repetidos', async () => {
    vi.stubEnv('CRM_APPS_FAKE', '1');
    const u = await makeUser('stripe');
    await expect(connectStripe(u.id, { secretKey: 'nope' }, u.id)).rejects.toBeInstanceOf(AppError);
    await connectStripe(u.id, { secretKey: 'sk_test_abcdefghijkl' }, u.id);
    await setStripeWebhookSecret(u.id, 'whsec_testsecret');
    const app = (await listApps(u.id)).find((a) => a.key === 'stripe')!;
    const token = app.webhookUrl!.split('/').pop()!;
    const { pipelineId, stageId, wonStageId } = await pipelineFor(u.id);
    const deal = await createDeal(u.id, { name: 'Stripe deal', pipelineId, stageId });
    if (!deal.ok) throw new Error('deal');
    const event = {
      id: 'evt_1',
      type: 'charge.succeeded',
      data: { object: { id: 'ch_1', amount: 4900, currency: 'usd', billing_details: { email: 'buyer@pay.dev' }, metadata: { deal_id: deal.deal.id } } },
    };
    const raw = JSON.stringify(event);
    await expect(handleStripeAppWebhook(token, raw, 'bad')).rejects.toThrow('invalid_signature');
    expect(await handleStripeAppWebhook(token, raw, signStripePayload(raw, 'whsec_testsecret'))).toBe('payment');
    expect(await handleStripeAppWebhook(token, raw, signStripePayload(raw, 'whsec_testsecret'))).toBe('duplicate');
    expect(await stageOf(deal.deal.id)).toBe(wonStageId);
    const contact = (await getDb().prepare("SELECT id FROM crm_contacts WHERE user_id = ? AND email = 'buyer@pay.dev'").get(u.id)) as { id: string };
    const timeline = await listTimeline(u.id, { contactId: contact.id });
    expect(timeline.some((a) => a.subject === 'Payment received: $49.00')).toBe(true);
    const cust = JSON.stringify({ id: 'evt_2', type: 'customer.created', data: { object: { email: 'new@pay.dev', name: 'New Buyer' } } });
    expect(await handleStripeAppWebhook(token, cust, signStripePayload(cust, 'whsec_testsecret'))).toBe('contact');
    await expect(handleStripeAppWebhook('nope', cust, null)).rejects.toThrow('not_found');
  });

  it('Zapier y Make: conectar crea un webhook del workspace a su URL y desconectar lo borra', async () => {
    vi.stubEnv('ALLOW_PRIVATE_WEBHOOKS', 'true');
    const u = await makeUser('zap');
    await expect(connectAutomation(u.id, 'zapier', { hookUrl: 'https://example.com/x' }, u.id)).rejects.toThrow('invalid_zapier_url');
    await connectAutomation(u.id, 'zapier', { hookUrl: 'https://hooks.zapier.com/hooks/catch/1/abc/' }, u.id);
    const hooks = (await getDb().prepare('SELECT id, url, events FROM webhooks WHERE user_id = ?').all(u.id)) as Array<{ id: string; url: string; events: string }>;
    expect(hooks).toHaveLength(1);
    expect(JSON.parse(hooks[0].events)).toContain('deal.won');
    await disconnectApp(u.id, 'zapier');
    expect(await getDb().prepare('SELECT 1 FROM webhooks WHERE user_id = ?').get(u.id)).toBeUndefined();
  });
});

// ============================================================
// Firma y cobro de cotizaciones
// ============================================================

describe('cotizaciones: firma electrónica, certificado y cobro con Stripe', () => {
  it('PDF mínimo: tamaño de JPEG, cortes de línea y estructura', () => {
    expect(jpegSize(fakeJpeg(120, 40))).toEqual({ width: 120, height: 40 });
    expect(jpegSize(Buffer.from('nope'))).toBeNull();
    expect(wrapText('a '.repeat(200), 10).length).toBeGreaterThan(1);
    const pdf = buildPdf({ title: 'T', lines: [{ text: 'Hola (mundo) \\ ñ' }] });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('(Hola \\(mundo\\) \\\\ ñ)');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('la firma valida la imagen, guarda nombre, email, IP, navegador y hash del contenido', async () => {
    const u = await makeUser('sign');
    const { quote } = await sentQuote(u.id);
    expect(cleanSignatureImage('data:image/png;base64,AAAA')).toBe('');
    expect(cleanSignatureImage(SIGNATURE)).toBe(SIGNATURE);
    expect(await acceptQuote(quote.token, { name: 'Ana', agree: true, ip: '1.2.3.4', signature: 'data:image/png;base64,x' })).toEqual({
      ok: false,
      error: 'invalid_signature',
    });
    await getPublicQuote(quote.token);
    const res = await acceptQuote(quote.token, {
      name: 'Ana Pérez',
      agree: true,
      ip: '1.2.3.4',
      email: 'Ana@Buyer.dev',
      signature: SIGNATURE,
      userAgent: 'Vitest',
    });
    expect(res.ok).toBe(true);
    const sig = (await getQuoteSignature(quote.id))!;
    expect(sig).toMatchObject({ signer_name: 'Ana Pérez', signer_email: 'ana@buyer.dev', ip: '1.2.3.4', user_agent: 'Vitest' });
    const row = (await getDb().prepare('SELECT * FROM crm_quotes WHERE id = ?').get(quote.id)) as Parameters<typeof quoteContentHash>[0];
    expect(sig.content_hash).toBe(quoteContentHash(row));
    expect(sig.content_hash).toMatch(/^[0-9a-f]{64}$/);
    const pub = await getPublicQuote(quote.token);
    expect(pub?.signature_image).toBe(SIGNATURE);
    const pdf = signatureCertificate(row as never, sig, 'https://zs.dev/en/q/x').toString('latin1');
    expect(pdf).toContain(sig.content_hash);
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain('The quote has not changed since it was signed.');
  });

  it('cobro: solo firmada, con cobro activo y Stripe conectado; pagar marca pagada, ganado y quote.paid', async () => {
    vi.stubEnv('CRM_APPS_FAKE', '1');
    const u = await makeUser('pay');
    const h = await hook(u.id, ['quote.paid']);
    const { quote, deal, wonStageId } = await sentQuote(u.id);
    await acceptQuote(quote.token, { name: 'Ana', agree: true, ip: '1.1.1.1', signature: SIGNATURE });
    const row = () => getDb().prepare('SELECT * FROM crm_quotes WHERE id = ?').get(quote.id) as Promise<Parameters<typeof canPayQuote>[0] & { payment_status: string; stripe_session_id: string | null }>;
    expect(await canPayQuote(await row())).toBe(false);
    expect((await updateQuote(u.id, quote.id, { collectPayment: true })).ok).toBe(true);
    expect(await canPayQuote(await row())).toBe(false); // falta Stripe
    await expect(createQuoteCheckout(quote.token, { origin: 'https://zs.dev', locale: 'es' })).rejects.toThrow('payment_unavailable');
    await connectStripe(u.id, { secretKey: 'sk_test_abcdefghijkl' }, u.id);
    expect(await canPayQuote(await row())).toBe(true);
    const url = await createQuoteCheckout(quote.token, { origin: 'https://zs.dev', locale: 'es' });
    expect(url).toBe(`https://zs.dev/es/q/${quote.token}?paid=1&session_id=fake_${quote.id}`);
    expect(await reconcileQuoteCheckout(quote.token, 'fake_other')).toBe(false);
    expect(await reconcileQuoteCheckout(quote.token, `fake_${quote.id}`)).toBe(true);
    expect(await reconcileQuoteCheckout(quote.token, `fake_${quote.id}`)).toBe(false);
    expect((await row()).payment_status).toBe('paid');
    expect(await stageOf(deal.id)).toBe(wonStageId);
    expect((await deliveries(h)).map((d) => d.event)).toEqual(['quote.paid']);
    // Pagada ya no se puede apagar el cobro.
    expect(await updateQuote(u.id, quote.id, { collectPayment: false })).toEqual({ ok: false, error: 'not_draft' });
  });
});

// ============================================================
// Formularios: pasos, lógica condicional, reglas de dueño, deal y CAPTCHA
// ============================================================

describe('formularios: pasos, condiciones, dueño por reglas, deal y CAPTCHA', () => {
  const FIELDS: FormField[] = [
    { id: 'email', type: 'email', label: 'Email', property: 'email', required: true },
    { id: 'kind', type: 'select', label: 'Kind', property: '', required: true, options: ['Company', 'Personal'] },
    { id: 's2', type: 'step', label: 'Company details', property: '', required: false },
    { id: 'company', type: 'text', label: 'Company', property: 'company.name', required: true, showIf: { field: 'kind', op: 'equals', value: 'company' } },
    { id: 'size', type: 'text', label: 'Size', property: '', required: false, showIf: { field: 'company', op: 'filled' } },
  ];

  it('visibilidad encadenada, pasos y validación que no exige lo oculto', () => {
    expect(isFieldVisible(FIELDS[3], { kind: 'Company' }, FIELDS)).toBe(true);
    expect(isFieldVisible(FIELDS[3], { kind: 'Personal' }, FIELDS)).toBe(false);
    expect(isFieldVisible(FIELDS[4], { kind: 'Personal', company: 'Acme' }, FIELDS)).toBe(false);
    expect(isFieldVisible(FIELDS[4], { kind: 'Company', company: 'Acme' }, FIELDS)).toBe(true);
    const steps = formSteps(FIELDS);
    expect(steps.map((s) => [s.title, s.fields.map((f) => f.id)])).toEqual([
      ['', ['email', 'kind']],
      ['Company details', ['company', 'size']],
    ]);
    const personal = validateSubmission(FIELDS, DEFAULT_FORM_SETTINGS, { values: { email: 'a@b.co', kind: 'Personal', company: 'Leak' } });
    expect(personal.errors).toEqual({});
    expect(personal.values.company).toBe('');
    expect(personal.values).not.toHaveProperty('s2');
    const company = validateSubmission(FIELDS, DEFAULT_FORM_SETTINGS, { values: { email: 'a@b.co', kind: 'Company' } });
    expect(company.errors).toEqual({ company: 'required' });
  });

  it('reglas de dueño y nombre del deal', () => {
    expect(ownerFromRules([{ field: 'kind', value: 'company', ownerId: 'u1' }], { kind: 'Company' })).toBe('u1');
    expect(ownerFromRules([{ field: 'kind', value: 'company', ownerId: 'u1' }], { kind: 'Personal' })).toBe('');
    expect(dealNameFor('{name} · {form}', { name: 'Ada', email: '', company: '', form: 'Demo' })).toBe('Ada · Demo');
    expect(dealNameFor('{name} · {form}', { name: '', email: '', company: '', form: 'Demo' })).toBe('Demo');
  });

  it('un envío crea el deal en la etapa elegida, asigna por regla y exige el CAPTCHA', async () => {
    vi.stubEnv('CAPTCHA_FAKE', '1');
    const u = await makeUser('form-c5');
    const { pipelineId, stageId } = await pipelineFor(u.id);
    const form = await createForm(u.id, {
      name: 'Demo request',
      fields: FIELDS,
      settings: {
        captcha: true,
        minSubmitSeconds: 0,
        createDeal: true,
        dealPipelineId: pipelineId,
        dealStageId: stageId,
        ownerRules: [{ field: 'kind', value: 'Company', ownerId: u.id }],
      },
    });
    expect(toPublicForm(form).captchaSiteKey).toBe('fake');
    const body = { values: { email: 'lead@corp.dev', kind: 'Company', company: 'Corp' } };
    expect(await submitForm(form.token, body)).toEqual({ ok: false, error: 'captcha' });
    const res = await submitForm(form.token, { ...body, captchaToken: 'fake-pass' });
    expect(res.ok).toBe(true);
    const deal = (await getDb()
      .prepare('SELECT d.* FROM crm_deals d JOIN crm_deal_contacts dc ON dc.deal_id = d.id WHERE d.user_id = ? AND dc.contact_id = ?')
      .get(u.id, res.ok ? (res.contactId ?? '') : '')) as { name: string; stage_id: string; owner_id: string } | undefined;
    expect(deal).toMatchObject({ stage_id: stageId, name: 'lead@corp.dev · Demo request', owner_id: u.id });
    await expect(createForm(u.id, { name: 'Bad', settings: { createDeal: true, dealPipelineId: pipelineId, dealStageId: 'nope' } })).rejects.toThrow(
      'invalid_stage',
    );
  });
});

// ============================================================
// Documentos con seguimiento y videos 1:1
// ============================================================

describe('documentos y videos: seguimiento en el timeline', () => {
  it('lógica pura de tiempos y páginas', () => {
    expect(mergePages({ '1': 10 }, { '1': 5, '2': 7, '99': 3, x: 1 } as Record<string, number>, 3)).toEqual({ '1': 10, '2': 7 });
    expect(clampSeconds(10, 500, 5)).toBe(70);
    expect(clampSeconds(10, 12, 5)).toBe(12);
    expect(clampSeconds(10, 3, 5)).toBe(10);
    expect(fmtDuration(75)).toBe('1m 15s');
    expect(fmtDuration(3700)).toBe('1h 1m');
    expect(topPages({ '1': 3, '2': 9, '3': 0 })).toEqual([
      [2, 9],
      [1, 3],
    ]);
    expect(watchedPct(30, 60)).toBe(50);
    expect(watchedPct(30, 0)).toBe(0);
    expect(isOwnUploadUrl('/uploads/crm/a.pdf')).toBe(true);
    expect(isOwnUploadUrl('/uploads/../etc/passwd')).toBe(false);
    expect(isOwnUploadUrl('https://abc.public.blob.vercel-storage.com/crm/a.pdf')).toBe(true);
    expect(isOwnUploadUrl('https://evil.dev/crm/a.pdf')).toBe(false);
  });

  it('un link por contacto; abrir deja actividad y aviso, y los pings suman tiempo por página', async () => {
    const u = await makeUser('docs');
    const c = await createContact(u.id, { firstName: 'Lu', email: 'lu@x.dev' });
    await expect(createDocument(u.id, { name: 'X', filename: 'x.pdf', url: 'https://evil.dev/x.pdf', size: 1, createdBy: u.id })).rejects.toThrow(
      'invalid_file',
    );
    const doc = await createDocument(u.id, { name: '', filename: 'Proposal.pdf', url: '/uploads/crm/p.pdf', size: 1000, createdBy: u.id });
    expect(doc.name).toBe('Proposal');
    const link = await createDocumentLink(u.id, doc.id, { contactId: c.id, createdBy: u.id });
    expect(await createDocumentLink(u.id, doc.id, { contactId: c.id, createdBy: u.id })).toEqual(link);
    const other = await makeUser('docs-2');
    await expect(createDocumentLink(other.id, doc.id, { createdBy: other.id })).rejects.toThrow('not_found');
    const v = await trackDocumentView(link.token, { pageCount: 3, ip: '9.9.9.9' });
    expect(v?.viewId).toBeTruthy();
    await trackDocumentView(link.token, { viewId: v!.viewId, seconds: 20, pages: { '1': 5, '2': 15 }, pageCount: 3 });
    const [l] = await listDocumentLinks(u.id, doc.id);
    expect(l).toMatchObject({ views: 1, seconds: 20, pages: { '1': 5, '2': 15 }, contact_name: 'Lu' });
    const timeline = await listTimeline(u.id, { contactId: c.id });
    const act = timeline.find((a) => a.subject === 'Viewed document: Proposal');
    expect(act?.body).toContain('Time viewing: 20s');
    expect(act?.body).toContain('p.2 15s');
    expect(await trackDocumentView('nope-token-123', {})).toBeNull();
    expect((await searchMedia(u.id, 'propo')).map((m) => m.kind)).toEqual(['document']);
  });

  it('video: la reproducción queda en el contacto con cuánto se vio', async () => {
    const u = await makeUser('video');
    const c = await createContact(u.id, { firstName: 'Mo', email: 'mo@x.dev' });
    const video = await createVideo(u.id, {
      title: 'Intro for Mo',
      url: '/uploads/crm/v.webm',
      contentType: 'video/webm',
      size: 500,
      durationSec: 60,
      contactId: c.id,
      createdBy: u.id,
    });
    const v = await trackVideoView(video.token, { duration: 60 });
    await trackVideoView(video.token, { viewId: v!.viewId, watched: 30, position: 45, duration: 60 });
    const timeline = await listTimeline(u.id, { contactId: c.id });
    expect(timeline.find((a) => a.subject === 'Watched video: Intro for Mo')?.body).toBe('Watched 30s of 1m (75%)');
    const views = (await getDb().prepare('SELECT watched_sec, max_position FROM crm_video_views WHERE video_id = ?').all(video.id)) as Array<{
      watched_sec: number;
      max_position: number;
    }>;
    expect(views).toEqual([{ watched_sec: 30, max_position: 45 }]);
  });
});
