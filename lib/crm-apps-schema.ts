/**
 * Apps del CRM (Ajustes › Integraciones): catálogo y lógica pura que comparten
 * la UI y el servidor (lib/crm-apps.ts). Sin dependencias de servidor.
 */

export const CRM_APPS = ['slack', 'zoom', 'stripe', 'zapier', 'make'] as const;
export type CrmAppKey = (typeof CRM_APPS)[number];

export function isCrmApp(v: string): v is CrmAppKey {
  return (CRM_APPS as readonly string[]).includes(v);
}

/** Eventos que Slack puede anunciar en el canal (subconjunto de WEBHOOK_EVENTS). */
export const SLACK_EVENTS = [
  'contact.created',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'task.created',
  'form.submitted',
  'quote.accepted',
  'quote.paid',
] as const;
export type SlackEvent = (typeof SLACK_EVENTS)[number];
export const DEFAULT_SLACK_EVENTS: SlackEvent[] = ['deal.won', 'form.submitted', 'quote.accepted', 'quote.paid'];

/** Eventos que Zapier/Make reciben por defecto al conectar (el resto se suma desde Webhooks). */
export const AUTOMATION_DEFAULT_EVENTS = [
  'contact.created',
  'contact.updated',
  'company.created',
  'deal.created',
  'deal.stage_changed',
  'deal.won',
  'form.submitted',
] as const;

/** URL de "Incoming Webhook" de Slack: https://hooks.slack.com/services/T…/B…/… */
export function isSlackWebhookUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && u.hostname === 'hooks.slack.com' && /^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(u.pathname);
  } catch {
    return false;
  }
}

/** Catch hook de Zapier (hooks.zapier.com) o webhook de Make (hook.<región>.make.com). */
export function isAutomationHookUrl(app: 'zapier' | 'make', raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    if (app === 'zapier') return u.hostname === 'hooks.zapier.com' && u.pathname.startsWith('/hooks/');
    return /^hook\.([a-z0-9-]+\.)?make\.com$/.test(u.hostname) || /^hook\.([a-z0-9-]+\.)?integromat\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

/** Oculta el secreto de una URL o clave para mostrarla: deja el principio y los últimos 4. */
export function maskSecret(value: string, keep = 8): string {
  if (!value) return '';
  if (value.length <= keep + 4) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, keep)}…${value.slice(-4)}`;
}

function money(amount: unknown, currency: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: String(currency || 'USD').toUpperCase() }).format(n);
  } catch {
    return `${n} ${String(currency ?? '')}`.trim();
  }
}

/** Escapa los caracteres de control del mrkdwn de Slack. */
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function personName(d: Record<string, unknown>): string {
  return `${String(d.first_name ?? '')} ${String(d.last_name ?? '')}`.trim() || String(d.email ?? '') || 'Someone';
}

/**
 * Texto del mensaje de Slack para un evento (mrkdwn con link al registro).
 * null = el evento no se anuncia.
 */
export function slackText(event: string, data: unknown, baseUrl: string): string | null {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const base = baseUrl.replace(/\/$/, '');
  const link = (path: string, label: string) => `<${base}/en${path}|${esc(label)}>`;
  switch (event) {
    case 'contact.created':
      return `New contact: ${link(`/app/crm/contacts/${d.id}`, personName(d))}${d.email ? ` (${esc(d.email)})` : ''}`;
    case 'deal.created':
      return `New deal: ${link(`/app/crm/deals/${d.id}`, String(d.name || 'Deal'))} ${money(d.amount, d.currency)}`.trim();
    case 'deal.stage_changed':
      return `Deal moved: ${link(`/app/crm/deals/${d.id}`, String(d.name || 'Deal'))}`;
    case 'deal.won':
      return `:trophy: Deal won: ${link(`/app/crm/deals/${d.id}`, String(d.name || 'Deal'))} ${money(d.amount, d.currency)}`.trim();
    case 'deal.lost':
      return `Deal lost: ${link(`/app/crm/deals/${d.id}`, String(d.name || 'Deal'))}`;
    case 'task.created': {
      const task = (d.task ?? {}) as Record<string, unknown>;
      return `New task: ${esc(task.subject || 'Task')}`;
    }
    case 'form.submitted': {
      const form = (d.form ?? {}) as Record<string, unknown>;
      const contact = (d.contact ?? {}) as Record<string, unknown>;
      const who = contact.id ? link(`/app/crm/contacts/${contact.id}`, String(contact.email || 'a contact')) : 'someone';
      return `Form "${esc(form.name || 'Form')}" submitted by ${who}`;
    }
    case 'quote.accepted':
      return `:memo: Quote ${esc(d.number)} signed by ${esc(d.signerName || 'the customer')}: ${link(`/app/crm/quotes/${d.id}`, String(d.title || d.number || 'Quote'))} ${money(d.total, d.currency)}`.trim();
    case 'quote.paid':
      return `:moneybag: Quote ${esc(d.number)} paid: ${link(`/app/crm/quotes/${d.id}`, String(d.title || d.number || 'Quote'))} ${money(d.amount ?? d.total, d.currency)}`.trim();
    default:
      return null;
  }
}

/** Duración por defecto de una reunión de Zoom creada desde una actividad. */
export const ZOOM_DEFAULT_MINUTES = 30;

/** Línea del link de Zoom que va al principio del cuerpo de la actividad. */
export function withZoomLine(body: string, joinUrl: string): string {
  const lines = body.split('\n').filter((l) => !/^Zoom: https:\/\/\S*zoom\.us\//.test(l));
  return [`Zoom: ${joinUrl}`, ...lines].join('\n').trim();
}
