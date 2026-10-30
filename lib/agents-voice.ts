/**
 * Agents — teléfono (Twilio). Un número de la cuenta de Twilio de la
 * instancia, asignado al workspace por el admin de la instancia
 * (AGENTS_VOICE_NUMBERS) y elegido en el agente (agents.voice_number, único), tiene como Voice URL
 * <app>/api/agents/voice. Cada llamada es una conversación del agente
 * (source 'voice'): Twilio reconoce lo que dice la persona (<Gather
 * input="speech">), el agente contesta con sus herramientas y Twilio lo lee
 * (<Say>). Si deriva, la llamada pasa al número de derivación (<Dial>) o se
 * corta con el aviso al equipo. Puro salvo voiceAgentForNumber.
 */
import { getDb } from './db';
import type { AgentRow } from './db';
import { xmlEscape, twiml } from './twilio-voice';

export const VOICE_MAX_SILENCES = 2;

/** Texto para leer en voz alta: sin la lista de fuentes, marcas [n] ni links. */
export function speakable(text: string): string {
  return text
    .replace(/\n\n(Sources|Fuentes|Fontes):\n[\s\S]*$/u, '')
    .replace(/ ?\[\d{1,2}\]/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_#`>]/g, '')
    .replace(/\s+\n/g, '\n')
    .trim()
    .slice(0, 1500);
}

export function voiceUrl(base: string, step: 'turn', extra: Record<string, string> = {}): string {
  return `${base}/api/agents/voice?${new URLSearchParams({ step, ...extra }).toString()}`;
}

/** Pregunta (o respuesta) y escucha la próxima frase. */
export function gatherTwiml(input: { base: string; say: string; language: string; silences?: number }): string {
  const action = voiceUrl(input.base, 'turn', { s: String(input.silences ?? 0) });
  const say = input.say ? `<Say language="${xmlEscape(input.language)}">${xmlEscape(input.say)}</Say>` : '';
  return twiml(
    `<Gather input="speech" action="${xmlEscape(action)}" method="POST" language="${xmlEscape(input.language)}" speechTimeout="auto" speechModel="phone_call" actionOnEmptyResult="true">${say}</Gather>`,
  );
}

/** Despedida o derivación: lee el texto y pasa a un número (si hay) o corta. */
export function endTwiml(input: { say: string; language: string; dial?: string | null }): string {
  const say = input.say ? `<Say language="${xmlEscape(input.language)}">${xmlEscape(input.say)}</Say>` : '';
  return twiml(`${say}${input.dial ? `<Dial>${xmlEscape(input.dial)}</Dial>` : '<Hangup/>'}`);
}

/** Frases fijas del teléfono, en el idioma del reconocimiento. */
export function voicePhrases(language: string): { greeting: string; silence: string; bye: string; unavailable: string } {
  if (language.startsWith('es')) {
    return { greeting: 'Hola, ¿en qué te puedo ayudar?', silence: '¿Seguís ahí? Contame en qué te ayudo.', bye: 'Gracias por llamar. Hasta luego.', unavailable: 'En este momento no podemos atender. Probá más tarde.' };
  }
  if (language.startsWith('pt')) {
    return { greeting: 'Olá, como posso ajudar?', silence: 'Você ainda está aí? Me conte como posso ajudar.', bye: 'Obrigado por ligar. Até logo.', unavailable: 'No momento não podemos atender. Tente mais tarde.' };
  }
  return { greeting: 'Hi, how can I help you?', silence: 'Are you still there? Tell me how I can help.', bye: 'Thanks for calling. Goodbye.', unavailable: 'We can’t take your call right now. Please try again later.' };
}

/**
 * Números de la cuenta de Twilio de la instancia que el admin de la instancia
 * asignó a cada workspace: AGENTS_VOICE_NUMBERS="+14155550123=<id o email del
 * dueño>,+14155550124=otro@x.com". Un workspace solo puede usar los suyos (la
 * cuenta de Twilio es de la instancia, no del workspace).
 */
/** Número a E.164: "00…" pasa a "+…" y se agrega el "+" que falte. null si no es válido. */
export function normalizeVoiceNumber(raw: string): string | null {
  let n = raw.replace(/[^\d+]/g, '');
  if (n.startsWith('00')) n = `+${n.slice(2)}`;
  else if (!n.startsWith('+')) n = `+${n}`;
  return /^\+[1-9]\d{7,14}$/.test(n) ? n : null;
}

const warned = new Set<string>();

/** Separados por coma o salto de línea. Un número repetido queda con su primer dueño (y se avisa en el log). */
export function voiceNumberMap(raw = process.env.AGENTS_VOICE_NUMBERS ?? ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of raw.split(/[,\n\r]+/)) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const n = normalizeVoiceNumber(part.slice(0, i).trim());
    const owner = part.slice(i + 1).trim().toLowerCase();
    if (!n || !owner) continue;
    const prev = out.get(n);
    if (prev !== undefined) {
      if (prev !== owner && !warned.has(n)) {
        warned.add(n);
        console.warn('[agents-voice] AGENTS_VOICE_NUMBERS repeats a number with another owner; the first one wins', n.slice(0, -4).replace(/\d/g, '•') + n.slice(-4));
      }
      continue;
    }
    out.set(n, owner);
  }
  return out;
}

/**
 * Antes de asignar un número a un agente: si lo tenía un agente de otro
 * workspace al que el mapeo ya no se lo da (cambió el dueño), se libera.
 */
export async function releaseStaleVoiceNumber(number: string): Promise<number> {
  const db = getDb();
  const holders = (await db
    .prepare('SELECT a.id, a.user_id, u.email FROM agents a LEFT JOIN users u ON u.id = a.user_id WHERE a.voice_number = ?')
    .all(number)) as Array<{ id: string; user_id: string; email: string | null }>;
  let released = 0;
  for (const h of holders) {
    if (voiceNumbersFor({ id: h.user_id, email: h.email }).includes(number)) continue;
    released += (await db.prepare('UPDATE agents SET voice_number = NULL WHERE id = ? AND voice_number = ?').run(h.id, number)).changes;
  }
  return released;
}

/** Números asignados a un workspace (por id o email del dueño). */
export function voiceNumbersFor(owner: { id: string; email?: string | null }): string[] {
  const keys = new Set([owner.id.toLowerCase(), (owner.email ?? '').toLowerCase()].filter(Boolean));
  return [...voiceNumberMap().entries()].filter(([, o]) => keys.has(o)).map(([n]) => n);
}

/** Agente que atiende un número (E.164), si está activo y el número es de su workspace. */
export async function voiceAgentForNumber(number: string): Promise<AgentRow | null> {
  if (!number) return null;
  const agent = ((await getDb().prepare('SELECT * FROM agents WHERE voice_number = ? AND enabled = 1').get(number)) as AgentRow | undefined) ?? null;
  if (!agent) return null;
  const owner = (await getDb().prepare('SELECT id, email FROM users WHERE id = ?').get(agent.user_id)) as { id: string; email: string | null } | undefined;
  return owner && voiceNumbersFor(owner).includes(number) ? agent : null;
}
