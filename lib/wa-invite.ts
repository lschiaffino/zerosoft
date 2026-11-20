/**
 * Links de invitación a grupos de WhatsApp en los chats (Lines e Inbox):
 * encontrarlos en el texto de un mensaje, sacar el código y limpiar el
 * título que trae la vista previa ("Grupo X | WhatsApp Group Invite").
 * Puro: lo usan la pantalla y el servidor.
 */

/** chat.whatsapp.com/<código> o chat.whatsapp.com/invite/<código>, con o sin https://. */
const INVITE_RE = /(?:https?:\/\/)?chat\.whatsapp\.com\/(?:invite\/)?([A-Za-z0-9_-]{6,64})(?![A-Za-z0-9_-])/gi;

export interface InviteLink {
  /** El link como se va a abrir: siempre https://chat.whatsapp.com/<código>. */
  url: string;
  code: string;
}

/** Los links de invitación del texto, en orden y sin repetir el mismo código. */
export function inviteLinks(text: string | null | undefined): InviteLink[] {
  const out: InviteLink[] = [];
  const seen = new Set<string>();
  for (const m of String(text ?? '').matchAll(INVITE_RE)) {
    // "xchat.whatsapp.com" no es el dominio de WhatsApp.
    const before = m.index ? String(text).charAt(m.index - 1) : '';
    if (before && /[A-Za-z0-9.-]/.test(before) && !m[0].startsWith('http')) continue;
    const code = m[1];
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ url: `https://chat.whatsapp.com/${code}`, code });
  }
  return out;
}

/** El link (o un texto que lo trae) es una invitación a un grupo: su código, si no ''. */
export function inviteCodeOfUrl(url: string | null | undefined): string {
  try {
    const u = new URL(String(url ?? '').trim());
    if (u.hostname.toLowerCase() !== 'chat.whatsapp.com') return '';
    const m = /^\/(?:invite\/)?([A-Za-z0-9_-]{6,64})\/?$/.exec(u.pathname);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

export function isInviteUrl(url: string | null | undefined): boolean {
  return inviteCodeOfUrl(url) !== '';
}

/** Lo que WhatsApp pone en el título de la página de invitación, en los idiomas que más llegan. */
const GENERIC = [
  'whatsapp group invite',
  'whatsapp group invitation',
  'invitation to join whatsapp group',
  'invitación a grupo de whatsapp',
  'invitación al grupo de whatsapp',
  'invitación de grupo de whatsapp',
  'convite para grupo do whatsapp',
  'convite para o grupo do whatsapp',
  'convite de grupo do whatsapp',
  'whatsapp',
  'whatsapp.com',
];

function isGeneric(s: string): boolean {
  return GENERIC.includes(s.trim().toLowerCase());
}

/**
 * El nombre del grupo a partir del título de la vista previa: saca el
 * "WhatsApp Group Invite" de adelante o de atrás (con " | ", " - ", " · " o
 * ":") y devuelve '' si el título es solo eso.
 */
export function cleanInviteTitle(raw: string | null | undefined): string {
  let t = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!t || isGeneric(t)) return '';
  // Separadores entre el nombre y el sufijo genérico.
  const parts = t.split(/\s+[|·•–—-]\s+|:\s+/);
  if (parts.length > 1) {
    const kept = parts.filter((p) => !isGeneric(p));
    if (kept.length && kept.length < parts.length) t = kept.join(' - ');
  }
  return t.trim().slice(0, 200);
}
