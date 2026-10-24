/**
 * Microsoft Graph falso para tests y demo: un `fetch` que imita lo que usa el
 * CRM (perfil, delta de Bandeja/Enviados/calendario, borrador + send) con un
 * buzón en memoria. Solo se activa con MS_GRAPH_FAKE=1 y además NODE_ENV=test
 * o DEMO_MODE=true (mismo patrón que CRM_IMPORT_FAKE). En producción nunca.
 *
 * El buzón trae un hilo con ana@fake-outlook.test (uno entrante y uno
 * enviado) y una reunión con ella mañana. Lo enviado por el CRM se agrega a
 * Enviados y sale en el próximo delta.
 */

export const FAKE_OUTLOOK_EMAIL = 'demo.outlook@fake-outlook.test';
export const FAKE_OUTLOOK_CONTACT = 'ana@fake-outlook.test';
const GRAPH = 'https://graph.microsoft.com/v1.0';

export function fakeMicrosoftAllowed(): boolean {
  if (process.env.MS_GRAPH_FAKE !== '1') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

interface FakeMessage {
  id: string;
  conversationId: string;
  internetMessageId: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { address: string; name?: string } };
  toRecipients: Array<{ emailAddress: { address: string } }>;
  ccRecipients: Array<{ emailAddress: { address: string } }>;
  receivedDateTime: string;
  sentDateTime: string;
  isDraft: boolean;
}

interface FakeState {
  seq: number;
  inbox: FakeMessage[];
  sent: FakeMessage[];
  drafts: Map<string, FakeMessage>;
  events: Array<Record<string, unknown>>;
}

const g = globalThis as unknown as { __zsFakeGraph?: FakeState };

function msg(
  id: string,
  conv: string,
  from: string,
  to: string,
  subject: string,
  text: string,
  at: Date,
): FakeMessage {
  return {
    id,
    conversationId: conv,
    internetMessageId: `<${id}@fake-outlook.test>`,
    subject,
    bodyPreview: text.slice(0, 200),
    body: { contentType: 'html', content: `<p>${text}</p>` },
    from: { emailAddress: { address: from, name: from === FAKE_OUTLOOK_CONTACT ? 'Ana Outlook' : 'Demo' } },
    toRecipients: [{ emailAddress: { address: to } }],
    ccRecipients: [],
    receivedDateTime: at.toISOString(),
    sentDateTime: at.toISOString(),
    isDraft: false,
  };
}

function state(): FakeState {
  if (!g.__zsFakeGraph) {
    const now = Date.now();
    const tomorrow = new Date(now + 86_400_000);
    tomorrow.setUTCHours(15, 0, 0, 0);
    const end = new Date(tomorrow.getTime() + 30 * 60_000);
    g.__zsFakeGraph = {
      seq: 0,
      inbox: [
        msg('fake-in-1', 'fake-conv-1', FAKE_OUTLOOK_CONTACT, FAKE_OUTLOOK_EMAIL, 'Question about the proposal', 'Hi! Can we review the pricing on Thursday?', new Date(now - 2 * 3_600_000)),
      ],
      sent: [
        msg('fake-out-1', 'fake-conv-1', FAKE_OUTLOOK_EMAIL, FAKE_OUTLOOK_CONTACT, 'Re: Question about the proposal', 'Sure, Thursday works for me.', new Date(now - 3_600_000)),
      ],
      drafts: new Map(),
      events: [
        {
          id: 'fake-event-1',
          iCalUId: 'fake-ical-1',
          subject: 'Pricing review with Ana',
          bodyPreview: 'Walk through the proposal',
          start: { dateTime: tomorrow.toISOString().replace('Z', ''), timeZone: 'UTC' },
          end: { dateTime: end.toISOString().replace('Z', ''), timeZone: 'UTC' },
          isCancelled: false,
          isOnlineMeeting: true,
          onlineMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/fake' },
          organizer: { emailAddress: { address: FAKE_OUTLOOK_EMAIL } },
          attendees: [{ type: 'required', emailAddress: { address: FAKE_OUTLOOK_CONTACT, name: 'Ana Outlook' } }],
        },
      ],
    };
  }
  return g.__zsFakeGraph;
}

/** Lo enviado por el CRM en el buzón falso (para tests). */
export function fakeOutlookSent(): FakeMessage[] {
  return state().sent;
}

export function resetFakeOutlook(): void {
  g.__zsFakeGraph = undefined;
}

export function fakeTokenResponse(params: Record<string, string>): {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
} {
  if (params.grant_type === 'authorization_code' && params.code !== 'fake-code') return { error: 'invalid_grant' };
  return {
    access_token: `fake-ms-access-${Date.now()}`,
    refresh_token: 'fake-ms-refresh',
    expires_in: 3600,
    scope: 'openid email offline_access User.Read Mail.ReadWrite Mail.Send Calendars.Read',
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

function deltaPage(items: unknown[], kind: string, cursor: number): Response {
  return json({ value: items, '@odata.deltaLink': `${GRAPH}/fake-delta/${kind}?cursor=${cursor}` });
}

export async function fakeGraphFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const auth = new Headers(init.headers).get('authorization') ?? '';
  if (!auth.startsWith('Bearer fake-ms-access')) return json({ error: { code: 'InvalidAuthenticationToken' } }, 401);
  const s = state();
  const method = (init.method ?? 'GET').toUpperCase();
  const path = url.pathname.replace('/v1.0', '');

  if (path === '/me') return json({ mail: FAKE_OUTLOOK_EMAIL, displayName: 'Demo Outlook', userPrincipalName: FAKE_OUTLOOK_EMAIL });

  const folderMatch = /^\/me\/mailFolders\/(inbox|sentitems)\/messages\/delta$/.exec(path);
  if (folderMatch) {
    const list = folderMatch[1] === 'inbox' ? s.inbox : s.sent;
    return deltaPage(list, folderMatch[1], list.length);
  }
  const deltaMatch = /^\/fake-delta\/(inbox|sentitems|calendar)$/.exec(path);
  if (deltaMatch) {
    const cursor = Number(url.searchParams.get('cursor') ?? 0);
    const list = deltaMatch[1] === 'inbox' ? s.inbox : deltaMatch[1] === 'sentitems' ? s.sent : s.events;
    return deltaPage(list.slice(cursor), deltaMatch[1], list.length);
  }
  if (path === '/me/calendarView/delta') return deltaPage(s.events, 'calendar', s.events.length);

  if (path === '/me/messages' && method === 'POST') {
    const body = JSON.parse(String(init.body ?? '{}')) as Partial<FakeMessage>;
    s.seq += 1;
    const id = `fake-draft-${s.seq}`;
    const draft: FakeMessage = {
      ...msg(id, `fake-conv-new-${s.seq}`, FAKE_OUTLOOK_EMAIL, '', body.subject ?? '', '', new Date()),
      body: (body.body as FakeMessage['body']) ?? { contentType: 'html', content: '' },
      toRecipients: (body.toRecipients as FakeMessage['toRecipients']) ?? [],
      isDraft: true,
    };
    s.drafts.set(id, draft);
    return json(draft, 201);
  }
  const replyMatch = /^\/me\/messages\/([^/]+)\/createReply$/.exec(path);
  if (replyMatch && method === 'POST') {
    const original = [...s.inbox, ...s.sent].find((m) => m.id === decodeURIComponent(replyMatch[1]));
    if (!original) return json({ error: { code: 'ErrorItemNotFound' } }, 404);
    s.seq += 1;
    const id = `fake-draft-${s.seq}`;
    const draft: FakeMessage = {
      ...msg(id, original.conversationId, FAKE_OUTLOOK_EMAIL, original.from.emailAddress.address, `Re: ${original.subject.replace(/^Re:\s*/i, '')}`, '', new Date()),
      isDraft: true,
    };
    s.drafts.set(id, draft);
    return json(draft, 201);
  }
  const sendMatch = /^\/me\/messages\/([^/]+)\/send$/.exec(path);
  if (sendMatch && method === 'POST') {
    const id = decodeURIComponent(sendMatch[1]);
    const draft = s.drafts.get(id);
    if (!draft) return json({ error: { code: 'ErrorItemNotFound' } }, 404);
    s.drafts.delete(id);
    const now = new Date().toISOString();
    s.sent.push({ ...draft, isDraft: false, sentDateTime: now, receivedDateTime: now, bodyPreview: draft.body.content.replace(/<[^>]+>/g, ' ').slice(0, 200) });
    return new Response(null, { status: 202 });
  }
  const patchMatch = /^\/me\/messages\/([^/]+)$/.exec(path);
  if (patchMatch && method === 'PATCH') {
    const draft = s.drafts.get(decodeURIComponent(patchMatch[1]));
    if (!draft) return json({ error: { code: 'ErrorItemNotFound' } }, 404);
    const body = JSON.parse(String(init.body ?? '{}')) as Partial<FakeMessage>;
    if (body.body) draft.body = body.body as FakeMessage['body'];
    if (body.toRecipients) draft.toRecipients = body.toRecipients as FakeMessage['toRecipients'];
    return json(draft);
  }
  return json({ error: { code: 'NotFound', path } }, 404);
}
