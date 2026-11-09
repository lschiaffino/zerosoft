/**
 * Plantillas de los emails de ciclo de vida: HTML de tabla (Gmail, Outlook,
 * Apple Mail), modo oscuro con prefers-color-scheme y versión en texto.
 * Los textos viven en messages/<locale>/lifecycleEmails.json (los tres idiomas).
 * Un solo botón por email, que lleva a la pantalla de la app donde se hace
 * lo que el email propone.
 */
import en from '@/messages/en/lifecycleEmails.json';
import es from '@/messages/es/lifecycleEmails.json';
import pt from '@/messages/pt/lifecycleEmails.json';
import { escapeHtml } from '../email';
import { PRODUCT_CONFIG, type ProductKey } from '../products';
import { IMPORT_HREFS } from './rules';
import { TEMPLATE_CATEGORY, type LifecycleCategory, type LifecycleLocale, type LifecycleTemplate } from './types';

type Copy = typeof en;
const COPY: Record<LifecycleLocale, Copy> = { en, es, pt };

export function lifecycleCopy(locale: LifecycleLocale): Copy {
  return COPY[locale] ?? en;
}

export const TOOL_LABELS: Record<string, string> = {
  hubspot: 'HubSpot',
  pipedrive: 'Pipedrive',
  notion: 'Notion',
  linear: 'Linear',
  jira: 'Jira',
  github: 'GitHub',
  calendly: 'Calendly',
  bitly: 'Bitly',
};

const TOOL_APP: Record<string, ProductKey> = {
  hubspot: 'crm',
  pipedrive: 'crm',
  notion: 'docs',
  linear: 'track',
  jira: 'track',
  github: 'track',
  calendly: 'cal',
  bitly: 'link',
};

export interface DigestCounts {
  docs: number;
  issues: number;
  deals: number;
  members: number;
}

export interface RenderInput {
  template: LifecycleTemplate;
  locale: LifecycleLocale;
  email: string;
  name?: string | null;
  /** App de setup_first_item y de la bienvenida. */
  app?: ProductKey | null;
  /** Herramienta de setup_import (hubspot, notion, linear...). */
  tool?: string | null;
  team?: string | null;
  digest?: DigestCounts | null;
  /** Origen absoluto del sitio (https://zerosoft.ai). */
  origin: string;
  unsubscribeUrl: string;
  unsubscribeAllUrl: string;
  preferencesUrl: string;
  category: LifecycleCategory;
  /** auto: sigue al cliente de correo. light/dark: fijo (vista previa del admin). */
  theme?: 'auto' | 'light' | 'dark';
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  ctaUrl: string;
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** Pantalla a la que lleva el botón de cada email (ruta sin idioma). */
export function ctaPath(template: LifecycleTemplate, opts: { app?: ProductKey | null; tool?: string | null }): string {
  switch (template) {
    case 'welcome':
      return opts.app ? PRODUCT_CONFIG[opts.app].launch : '/app';
    case 'setup_first_item':
      return opts.app ? PRODUCT_CONFIG[opts.app].launch : '/app';
    case 'setup_import':
      return (opts.tool && IMPORT_HREFS[opts.tool]) || '/app/settings/import';
    case 'setup_calendar':
      return '/app/calendar/settings?tab=connections';
    case 'setup_whatsapp':
      return '/app/lines/settings?tab=numbers';
    case 'team_invite':
    case 'team_pending':
      return '/app/settings/members';
    case 'feature_voice':
      return '/app/voice';
    case 'feature_desktop':
      return '/download';
    case 'feature_mcp':
      return '/docs/mcp';
    default:
      return '/app';
  }
}

const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

const LIGHT = { bg: '#f4f4f2', card: '#ffffff', border: '#e4e4e0', ink: '#111111', body: '#33332f', muted: '#6b6b66', btn: '#111111', btnInk: '#ffffff', rule: '#ececea' };
const DARK = { bg: '#111111', card: '#1b1b1a', border: '#2e2e2c', ink: '#f2f2ef', body: '#d6d6d1', muted: '#9a9a94', btn: '#f2f2ef', btnInk: '#111111', rule: '#2a2a28' };

function darkCss(): string {
  return `
  .lc-bg{background:${DARK.bg}!important}
  .lc-card{background:${DARK.card}!important;border-color:${DARK.border}!important}
  .lc-ink{color:${DARK.ink}!important}
  .lc-body{color:${DARK.body}!important}
  .lc-muted,.lc-muted a{color:${DARK.muted}!important}
  .lc-rule{border-color:${DARK.rule}!important}
  .lc-btn{background:${DARK.btn}!important}
  .lc-btn a{color:${DARK.btnInk}!important}`;
}

/** Arma asunto, preheader, HTML y texto de un email. Todo lo variable va escapado. */
export function renderLifecycleEmail(input: RenderInput): RenderedEmail {
  const c = lifecycleCopy(input.locale);
  const t = c.templates[input.template] as {
    subject: string;
    preheader: string;
    heading: string;
    body: string[];
    cta: string;
    bodyApp?: string;
    ctaApp?: string;
    rows?: Record<keyof DigestCounts, string>;
  };
  const app = input.app ?? (input.tool ? TOOL_APP[input.tool] : null) ?? null;
  const appCopy = app && app in c.apps ? c.apps[app as keyof Copy['apps']] : null;
  const vars: Record<string, string> = {
    name: input.name?.trim() || '',
    app: app ? PRODUCT_CONFIG[app].name : 'zerosoft',
    thing: appCopy?.thing ?? '',
    action: appCopy?.action ?? '',
    tool: (input.tool && TOOL_LABELS[input.tool]) || '',
    team: input.team?.trim() || 'zerosoft',
    email: input.email,
  };
  const subject = fill(t.subject, vars);
  const preheader = fill(t.preheader, vars);
  const heading = fill(t.heading, vars);
  const greeting = vars.name ? fill(c.common.greeting, { name: vars.name.split(/\s+/)[0] }) : c.common.greetingNoName;
  const paragraphs = t.body.map((p) => fill(p, vars)).filter((p) => p.trim());
  if (input.template === 'welcome' && t.bodyApp && appCopy) paragraphs.splice(1, 0, fill(t.bodyApp, vars));
  const rows =
    input.template === 'digest' && t.rows && input.digest
      ? (Object.keys(t.rows) as Array<keyof DigestCounts>)
          .filter((k) => (input.digest?.[k] ?? 0) > 0)
          .map((k) => fill(t.rows![k], { count: String(input.digest![k]) }))
      : [];
  const ctaLabel = fill(input.template === 'welcome' && app && t.ctaApp ? t.ctaApp : t.cta, vars);
  const origin = input.origin.replace(/\/$/, '');
  const ctaUrl = `${origin}/${input.locale}${ctaPath(input.template, { app, tool: input.tool })}`;
  const category = c.common.categories[input.category];
  const unsubLabel = fill(c.common.unsubscribe, { category });
  const why = fill(c.common.why, { email: input.email });

  const theme = input.theme ?? 'auto';
  const P = theme === 'dark' ? DARK : LIGHT;
  const css =
    theme === 'auto'
      ? `@media (prefers-color-scheme: dark){${darkCss()}}\n[data-ogsc] .lc-ink{color:${DARK.ink}!important}`
      : '';
  const e = escapeHtml;
  const pStyle = `margin:0 0 16px;font-family:${SANS};font-size:16px;line-height:1.6;color:${P.body};`;
  const html = `<!doctype html>
<html lang="${input.locale}" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="${theme === 'auto' ? 'light dark' : theme}">
<meta name="supported-color-schemes" content="${theme === 'auto' ? 'light dark' : theme}">
<title>${e(subject)}</title>
<style>
  body{margin:0;padding:0;-webkit-text-size-adjust:100%}
  a{text-decoration:underline}
  @media (max-width:480px){.lc-pad{padding:24px 20px!important}.lc-outer{padding:16px 8px!important}}
  ${css}
</style>
</head>
<body class="lc-bg" style="margin:0;padding:0;background:${P.bg};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${P.bg};opacity:0;">${e(preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="lc-bg" style="background:${P.bg};">
<tr><td align="center" class="lc-outer" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
<tr><td class="lc-card lc-pad" style="background:${P.card};border:1px solid ${P.border};border-radius:6px;padding:36px 40px;">
<p class="lc-ink" style="margin:0 0 28px;font-family:${MONO};font-size:13px;letter-spacing:0.02em;color:${P.ink};">zerosoft</p>
<h1 class="lc-ink" style="margin:0 0 20px;font-family:${SANS};font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:${P.ink};">${e(heading)}</h1>
<p class="lc-body" style="${pStyle}">${e(greeting)}</p>
${paragraphs.map((p) => `<p class="lc-body" style="${pStyle}">${e(p)}</p>`).join('\n')}
${
  rows.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px;">${rows
        .map(
          (r) =>
            `<tr><td class="lc-body lc-rule" style="padding:10px 0;border-top:1px solid ${P.rule};font-family:${SANS};font-size:15px;line-height:1.4;color:${P.body};">${e(r)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
<tr><td class="lc-btn" style="background:${P.btn};border-radius:4px;">
<a href="${e(ctaUrl)}" style="display:inline-block;padding:12px 20px;font-family:${SANS};font-size:15px;font-weight:600;line-height:1.2;color:${P.btnInk};text-decoration:none;border-radius:4px;">${e(ctaLabel)}</a>
</td></tr>
</table>
<p class="lc-muted" style="margin:0 0 24px;font-family:${SANS};font-size:13px;line-height:1.5;color:${P.muted};word-break:break-all;">${e(c.common.fallbackLink)} <a href="${e(ctaUrl)}" style="color:${P.muted};">${e(ctaUrl)}</a></p>
<p class="lc-body" style="margin:0;font-family:${SANS};font-size:15px;line-height:1.6;color:${P.body};">${e(c.common.signoff)}</p>
</td></tr>
<tr><td style="padding:20px 8px 0;">
<p class="lc-muted" style="margin:0 0 8px;font-family:${SANS};font-size:12px;line-height:1.6;color:${P.muted};">${e(why)}</p>
<p class="lc-muted" style="margin:0;font-family:${SANS};font-size:12px;line-height:1.8;color:${P.muted};"><a href="${e(input.unsubscribeUrl)}" style="color:${P.muted};">${e(unsubLabel)}</a> &middot; <a href="${e(input.preferencesUrl)}" style="color:${P.muted};">${e(c.common.preferences)}</a> &middot; <a href="${e(input.unsubscribeAllUrl)}" style="color:${P.muted};">${e(c.common.unsubscribeAll)}</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    heading,
    '',
    greeting,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(rows.length ? [...rows.map((r) => `- ${r}`), ''] : []),
    `${ctaLabel}: ${ctaUrl}`,
    '',
    c.common.signoff,
    '',
    '--',
    why,
    `${unsubLabel}: ${input.unsubscribeUrl}`,
    `${c.common.preferences}: ${input.preferencesUrl}`,
    `${c.common.unsubscribeAll}: ${input.unsubscribeAllUrl}`,
  ].join('\n');

  return { subject, preheader, html, text, ctaUrl };
}

/** Datos de ejemplo para la vista previa del admin y los tests. */
export function sampleRenderInput(template: LifecycleTemplate, locale: LifecycleLocale, origin = 'https://zerosoft.ai'): RenderInput {
  return {
    template,
    locale,
    email: 'ana@example.com',
    name: 'Ana García',
    app: template === 'setup_first_item' || template === 'welcome' ? 'docs' : null,
    tool: template === 'setup_import' ? 'hubspot' : null,
    team: 'Acme',
    digest: template === 'digest' ? { docs: 4, issues: 12, deals: 3, members: 1 } : null,
    origin,
    unsubscribeUrl: `${origin}/${locale}/email/unsubscribe?t=sample`,
    unsubscribeAllUrl: `${origin}/${locale}/email/unsubscribe?t=sample-all`,
    preferencesUrl: `${origin}/${locale}/app/settings/notifications`,
    category: TEMPLATE_CATEGORY[template],
  };
}
