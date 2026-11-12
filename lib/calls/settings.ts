/**
 * Calls: ajustes del workspace (metodología, competidores, visibilidad, bot,
 * CRM y canal de Talk) y la regla de grabación de cada persona. Server-only.
 */
import { z } from 'zod';
import { getDb } from '../db';
import { AUTO_JOIN_RULES, CALLS_COST_TIERS, CallsError, DEFAULT_SETTINGS, METHODOLOGIES, nowIso, parseJson, type AutoJoinRule, type CallsActor, type CallsSettings } from './types';

export const settingsSchema = z.object({
  methodology: z.enum(METHODOLOGIES as unknown as [string, ...string[]]).optional(),
  customCriteria: z.array(z.string().trim().max(120)).max(12).optional(),
  competitors: z.array(z.string().trim().max(60)).max(50).optional(),
  visibility: z.enum(['team', 'private']).optional(),
  botName: z.string().trim().max(60).optional(),
  consentMessage: z.string().trim().max(500).optional(),
  logToCrm: z.boolean().optional(),
  talkChannel: z.string().trim().max(80).optional(),
  costTier: z.enum(CALLS_COST_TIERS).optional(),
});

export async function getSettings(ws: string): Promise<CallsSettings> {
  const row = (await getDb().prepare('SELECT data FROM calls_settings WHERE workspace_id = ?').get(ws)) as { data: string } | undefined;
  const data = parseJson<Partial<CallsSettings>>(row?.data, {});
  return { ...DEFAULT_SETTINGS, ...data, botName: botDisplayName(data.botName ?? '') };
}

/**
 * Nombre del bot en la reunión: siempre dice que es un notetaker, para que
 * nadie lo confunda con una persona (un nombre propio suma " (Notetaker)").
 */
export function botDisplayName(raw: string): string {
  const name = raw.trim().slice(0, 45) || DEFAULT_SETTINGS.botName;
  return /notetaker/i.test(name) ? name : `${name} (Notetaker)`;
}

/** Solo admins: lo que cambia es de todo el workspace. */
export async function updateSettings(actor: CallsActor, patch: z.infer<typeof settingsSchema>): Promise<CallsSettings> {
  if (!actor.admin) throw new CallsError('forbidden', 403);
  const cur = await getSettings(actor.ws);
  const next: CallsSettings = {
    ...cur,
    ...(patch.methodology ? { methodology: patch.methodology as CallsSettings['methodology'] } : {}),
    ...(patch.customCriteria ? { customCriteria: patch.customCriteria.filter(Boolean) } : {}),
    ...(patch.competitors ? { competitors: [...new Set(patch.competitors.filter(Boolean))] } : {}),
    ...(patch.visibility ? { visibility: patch.visibility } : {}),
    ...(patch.botName !== undefined ? { botName: botDisplayName(patch.botName) } : {}),
    ...(patch.consentMessage !== undefined ? { consentMessage: patch.consentMessage } : {}),
    ...(patch.logToCrm !== undefined ? { logToCrm: patch.logToCrm } : {}),
    ...(patch.costTier ? { costTier: patch.costTier } : {}),
  };
  if (patch.talkChannel !== undefined) {
    const name = patch.talkChannel.replace(/^#/, '').trim();
    if (name) {
      const { findChannel } = await import('../talk-bot');
      const { getMembership } = await import('../talk');
      const ch = await findChannel(actor.ws, name);
      if (!ch) throw new CallsError('channel_not_found', 404);
      // Publica como bot solo donde quien lo configura es miembro (como los webhooks de Talk).
      if (!(await getMembership(ch.id, actor.person))) throw new CallsError('channel_not_member', 403);
      next.talkChannel = ch.name;
      next.talkChannelSetBy = actor.person;
    } else {
      next.talkChannel = '';
      next.talkChannelSetBy = null;
    }
  }
  await getDb()
    .prepare('INSERT INTO calls_settings (workspace_id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT (workspace_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
    .run(actor.ws, JSON.stringify(next), nowIso());
  return next;
}

export async function getAutoJoin(ws: string, person: string): Promise<AutoJoinRule> {
  const row = (await getDb().prepare('SELECT auto_join FROM calls_prefs WHERE workspace_id = ? AND person_id = ?').get(ws, person)) as { auto_join: string } | undefined;
  return (AUTO_JOIN_RULES as readonly string[]).includes(row?.auto_join ?? '') ? (row!.auto_join as AutoJoinRule) : 'manual';
}

export async function setAutoJoin(actor: CallsActor, rule: AutoJoinRule): Promise<AutoJoinRule> {
  if (!(AUTO_JOIN_RULES as readonly string[]).includes(rule)) throw new CallsError('invalid_input', 400);
  // synced_at = NULL: la próxima corrida vuelve a mirar el calendario con la regla nueva.
  await getDb()
    .prepare(
      `INSERT INTO calls_prefs (workspace_id, person_id, auto_join, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (workspace_id, person_id) DO UPDATE SET auto_join = excluded.auto_join, synced_at = NULL, updated_at = excluded.updated_at`,
    )
    .run(actor.ws, actor.person, rule, nowIso());
  return rule;
}

/** Mensaje que el bot deja en el chat de la reunión al entrar. */
export function consentText(settings: CallsSettings, ownerName: string, locale: 'en' | 'es' | 'pt' = 'en'): string {
  const who = ownerName.trim() || 'the host';
  const by = { en: `for ${who}`, es: `para ${who}`, pt: `para ${who}` }[locale];
  // Un aviso propio siempre lleva la frase de grabación al final: no se puede grabar sin decirlo.
  const must = { en: 'This call is being recorded and transcribed.', es: 'Esta llamada se graba y se transcribe.', pt: 'Esta chamada está sendo gravada e transcrita.' }[locale];
  if (settings.consentMessage.trim()) return `${settings.consentMessage.trim().slice(0, 400)} ${must}`;
  return {
    en: `Hi, I'm ${settings.botName}. This call is being recorded and transcribed ${by}. If you'd rather not be recorded, say so and the host can remove me.`,
    es: `Hola, soy ${settings.botName}. Esta llamada se graba y se transcribe ${by}. Si preferís que no se grabe, decilo y quien organiza me puede sacar.`,
    pt: `Olá, sou ${settings.botName}. Esta chamada está sendo gravada e transcrita ${by}. Se preferir não ser gravado, avise e quem organiza pode me remover.`,
  }[locale];
}
