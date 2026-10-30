/**
 * Email de invitación a un workspace (en, es, pt), con la estética de la
 * marca: blanco y negro, monospace, filete, un botón rectangular en tinta y
 * el link también en texto (hay clientes que no muestran botones).
 *
 * Remitente: "<quien invita> vía zerosoft" con la dirección de la app
 * (appSender: EMAIL_FROM o notifications@RESEND_EMAIL_DOMAIN) y Reply-To a
 * quien invita, así la respuesta le llega a una persona.
 */
import { appSender, escapeHtml, namedSender, sendEmail } from './email';
import { cleanLine } from './workspace';

type Lang = 'en' | 'es' | 'pt';

const COPY: Record<
  Lang,
  {
    subject: string;
    preheader: string;
    heading: string;
    line: string;
    role: Record<'admin' | 'member' | 'guest', string>;
    apps: string;
    appsExcept: string;
    button: string;
    orCopy: string;
    expires: string;
    ignore: string;
    via: string;
  }
> = {
  en: {
    subject: '{inviter} invited you to {workspace} on zerosoft',
    preheader: 'Join {workspace} on zerosoft.',
    heading: 'Join {workspace}',
    line: '{inviter} invited you to work together in {workspace} on zerosoft.',
    role: {
      admin: 'You join as an admin: you can invite people and change settings.',
      member: 'You join as a member: you use the same apps and data as the rest of the team.',
      guest: 'You join as a guest: you only see what they share with you.',
    },
    apps: 'You will use {apps} with the rest of the team.',
    appsExcept: 'You will use every app except {apps}, with the rest of the team.',
    button: 'Accept invitation',
    orCopy: 'Or paste this link in your browser:',
    expires: 'The link works once and expires on {date}.',
    ignore: "If you weren't expecting this invitation, you can ignore this email.",
    via: 'via',
  },
  es: {
    subject: '{inviter} te invitó a {workspace} en zerosoft',
    preheader: 'Sumate a {workspace} en zerosoft.',
    heading: 'Sumate a {workspace}',
    line: '{inviter} te invitó a trabajar en {workspace} en zerosoft.',
    role: {
      admin: 'Entrás como admin: podés invitar gente y cambiar la configuración.',
      member: 'Entrás como miembro: usás las mismas apps y datos que el resto del equipo.',
      guest: 'Entrás como invitado: solo ves lo que te compartan.',
    },
    apps: 'Vas a usar {apps} con el resto del equipo.',
    appsExcept: 'Vas a usar todas las apps menos {apps}, con el resto del equipo.',
    button: 'Aceptar invitación',
    orCopy: 'O pegá este link en el navegador:',
    expires: 'El link sirve una sola vez y vence el {date}.',
    ignore: 'Si no esperabas esta invitación, podés ignorar este email.',
    via: 'vía',
  },
  pt: {
    subject: '{inviter} convidou você para {workspace} no zerosoft',
    preheader: 'Entre em {workspace} no zerosoft.',
    heading: 'Entre em {workspace}',
    line: '{inviter} convidou você para trabalhar em {workspace} no zerosoft.',
    role: {
      admin: 'Você entra como admin: pode convidar pessoas e mudar as configurações.',
      member: 'Você entra como membro: usa os mesmos apps e dados que o resto da equipe.',
      guest: 'Você entra como convidado: só vê o que compartilharem com você.',
    },
    apps: 'Você vai usar {apps} com o resto da equipe.',
    appsExcept: 'Você vai usar todos os apps menos {apps}, com o resto da equipe.',
    button: 'Aceitar convite',
    orCopy: 'Ou cole este link no navegador:',
    expires: 'O link funciona uma vez e vence em {date}.',
    ignore: 'Se você não esperava este convite, pode ignorar este email.',
    via: 'via',
  },
};

function lang(locale: string | null | undefined): Lang {
  return locale === 'es' || locale === 'pt' ? locale : 'en';
}

function fill(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

const MONO = "'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

export interface InviteEmailInput {
  to: string;
  url: string;
  workspaceName: string;
  inviterName: string;
  inviterEmail?: string | null;
  role: 'admin' | 'member' | 'guest';
  expiresAt: string | null;
  locale?: string | null;
  logoUrl?: string | null;
  /** Nombres de las apps a las que entra (si no son todas). */
  apps?: string[] | null;
  /** Con la mayoría de las apps: las que NO tiene ("todas menos Track"). */
  appsExcept?: string[] | null;
}

/** Asunto, texto y HTML de la invitación (puro, para testear). */
export function renderInviteEmail(input: InviteEmailInput): { subject: string; text: string; html: string } {
  const l = lang(input.locale);
  const c = COPY[l];
  const tag = l === 'es' ? 'es-AR' : l === 'pt' ? 'pt-BR' : 'en-US';
  const date = input.expiresAt
    ? new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(input.expiresAt))
    : '';
  // Sin caracteres de control: el nombre va al asunto (ninguna inyección de headers).
  const vars = { inviter: cleanLine(input.inviterName), workspace: cleanLine(input.workspaceName), date };
  const esc = (s: string) => escapeHtml(s);
  const subject = fill(c.subject, vars);
  // Con apps limitadas, el email dice cuáles en vez de "las mismas apps que el resto".
  const list = (names: string[]) => new Intl.ListFormat(tag, { type: 'conjunction' }).format(names.map((a) => cleanLine(a)));
  const appsLine =
    input.role === 'guest'
      ? ''
      : input.appsExcept?.length
        ? fill(c.appsExcept, { apps: list(input.appsExcept) })
        : input.apps?.length
          ? fill(c.apps, { apps: list(input.apps) })
          : '';
  const roleLine = [input.role === 'admin' || !appsLine ? c.role[input.role] : '', appsLine].filter(Boolean).join(' ');
  const lines = [fill(c.line, vars), roleLine, date ? fill(c.expires, vars) : '', c.ignore].filter(Boolean);
  const text = [fill(c.heading, vars), '', ...lines.slice(0, 2), '', `${c.button}: ${input.url}`, '', ...lines.slice(2)].join('\n');
  const logo =
    input.logoUrl && /^https:\/\//.test(input.logoUrl)
      ? `<img src="${esc(input.logoUrl)}" alt="" width="40" height="40" style="display:block;width:40px;height:40px;object-fit:cover;margin:0 0 20px;border:1px solid #e5e5e5;" />`
      : '';
  const p = (s: string, extra = '') => `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#111111;${extra}">${s}</p>`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(fill(c.preheader, vars))}</span>
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;font-family:${MONO};">
    ${logo}
    <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#888888;">zerosoft</p>
    <h1 style="margin:0 0 24px;font-size:20px;font-weight:500;letter-spacing:-0.01em;color:#000000;border-bottom:2px solid #000000;display:inline-block;padding-bottom:6px;">${esc(fill(c.heading, vars))}</h1>
    ${p(esc(fill(c.line, vars)).replace(esc(vars.inviter), `<strong>${esc(vars.inviter)}</strong>`))}
    ${p(esc(roleLine), 'color:#444444;')}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr><td style="background:#000000;">
      <a href="${esc(input.url)}" style="display:inline-block;padding:12px 20px;font-family:${MONO};font-size:14px;color:#ffffff;text-decoration:none;">${esc(c.button)} &rarr;</a>
    </td></tr></table>
    ${p(esc(c.orCopy), 'font-size:12px;color:#666666;margin-bottom:4px;')}
    <p style="margin:0 0 24px;font-size:12px;line-height:1.5;word-break:break-all;"><a href="${esc(input.url)}" style="color:#000000;">${esc(input.url)}</a></p>
    ${date ? p(esc(fill(c.expires, vars)), 'font-size:12px;color:#666666;') : ''}
    ${p(esc(c.ignore), 'font-size:12px;color:#666666;')}
    <p style="margin:32px 0 0;padding-top:16px;border-top:1px solid #e5e5e5;font-size:11px;color:#999999;">zerosoft.ai</p>
  </div>
</body></html>`;
  return { subject, text, html };
}

export type InviteEmailResult = { status: 'sent' | 'failed' | 'skipped'; error?: string };

/**
 * Manda la invitación. 'skipped' = no hay proveedor de email configurado
 * (desarrollo, self-host sin RESEND_API_KEY): la UI ofrece copiar el link.
 */
export async function sendInviteEmail(input: InviteEmailInput): Promise<InviteEmailResult> {
  const { subject, text, html } = renderInviteEmail(input);
  const l = lang(input.locale);
  const from = input.inviterName ? namedSender(input.inviterName, COPY[l].via) : appSender();
  const res = await sendEmail({
    to: input.to,
    subject,
    text,
    html,
    from,
    ...(input.inviterEmail ? { replyTo: input.inviterEmail } : {}),
  });
  if (res.ok && res.provider === 'console') return { status: 'skipped' };
  if (res.ok) return { status: 'sent' };
  return { status: 'failed', error: res.error ?? 'send_failed' };
}
