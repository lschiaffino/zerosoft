import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContact } from '@/lib/crm';
import { getDb, type CrmActivityRow, type CrmEmailRow } from '@/lib/db';
import { getIntegration, upsertIntegration } from '@/lib/integrations';
import { setAiModelOverride } from '@/lib/ai';
import { sendCrmEmail } from '@/lib/crm-email';
import {
  graphDate,
  graphMessagesDelta,
  graphToParsed,
  outlookAuthUrl,
  outlookScopeAllowsSend,
  OUTLOOK_PROVIDER,
} from '@/lib/microsoft';
import { FAKE_OUTLOOK_CONTACT, FAKE_OUTLOOK_EMAIL, fakeOutlookSent, resetFakeOutlook } from '@/lib/microsoft-fake';
import { getOutlookSync, storeOutlookEvent, syncOutlookMailbox } from '@/lib/crm-outlook-sync';
import {
  dialTwiml,
  e164,
  twilioSignature,
  validTwilioSignature,
  voiceAccessToken,
  voiceIdentity,
} from '@/lib/twilio-voice';
import {
  bindOutboundCall,
  createInboundCall,
  createOutboundCall,
  finishCall,
  getCall,
  parseTranscript,
  saveVoiceSettings,
  speakerForTrack,
  summarizeIfReady,
  VoiceError,
  withCallDetails,
} from '@/lib/crm-voice';
import { runFakeVoiceAction } from '@/lib/crm-voice-fake';
import { makeUser } from './helpers';
import { mockModel } from './ai-mock';

const ENV = ['MS_GRAPH_FAKE', 'CRM_VOICE_FAKE', 'TWILIO_API_KEY_SID', 'TWILIO_API_KEY_SECRET', 'TWILIO_ACCOUNT_SID', 'TWILIO_TWIML_APP_SID', 'TWILIO_AUTH_TOKEN', 'AI_GATEWAY_API_KEY', 'NEXTAUTH_URL'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.MS_GRAPH_FAKE = '1';
  process.env.CRM_VOICE_FAKE = '1';
  delete process.env.AI_GATEWAY_API_KEY;
  resetFakeOutlook();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  setAiModelOverride(null);
  vi.restoreAllMocks();
});

async function connectOutlook(personId: string, expired = false) {
  await upsertIntegration({
    userId: personId,
    provider: OUTLOOK_PROVIDER,
    email: FAKE_OUTLOOK_EMAIL,
    accessToken: 'fake-ms-access-1',
    refreshToken: 'fake-ms-refresh',
    expiresAt: expired ? Date.now() - 1000 : Date.now() + 3_600_000,
    scope: 'openid email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.Read',
  });
}

async function emailsOf(userId: string): Promise<CrmEmailRow[]> {
  return (await getDb().prepare('SELECT * FROM crm_emails WHERE user_id = ? ORDER BY sent_at ASC').all(userId)) as CrmEmailRow[];
}

async function meetingsOf(userId: string): Promise<CrmActivityRow[]> {
  return (await getDb().prepare("SELECT * FROM crm_activities WHERE user_id = ? AND type = 'meeting'").all(userId)) as CrmActivityRow[];
}

describe('Microsoft Graph (puro)', () => {
  it('pasa un mensaje de Graph al formato del sync y lee fechas UTC', () => {
    const parsed = graphToParsed(
      {
        id: 'AAMk1',
        conversationId: 'conv',
        internetMessageId: '<x@y>',
        subject: 'Hola',
        bodyPreview: 'pre',
        body: { contentType: 'html', content: '<p>Hola</p>' },
        from: { emailAddress: { address: 'ana@x.test', name: 'Ana' } },
        toRecipients: [{ emailAddress: { address: 'me@y.test' } }],
        receivedDateTime: '2026-10-01T10:00:00Z',
      },
      'sentitems',
    );
    expect(parsed).toMatchObject({ id: 'AAMk1', threadId: 'conv', from: 'Ana <ana@x.test>', to: 'me@y.test', html: '<p>Hola</p>', labelIds: ['SENT'] });
    expect(graphDate({ dateTime: '2026-10-25T15:00:00.0000000', timeZone: 'UTC' })?.toISOString()).toBe('2026-10-25T15:00:00.000Z');
    expect(outlookScopeAllowsSend('openid Mail.Send')).toBe(true);
    expect(outlookScopeAllowsSend('https://graph.microsoft.com/Mail.Send')).toBe(true);
    expect(outlookScopeAllowsSend('Mail.Read')).toBe(false);
  });

  it('en modo fake el OAuth vuelve directo al callback con el state', () => {
    const url = new URL(outlookAuthUrl('p1.abc'));
    expect(url.pathname).toBe('/api/integrations/outlook/callback');
    expect(url.searchParams.get('state')).toBe('p1.abc');
  });

  it('nunca manda el token a una URL que no sea de Graph', async () => {
    await expect(graphMessagesDelta('fake-ms-access-1', 'inbox', 'https://evil.test/steal')).rejects.toMatchObject({
      message: 'invalid_url',
    });
  });
});

describe('Sync de Outlook', () => {
  it('trae emails y reuniones con contactos; después solo cambios', async () => {
    const u = await makeUser('ol');
    await connectOutlook(u.id);
    const ana = await createContact(u.id, { firstName: 'Ana', email: FAKE_OUTLOOK_CONTACT });

    const first = await syncOutlookMailbox(u.id, u.id);
    expect(first).toMatchObject({ status: 'ok', stored: 2, meetings: 1 });
    const rows = await emailsOf(u.id);
    expect(rows.map((r) => [r.direction, r.source, r.thread_id, r.contact_id])).toEqual([
      ['in', 'outlook', 'fake-conv-1', ana.id],
      ['out', 'outlook', 'fake-conv-1', ana.id],
    ]);
    const meetings = await meetingsOf(u.id);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]).toMatchObject({ contact_id: ana.id, subject: 'Pricing review with Ana', duration_min: 30, owner_id: u.id, done: 0 });
    expect(meetings[0].body).toContain('teams.microsoft.com');
    const state = await getOutlookSync(u.id, u.id);
    expect(state?.inbox_delta).toContain('fake-delta/inbox');
    expect(state?.calendar_delta).toContain('fake-delta/calendar');

    const second = await syncOutlookMailbox(u.id, u.id);
    expect(second).toMatchObject({ status: 'ok', stored: 0 });
    expect(await emailsOf(u.id)).toHaveLength(2);
    expect(await meetingsOf(u.id)).toHaveLength(1);
  });

  it('una reunión cancelada sale del timeline', async () => {
    const u = await makeUser('ol-cancel');
    await createContact(u.id, { firstName: 'Ana', email: FAKE_OUTLOOK_CONTACT });
    const ev = {
      id: 'e1',
      iCalUId: 'ical-x',
      subject: 'Demo',
      start: { dateTime: '2030-01-01T10:00:00' },
      end: { dateTime: '2030-01-01T11:00:00' },
      attendees: [{ emailAddress: { address: FAKE_OUTLOOK_CONTACT } }],
    };
    expect(await storeOutlookEvent(u.id, u.id, FAKE_OUTLOOK_EMAIL, ev)).toBe(true);
    expect(await meetingsOf(u.id)).toHaveLength(1);
    expect(await storeOutlookEvent(u.id, u.id, FAKE_OUTLOOK_EMAIL, { ...ev, subject: 'Demo (movida)' })).toBe(true);
    expect((await meetingsOf(u.id))[0].subject).toBe('Demo (movida)');
    await storeOutlookEvent(u.id, u.id, FAKE_OUTLOOK_EMAIL, { ...ev, isCancelled: true });
    expect(await meetingsOf(u.id)).toHaveLength(0);
  });

  it('sin Gmail, el CRM envía por Outlook, responde en el thread y el sync no duplica', async () => {
    const u = await makeUser('ol-send');
    await connectOutlook(u.id);
    const ana = await createContact(u.id, { firstName: 'Ana', email: FAKE_OUTLOOK_CONTACT });
    await syncOutlookMailbox(u.id, u.id);

    const res = await sendCrmEmail(u.id, {
      senderId: u.id,
      senderEmail: u.email,
      contactId: ana.id,
      to: FAKE_OUTLOOK_CONTACT,
      subject: 'Re: Question about the proposal',
      body: 'Te mando la propuesta.',
      threadId: 'fake-conv-1',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.via).toBe('outlook');
    expect(res.email).toMatchObject({ source: 'outlook', thread_id: 'fake-conv-1', from_email: FAKE_OUTLOOK_EMAIL });
    const sent = fakeOutlookSent().at(-1)!;
    expect(sent.conversationId).toBe('fake-conv-1');
    expect(sent.body.content).toContain('Te mando la propuesta.');
    expect(sent.body.content).toContain('/api/crm/t/o/');

    const again = await syncOutlookMailbox(u.id, u.id);
    expect(again.stored).toBe(0);
    expect((await emailsOf(u.id)).filter((e) => e.direction === 'out')).toHaveLength(2);
  });

  it('refresca el token vencido y lo guarda cifrado', async () => {
    const u = await makeUser('ol-refresh');
    await connectOutlook(u.id, true);
    const res = await syncOutlookMailbox(u.id, u.id);
    expect(res.status).toBe('ok');
    const raw = (await getDb()
      .prepare('SELECT access_token FROM integrations WHERE user_id = ? AND provider = ?')
      .get(u.id, OUTLOOK_PROVIDER)) as { access_token: string };
    expect(raw.access_token.startsWith('enc:v1:')).toBe(true);
    const integ = await getIntegration(u.id, OUTLOOK_PROVIDER);
    expect(integ?.access_token.startsWith('fake-ms-access-')).toBe(true);
    expect(integ!.expires_at).toBeGreaterThan(Date.now());
  });

  it('dos pasadas a la vez: la segunda queda bloqueada', async () => {
    const u = await makeUser('ol-lock');
    await connectOutlook(u.id);
    const [a, b] = await Promise.all([syncOutlookMailbox(u.id, u.id), syncOutlookMailbox(u.id, u.id)]);
    expect([a.status, b.status].sort()).toEqual(['locked', 'ok']);
  });
});

describe('Twilio Voice (puro)', () => {
  it('firma el access token con el API secret y los grants de voz', () => {
    process.env.TWILIO_API_KEY_SID = 'SKtest';
    process.env.TWILIO_API_KEY_SECRET = 'secret';
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_TWIML_APP_SID = 'APtest';
    const jwt = voiceAccessToken('zs_a_b', { now: 1_700_000_000_000, ttlSec: 600 });
    const [h, p, sig] = jwt.split('.');
    expect(createHmac('sha256', 'secret').update(`${h}.${p}`).digest('base64url')).toBe(sig);
    const header = JSON.parse(Buffer.from(h, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(header).toMatchObject({ alg: 'HS256', cty: 'twilio-fpa;v=1' });
    expect(payload).toMatchObject({
      iss: 'SKtest',
      sub: 'ACtest',
      exp: 1_700_000_600,
      grants: { identity: 'zs_a_b', voice: { incoming: { allow: true }, outgoing: { application_sid: 'APtest' } } },
    });
  });

  it('valida la firma de los webhooks', () => {
    process.env.TWILIO_AUTH_TOKEN = 'tok';
    const url = 'https://app.test/api/crm/voice/events?kind=dial&call=1';
    const params = { CallSid: 'CA1', DialCallStatus: 'completed', DialCallDuration: '42' };
    const sig = twilioSignature('tok', url, params);
    expect(validTwilioSignature(url, params, sig)).toBe(true);
    expect(validTwilioSignature(url, { ...params, DialCallDuration: '4200' }, sig)).toBe(false);
    expect(validTwilioSignature(url, params, null)).toBe(false);
    delete process.env.TWILIO_AUTH_TOKEN;
    expect(validTwilioSignature(url, params, sig)).toBe(false);
  });

  it('TwiML: graba con aviso solo si está activo y escapa el número', () => {
    const recorded = dialTwiml({ callId: 'c1', to: '+5491155550100', callerId: '+14155550100', record: true, consent: true, transcribe: true, language: 'es-US' });
    expect(recorded).toContain('record="record-from-answer-dual"');
    expect(recorded).toContain('<Number url="');
    expect(recorded).toContain('/api/crm/voice/consent?call=c1');
    expect(recorded).toContain('<Transcription');
    expect(recorded).toContain('languageCode="es-US"');
    const plain = dialTwiml({ callId: 'c2', to: '+1<x>', callerId: '+1', record: false, consent: true, transcribe: false, language: 'en-US' });
    expect(plain).not.toContain('record=');
    expect(plain).not.toContain('Transcription');
    expect(plain).toContain('<Number>+1&lt;x&gt;</Number>');
    const inbound = dialTwiml({ callId: 'c3', to: '', callerId: '', record: true, consent: true, consentText: 'Se graba', transcribe: false, language: 'es-US', clients: ['zs_a_b'] });
    expect(inbound).toContain('<Say language="es-MX">Se graba</Say>');
    expect(inbound).toContain('<Client>zs_a_b</Client>');
  });

  it('números E.164 e identidades', () => {
    expect(e164('+54 9 11 5555-0100')).toBe('+5491155550100');
    expect(e164('0054 11 5555 0100')).toBe('+541155550100');
    expect(e164('11 5555 0100')).toBeNull();
    expect(e164('+12')).toBeNull();
    expect(voiceIdentity('ab-12', 'cd-34')).toBe('zs_ab12_cd34');
    expect(speakerForTrack('outbound', 'inbound_track')).toBe('agent');
    expect(speakerForTrack('outbound', 'outbound_track')).toBe('contact');
    expect(speakerForTrack('inbound', 'inbound_track')).toBe('contact');
    expect(parseTranscript('agent: hola\nbasura\ncontact: chau\n')).toEqual([
      { speaker: 'agent', text: 'hola' },
      { speaker: 'contact', text: 'chau' },
    ]);
  });
});

describe('Llamadas desde el navegador', () => {
  async function setup(label: string) {
    const u = await makeUser(label);
    const contact = await createContact(u.id, { firstName: 'Bruno', phone: '+54 9 11 5555 0100' });
    await saveVoiceSettings(u.id, {
      callerId: `+1415${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
      recordCalls: true,
      consentEnabled: true,
      consentText: '',
      transcribe: true,
      language: 'en-US',
      inboundEnabled: true,
    });
    return { u, contact };
  }

  it('registra la llamada con duración, grabación y transcripción una sola vez', async () => {
    const { u, contact } = await setup('voice');
    const call = await createOutboundCall(u.id, u.id, { to: '+5491155550100', from: '+14155550000', contactId: contact.id, recorded: true });
    await runFakeVoiceAction(u.id, u.id, call.id, 'connect');
    await runFakeVoiceAction(u.id, u.id, call.id, 'answer');
    const done = await runFakeVoiceAction(u.id, u.id, call.id, 'hangup', 65);
    expect(done).toMatchObject({ status: 'completed', duration_sec: 65, transcript_status: 'done' });
    expect(done?.recording_sid).toMatch(/^REfake/);
    expect(parseTranscript(done!.transcript).map((l) => l.speaker)).toEqual(['agent', 'contact', 'agent']);

    const act = (await getDb().prepare('SELECT * FROM crm_activities WHERE id = ?').get(done!.activity_id)) as CrmActivityRow;
    expect(act).toMatchObject({ type: 'call', channel: 'browser', duration_min: 2, outcome: 'connected', contact_id: contact.id, owner_id: u.id });

    // Twilio reintenta el webhook: no se duplica la actividad.
    await finishCall(call.id, { status: 'completed', durationSec: 65 });
    const count = (await getDb().prepare("SELECT COUNT(*) AS n FROM crm_activities WHERE user_id = ? AND type = 'call'").get(u.id)) as { n: number };
    expect(count.n).toBe(1);

    const [withVoice] = await withCallDetails(u.id, [{ id: act.id, type: 'call' }]);
    expect(withVoice.voice).toMatchObject({ hasRecording: true, durationSec: 65 });
  });

  it('sin IA el resumen queda en ai_disabled; con IA va a la actividad', async () => {
    const { u, contact } = await setup('voice-ai');
    const call = await createOutboundCall(u.id, u.id, { to: '+5491155550100', from: '+1', contactId: contact.id, recorded: false });
    await runFakeVoiceAction(u.id, u.id, call.id, 'connect');
    await runFakeVoiceAction(u.id, u.id, call.id, 'answer');
    await runFakeVoiceAction(u.id, u.id, call.id, 'hangup', 30);
    await summarizeIfReady(call.id);
    expect((await getCall(u.id, call.id))?.summary_status).toBe('ai_disabled');

    const call2 = await createOutboundCall(u.id, u.id, { to: '+5491155550100', from: '+1', contactId: contact.id, recorded: false });
    await runFakeVoiceAction(u.id, u.id, call2.id, 'connect');
    await runFakeVoiceAction(u.id, u.id, call2.id, 'answer');
    await runFakeVoiceAction(u.id, u.id, call2.id, 'hangup', 30);
    setAiModelOverride(mockModel('Quieren empezar en marzo. Próximo paso: contrato mañana.'));
    await summarizeIfReady(call2.id);
    const row = await getCall(u.id, call2.id);
    expect(row).toMatchObject({ summary_status: 'done', summary: 'Quieren empezar en marzo. Próximo paso: contrato mañana.' });
    const act = (await getDb().prepare('SELECT body FROM crm_activities WHERE id = ?').get(row!.activity_id)) as { body: string };
    expect(act.body).toContain('marzo');
  });

  it('no atendida: se registra sin duración y sin transcripción', async () => {
    const { u, contact } = await setup('voice-na');
    const call = await createOutboundCall(u.id, u.id, { to: '+5491155550100', from: '+1', contactId: contact.id, recorded: true });
    await runFakeVoiceAction(u.id, u.id, call.id, 'connect');
    const done = await runFakeVoiceAction(u.id, u.id, call.id, 'hangup', 10);
    expect(done).toMatchObject({ status: 'no-answer', duration_sec: 0, recording_sid: null, transcript: '' });
    const act = (await getDb().prepare('SELECT outcome FROM crm_activities WHERE id = ?').get(done!.activity_id)) as { outcome: string };
    expect(act.outcome).toBe('no_answer');
  });

  it('el TwiML solo se entrega a la identidad que creó la llamada', async () => {
    const { u, contact } = await setup('voice-bind');
    const other = await makeUser('voice-other');
    const call = await createOutboundCall(u.id, u.id, { to: '+5491155550100', from: '+1', contactId: contact.id, recorded: false });
    expect(await bindOutboundCall(call.id, `client:${voiceIdentity(u.id, other.id)}`, 'CA1')).toBeNull();
    expect(await bindOutboundCall(call.id, `client:${voiceIdentity(u.id, u.id)}`, 'CA1')).toMatchObject({ call_sid: 'CA1' });
    expect(await bindOutboundCall(call.id, `client:${voiceIdentity(u.id, u.id)}`, 'CA2')).toBeNull();
  });

  it('entrante: busca el contacto por teléfono y suena en el equipo; el número es de un solo workspace', async () => {
    const { u, contact } = await setup('voice-in');
    const settings = (await getDb().prepare('SELECT caller_id FROM crm_voice_settings WHERE user_id = ?').get(u.id)) as { caller_id: string };
    const res = await createInboundCall(settings.caller_id, '+5491155550100', 'CAin1');
    expect(res?.call).toMatchObject({ direction: 'inbound', contact_id: contact.id });
    expect(res?.clients).toEqual([voiceIdentity(u.id, u.id)]);
    expect(await createInboundCall('+19999999999', '+1', 'CAin2')).toBeNull();

    const other = await makeUser('voice-in-2');
    await expect(
      saveVoiceSettings(other.id, {
        callerId: settings.caller_id,
        recordCalls: false,
        consentEnabled: true,
        consentText: '',
        transcribe: false,
        language: 'en-US',
        inboundEnabled: false,
      }),
    ).rejects.toBeInstanceOf(VoiceError);
  });
});
