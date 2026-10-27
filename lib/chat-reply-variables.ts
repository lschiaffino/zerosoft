/**
 * Chat — variables en respuestas guardadas y macros, como los atributos de
 * Intercom: {{name}}, {{first_name}}, {{email}}, {{agent_name}},
 * {{agent_first_name}}, {{widget}} y cualquier atributo de conversación por su
 * id ({{plan}}). Con respaldo: {{first_name|there}} usa "there" si falta el
 * dato. Lo que no se conoce se deja tal cual y se avisa en el compositor (así
 * se corrige antes de enviar). Puro: lo usan el compositor y el servidor.
 */

export interface ReplyVariableContext {
  visitorName?: string | null;
  visitorEmail?: string | null;
  agentName?: string | null;
  widgetName?: string | null;
  /** Atributos de conversación: id → valor. */
  attributes?: Record<string, string | number | boolean | null | undefined>;
}

export const REPLY_VARIABLES = ['name', 'first_name', 'email', 'agent_name', 'agent_first_name', 'widget'] as const;

const PATTERN = /\{\{\s*([a-zA-Z0-9_.-]{1,64})\s*(?:\|([^}]{0,80}))?\}\}/g;

function firstName(full: string | null | undefined): string {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}

function lookup(key: string, ctx: ReplyVariableContext): string | undefined {
  switch (key.toLowerCase()) {
    case 'name':
      return ctx.visitorName?.trim() || undefined;
    case 'first_name':
      return firstName(ctx.visitorName) || undefined;
    case 'email':
      return ctx.visitorEmail?.trim() || undefined;
    case 'agent_name':
      return ctx.agentName?.trim() || undefined;
    case 'agent_first_name':
      return firstName(ctx.agentName) || undefined;
    case 'widget':
    case 'company':
      return ctx.widgetName?.trim() || undefined;
  }
  const attr = ctx.attributes?.[key];
  if (attr === null || attr === undefined || attr === '') return undefined;
  return String(attr);
}

/** Reemplaza las variables conocidas; devuelve también las que quedaron sin valor. */
export function fillReplyVariables(text: string, ctx: ReplyVariableContext): { text: string; missing: string[]; unknown: string[] } {
  const missing: string[] = [];
  const unknown: string[] = [];
  const out = text.replace(PATTERN, (whole, key: string, fallback: string | undefined) => {
    const value = lookup(key, ctx);
    if (value !== undefined) return value;
    if (fallback !== undefined) return fallback.trim();
    const known = (REPLY_VARIABLES as readonly string[]).includes(key.toLowerCase()) || key.toLowerCase() === 'company' || (ctx.attributes && key in ctx.attributes);
    if (known) {
      missing.push(key);
      return '';
    }
    unknown.push(key);
    return whole;
  });
  // Un hueco vacío deja "Hola ," o dobles espacios: se limpian.
  const cleaned = out.replace(/[ \t]+([,.!?;:])/g, '$1').replace(/[ \t]{2,}/g, ' ');
  return { text: cleaned, missing, unknown };
}
