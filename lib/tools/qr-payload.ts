/** Contenido codificado en el QR según el tipo elegido (formatos estándar). */

export type QrKind = 'url' | 'text' | 'wifi' | 'vcard' | 'email';
export const QR_KINDS: readonly QrKind[] = ['url', 'text', 'wifi', 'vcard', 'email'];

export interface QrFields {
  url: string;
  text: string;
  ssid: string;
  password: string;
  security: 'WPA' | 'WEP' | 'nopass';
  hidden: boolean;
  firstName: string;
  lastName: string;
  org: string;
  jobTitle: string;
  phone: string;
  email: string;
  website: string;
  to: string;
  subject: string;
  body: string;
}

export const EMPTY_QR_FIELDS: QrFields = {
  url: '',
  text: '',
  ssid: '',
  password: '',
  security: 'WPA',
  hidden: false,
  firstName: '',
  lastName: '',
  org: '',
  jobTitle: '',
  phone: '',
  email: '',
  website: '',
  to: '',
  subject: '',
  body: '',
};

/** Escapa \ ; , : " para el formato WIFI: (ZXing). */
function wifiEscape(s: string): string {
  return s.replace(/([\\;,:"])/g, '\\$1');
}

/** Escapa para vCard 3.0 (\ , ; y saltos de línea). */
function vEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
}

export function qrPayload(kind: QrKind, f: QrFields): string {
  switch (kind) {
    case 'url': {
      const v = f.url.trim();
      if (!v) return '';
      return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`;
    }
    case 'text':
      return f.text;
    case 'wifi': {
      if (!f.ssid.trim()) return '';
      const pass = f.security === 'nopass' ? '' : `P:${wifiEscape(f.password)};`;
      return `WIFI:T:${f.security};S:${wifiEscape(f.ssid)};${pass}${f.hidden ? 'H:true;' : ''};`;
    }
    case 'vcard': {
      if (!f.firstName.trim() && !f.lastName.trim() && !f.org.trim()) return '';
      const lines = [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${vEscape(f.lastName.trim())};${vEscape(f.firstName.trim())};;;`,
        `FN:${vEscape([f.firstName.trim(), f.lastName.trim()].filter(Boolean).join(' ') || f.org.trim())}`,
        f.org.trim() && `ORG:${vEscape(f.org.trim())}`,
        f.jobTitle.trim() && `TITLE:${vEscape(f.jobTitle.trim())}`,
        f.phone.trim() && `TEL;TYPE=CELL:${vEscape(f.phone.trim())}`,
        f.email.trim() && `EMAIL:${vEscape(f.email.trim())}`,
        f.website.trim() && `URL:${vEscape(f.website.trim())}`,
        'END:VCARD',
      ];
      return lines.filter(Boolean).join('\n');
    }
    case 'email': {
      const to = f.to.trim();
      if (!to) return '';
      const q = new URLSearchParams();
      if (f.subject) q.set('subject', f.subject);
      if (f.body) q.set('body', f.body);
      const qs = q.toString().replace(/\+/g, '%20');
      return `mailto:${to}${qs ? `?${qs}` : ''}`;
    }
  }
}
