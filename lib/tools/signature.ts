/**
 * Firmas de email: HTML con tablas y estilos inline (lo único que respetan
 * Gmail, Outlook y Apple Mail). Sin píxeles de tracking ni imágenes remotas
 * salvo la foto que pone la persona. Todo valor se escapa y las URLs se
 * limitan a http(s)/mailto/tel.
 */

export type SignatureTemplate = 'classic' | 'modern' | 'compact' | 'bold';
export const SIGNATURE_TEMPLATES: readonly SignatureTemplate[] = ['classic', 'modern', 'compact', 'bold'];

export const SOCIAL_KEYS = ['linkedin', 'x', 'instagram', 'facebook', 'github', 'youtube'] as const;
export type SocialKey = (typeof SOCIAL_KEYS)[number];

export const SOCIAL_NAMES: Record<SocialKey, string> = {
  linkedin: 'LinkedIn',
  x: 'X',
  instagram: 'Instagram',
  facebook: 'Facebook',
  github: 'GitHub',
  youtube: 'YouTube',
};

export interface SignatureData {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  photoUrl: string;
  accent: string;
  meetingUrl: string;
  socials: Partial<Record<SocialKey, string>>;
}

/** Etiquetas dentro de la firma: siguen el idioma de la página. */
const LABELS: Record<string, { phone: string; email: string; web: string; book: string }> = {
  en: { phone: 'M', email: 'E', web: 'W', book: 'Book a meeting' },
  es: { phone: 'T', email: 'E', web: 'W', book: 'Agendá una reunión' },
  pt: { phone: 'T', email: 'E', web: 'W', book: 'Agende uma reunião' },
};

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** URL http(s) válida (agrega https:// si falta) o ''. */
export function safeUrl(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!u.hostname.includes('.')) return '';
    return u.toString();
  } catch {
    return '';
  }
}

export function safeColor(raw: string, fallback = '#0d0d0d'): string {
  return /^#[0-9a-f]{6}$/i.test(raw.trim()) ? raw.trim() : fallback;
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const FONT = 'font-family:Arial,Helvetica,sans-serif;';

interface Parts {
  name: string;
  title: string;
  company: string;
  titleLine: string;
  photo: string;
  contacts: string[];
  socials: string;
  meeting: string;
  /** Mismo link de reunión, como texto (plantilla compacta). */
  meetingText: string;
  accent: string;
}

function parts(d: SignatureData, locale: string, photoSize: number): Parts {
  const l = LABELS[locale] ?? LABELS.en;
  const accent = safeColor(d.accent);
  const e = escapeHtml;
  const link = (href: string, text: string, color = '#3f3f3f') =>
    `<a href="${e(href)}" style="color:${color};text-decoration:none;">${e(text)}</a>`;

  const contacts: string[] = [];
  const phone = d.phone.trim();
  if (phone) {
    const tel = phone.replace(/[^\d+]/g, '');
    contacts.push(
      `<span style="color:${accent};font-weight:bold;">${l.phone}</span>&nbsp;${tel ? link(`tel:${tel}`, phone) : e(phone)}`,
    );
  }
  const email = d.email.trim();
  if (/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email)) {
    contacts.push(`<span style="color:${accent};font-weight:bold;">${l.email}</span>&nbsp;${link(`mailto:${email}`, email)}`);
  }
  const web = safeUrl(d.website);
  if (web) contacts.push(`<span style="color:${accent};font-weight:bold;">${l.web}</span>&nbsp;${link(web, displayUrl(web))}`);

  const socialLinks = SOCIAL_KEYS.map((k) => {
    const u = safeUrl(d.socials[k] ?? '');
    return u ? link(u, SOCIAL_NAMES[k], accent) : '';
  }).filter(Boolean);

  const photoUrl = safeUrl(d.photoUrl);
  const photo = photoUrl
    ? `<img src="${e(photoUrl)}" width="${photoSize}" height="${photoSize}" alt="${e(d.name.trim())}" style="display:block;width:${photoSize}px;height:${photoSize}px;border-radius:4px;object-fit:cover;border:0;" />`
    : '';

  const meetingUrl = safeUrl(d.meetingUrl);
  const meeting = meetingUrl
    ? `<a href="${e(meetingUrl)}" style="display:inline-block;padding:7px 12px;background:${accent};color:#ffffff;${FONT}font-size:12px;font-weight:bold;text-decoration:none;border-radius:3px;">${e(l.book)} &rarr;</a>`
    : '';

  const title = e(d.title.trim());
  const company = e(d.company.trim());
  return {
    name: e(d.name.trim()),
    title,
    company,
    titleLine: [title, company].filter(Boolean).join(' &middot; '),
    photo,
    contacts,
    socials: socialLinks.join(' <span style="color:#c4c4c4;">&middot;</span> '),
    meeting,
    meetingText: meetingUrl ? link(meetingUrl, `${l.book} →`, accent) : '',
    accent,
  };
}

function row(content: string, style = ''): string {
  return `<tr><td style="padding:0;${style}">${content}</td></tr>`;
}

function tableOpen(extra = ''): string {
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;${FONT}${extra}">`;
}

export function renderSignature(template: SignatureTemplate, data: SignatureData, locale = 'en'): string {
  const p = parts(data, locale, template === 'compact' ? 48 : template === 'bold' ? 88 : 72);
  const text = `${FONT}font-size:13px;line-height:20px;color:#3f3f3f;`;
  const nameStyle = `${FONT}font-size:16px;line-height:22px;font-weight:bold;color:#0d0d0d;`;
  const inner: string[] = [];

  if (template === 'classic') {
    inner.push(row(`<span style="${nameStyle}">${p.name}</span>`));
    if (p.titleLine) inner.push(row(`<span style="${text}color:#6a6a6a;">${p.titleLine}</span>`, 'padding-bottom:8px;'));
    p.contacts.forEach((c) => inner.push(row(`<span style="${text}">${c}</span>`)));
    if (p.socials) inner.push(row(`<span style="${text}">${p.socials}</span>`, 'padding-top:6px;'));
    if (p.meeting) inner.push(row(p.meeting, 'padding-top:10px;'));
    const body = `${tableOpen()}${inner.join('')}</table>`;
    if (!p.photo) return `${tableOpen()}<tr><td style="padding:0;">${body}</td></tr></table>`;
    return (
      `${tableOpen()}<tr>` +
      `<td valign="top" style="padding:0 14px 0 0;">${p.photo}</td>` +
      `<td valign="top" style="padding:0 0 0 14px;border-left:2px solid ${p.accent};">${body}</td>` +
      `</tr></table>`
    );
  }

  if (template === 'modern') {
    inner.push(row(`<span style="${nameStyle}font-size:18px;">${p.name}</span>`));
    if (p.title) inner.push(row(`<span style="${text}color:${p.accent};font-weight:bold;">${p.title}</span>`));
    if (p.company) inner.push(row(`<span style="${text}color:#6a6a6a;">${p.company}</span>`, 'padding-bottom:8px;'));
    inner.push(row('', `border-top:1px solid #e8e8e8;font-size:0;line-height:0;height:8px;`));
    if (p.contacts.length) inner.push(row(`<span style="${text}">${p.contacts.join('&nbsp;&nbsp; ')}</span>`));
    if (p.socials) inner.push(row(`<span style="${text}">${p.socials}</span>`, 'padding-top:4px;'));
    if (p.meeting) inner.push(row(p.meeting, 'padding-top:10px;'));
    const body = `${tableOpen()}${inner.join('')}</table>`;
    return (
      `${tableOpen()}<tr>` +
      (p.photo ? `<td valign="top" style="padding:0 16px 0 0;">${p.photo}</td>` : '') +
      `<td valign="top" style="padding:0;">${body}</td></tr></table>`
    );
  }

  if (template === 'compact') {
    const line1 = [`<strong style="color:#0d0d0d;">${p.name}</strong>`, p.titleLine].filter(Boolean).join(' &middot; ');
    inner.push(row(`<span style="${text}">${line1}</span>`));
    if (p.contacts.length) inner.push(row(`<span style="${text}font-size:12px;">${p.contacts.join(' &nbsp;|&nbsp; ')}</span>`));
    const extras = [p.socials, p.meetingText]
      .filter(Boolean)
      .join(' <span style="color:#c4c4c4;">&middot;</span> ');
    if (extras) inner.push(row(`<span style="${text}font-size:12px;">${extras}</span>`));
    const body = `${tableOpen()}${inner.join('')}</table>`;
    return (
      `${tableOpen()}<tr>` +
      (p.photo ? `<td valign="middle" style="padding:0 10px 0 0;">${p.photo}</td>` : '') +
      `<td valign="middle" style="padding:0;">${body}</td></tr></table>`
    );
  }

  // bold: banda de color arriba, foto grande.
  inner.push(row('', `background:${p.accent};height:4px;font-size:0;line-height:0;`));
  const head =
    `${tableOpen()}<tr>` +
    (p.photo ? `<td valign="top" style="padding:12px 14px 0 0;">${p.photo}</td>` : '') +
    `<td valign="top" style="padding:12px 0 0 0;">` +
    `<div style="${nameStyle}font-size:20px;line-height:26px;">${p.name}</div>` +
    (p.title ? `<div style="${text}">${p.title}</div>` : '') +
    (p.company ? `<div style="${text}color:${p.accent};font-weight:bold;text-transform:uppercase;letter-spacing:1px;font-size:11px;">${p.company}</div>` : '') +
    `</td></tr></table>`;
  inner.push(row(head));
  p.contacts.forEach((c, i) => inner.push(row(`<span style="${text}">${c}</span>`, i === 0 ? 'padding-top:10px;' : '')));
  if (p.socials) inner.push(row(`<span style="${text}">${p.socials}</span>`, 'padding-top:6px;'));
  if (p.meeting) inner.push(row(p.meeting, 'padding-top:12px;'));
  return `${tableOpen()}${inner.join('')}</table>`;
}

/** Texto plano equivalente (fallback del portapapeles). */
export function signatureText(data: SignatureData, locale = 'en'): string {
  const l = LABELS[locale] ?? LABELS.en;
  const lines = [
    data.name.trim(),
    [data.title.trim(), data.company.trim()].filter(Boolean).join(' · '),
    data.phone.trim() && `${l.phone}: ${data.phone.trim()}`,
    data.email.trim() && `${l.email}: ${data.email.trim()}`,
    safeUrl(data.website) && displayUrl(safeUrl(data.website)),
    safeUrl(data.meetingUrl) && `${l.book}: ${safeUrl(data.meetingUrl)}`,
  ];
  return lines.filter(Boolean).join('\n');
}
