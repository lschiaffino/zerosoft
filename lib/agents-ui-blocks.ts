/**
 * Agents — botones y formularios dentro del chat (sin acceso a la base: lo
 * usan el servidor, la UI y los tests).
 *
 * Una respuesta del agente puede llevar un bloque `ui` (AgentReplyUi): botones
 * de respuesta rápida o un formulario del agente (settings.forms). El
 * playground, la página pública y el widget de Chat los dibujan; tocar un
 * botón manda ese texto como mensaje del visitante y enviar el formulario
 * manda los valores (que el servidor valida contra la definición). Los
 * canales que no dibujan nada (Groups, email, Slack, teléfono) reciben las
 * opciones como texto.
 */
import {
  AGENT_MAX_BUTTONS,
  type AgentForm,
  type AgentReplyUi,
} from './agents-config';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9 ()-]{6,20}$/;

/** Botones sin repetidos ni vacíos, con el tope de la UI. */
export function cleanButtons(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of options) {
    if (typeof o !== 'string') continue;
    const label = o.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
    if (out.length >= AGENT_MAX_BUTTONS) break;
  }
  return out;
}

export function buttonsUi(options: unknown): AgentReplyUi | null {
  const list = cleanButtons(options);
  return list.length >= 1 ? { kind: 'buttons', options: list } : null;
}

export function formUi(form: AgentForm): AgentReplyUi {
  return {
    kind: 'form',
    formId: form.id,
    title: form.title || form.name,
    submitLabel: form.submitLabel,
    fields: form.fields.map((f) => ({ key: f.key, label: f.label, type: f.type, required: f.required, options: f.options })),
  };
}

/** Lee el JSON guardado en agent_messages.ui / chat_messages.ui (null si no es válido). */
export function parseUi(raw: string | null | undefined): AgentReplyUi | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<AgentReplyUi> & Record<string, unknown>;
    if (v?.kind === 'buttons') return buttonsUi(v.options);
    if (v?.kind === 'form' && typeof v.formId === 'string' && Array.isArray(v.fields)) {
      return {
        kind: 'form',
        formId: v.formId,
        title: typeof v.title === 'string' ? v.title : '',
        submitLabel: typeof v.submitLabel === 'string' ? v.submitLabel : '',
        fields: (v.fields as unknown[]).flatMap((f) => {
          const x = f as Record<string, unknown>;
          if (typeof x?.key !== 'string' || typeof x.label !== 'string') return [];
          const type = typeof x.type === 'string' ? x.type : 'text';
          return [
            {
              key: x.key,
              label: x.label,
              type: (['text', 'email', 'phone', 'number', 'select', 'textarea'].includes(type) ? type : 'text') as 'text',
              required: x.required === true,
              options: Array.isArray(x.options) ? x.options.filter((o): o is string => typeof o === 'string') : [],
            },
          ];
        }),
      };
    }
  } catch {
    /* JSON roto */
  }
  return null;
}

/**
 * El bloque como texto, para los canales que no dibujan botones ni
 * formularios: las opciones numeradas, o los datos que hay que mandar.
 */
export function uiAsText(ui: AgentReplyUi | null | undefined): string {
  if (!ui) return '';
  if (ui.kind === 'buttons') return ui.options.map((o, i) => `${i + 1}) ${o}`).join('\n');
  const fields = ui.fields.map((f) => `- ${f.label}${f.required ? ' *' : ''}${f.options.length ? ` (${f.options.join(' / ')})` : ''}`);
  return [ui.title, ...fields].filter(Boolean).join('\n');
}

/**
 * En un canal de solo texto, "2" contesta la opción 2 de los últimos botones.
 * Devuelve el texto de la opción, o el mensaje tal cual.
 */
export function resolveNumberedChoice(text: string, ui: AgentReplyUi | null | undefined): string {
  if (!ui || ui.kind !== 'buttons') return text;
  const m = /^\s*(\d{1,2})\s*[).]?\s*$/.exec(text);
  if (!m) return text;
  const i = Number(m[1]) - 1;
  return ui.options[i] ?? text;
}

export type FormSubmission =
  | { ok: true; text: string; values: Record<string, string> }
  | { ok: false; error: 'form_not_found' | 'form_invalid'; field?: string };

/**
 * Valida lo enviado contra la definición del formulario (obligatorios, email,
 * teléfono, número, opciones del select) y arma el texto que queda como
 * mensaje del visitante ("Email: ana@ejemplo.com").
 */
export function validateFormSubmission(form: AgentForm | undefined | null, raw: unknown): FormSubmission {
  if (!form) return { ok: false, error: 'form_not_found' };
  const input = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const values: Record<string, string> = {};
  for (const f of form.fields) {
    const v = typeof input[f.key] === 'string' ? (input[f.key] as string).replace(/\r\n?/g, '\n').trim().slice(0, f.type === 'textarea' ? 2000 : 300) : '';
    if (!v) {
      if (f.required) return { ok: false, error: 'form_invalid', field: f.key };
      continue;
    }
    if (f.type === 'email' && !EMAIL_RE.test(v)) return { ok: false, error: 'form_invalid', field: f.key };
    if (f.type === 'phone' && !PHONE_RE.test(v)) return { ok: false, error: 'form_invalid', field: f.key };
    if (f.type === 'number' && !Number.isFinite(Number(v.replace(',', '.')))) return { ok: false, error: 'form_invalid', field: f.key };
    if (f.type === 'select' && f.options.length && !f.options.includes(v)) return { ok: false, error: 'form_invalid', field: f.key };
    values[f.key] = f.type === 'email' ? v.toLowerCase() : v;
  }
  if (Object.keys(values).length === 0) return { ok: false, error: 'form_invalid' };
  const text = form.fields
    .filter((f) => values[f.key] !== undefined)
    .map((f) => `${f.label}: ${values[f.key]}`)
    .join('\n');
  return { ok: true, text, values };
}

/**
 * Valores de un formulario escritos como texto ("Email: ana@ejemplo.com" en
 * cada línea, como queda el mensaje de un formulario enviado). Lo usan los
 * canales que no dibujan formularios y el widget de Chat.
 */
export function parseFormText(form: AgentForm | undefined | null, text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!form) return out;
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').trim().toLowerCase();
  for (const line of text.split(/\n+/)) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const label = norm(line.slice(0, i));
    const value = line.slice(i + 1).trim();
    const field = form.fields.find((f) => norm(f.label) === label || norm(f.key) === label);
    if (field && value && out[field.key] === undefined) out[field.key] = value;
  }
  return out;
}

/** Campos de un formulario que van al contacto del CRM (por la clave del campo). */
export function crmContactFromForm(form: AgentForm, values: Record<string, string>): {
  email: string | null;
  firstName: string;
  lastName: string;
  phone: string;
  company: string;
  note: string;
} {
  const byKey = (keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(values).find((x) => x.toLowerCase() === k);
      if (hit && values[hit]) return values[hit];
    }
    return '';
  };
  const emailField = form.fields.find((f) => f.type === 'email' && values[f.key]);
  const email = (emailField ? values[emailField.key] : byKey(['email', 'mail', 'correo'])) || null;
  let firstName = byKey(['first_name', 'firstname', 'nombre']);
  let lastName = byKey(['last_name', 'lastname', 'apellido', 'sobrenome']);
  const full = byKey(['name', 'full_name', 'fullname', 'nome']);
  if (!firstName && full) {
    const [first, ...rest] = full.split(/\s+/);
    firstName = first ?? '';
    lastName = lastName || rest.join(' ');
  }
  const phoneField = form.fields.find((f) => f.type === 'phone' && values[f.key]);
  const phone = (phoneField ? values[phoneField.key] : byKey(['phone', 'telefono', 'teléfono', 'telefone', 'whatsapp'])) || '';
  const company = byKey(['company', 'empresa', 'company_name']);
  const note = form.fields
    .filter((f) => values[f.key] !== undefined)
    .map((f) => `${f.label}: ${values[f.key]}`)
    .join('\n');
  return { email: email && EMAIL_RE.test(email) ? email.toLowerCase() : null, firstName, lastName, phone, company, note };
}
