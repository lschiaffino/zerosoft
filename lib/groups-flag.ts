/**
 * Groups: marcado de mensajes sin responder con AI (como el "flagging" de
 * Periskope). En el modo "preguntas" de los ajustes, cada mensaje de cliente
 * pasa por el modelo, que dice si pide respuesta (pregunta, pedido, problema)
 * o es un comentario ("gracias", "ok", un sticker). Solo lo que pide
 * respuesta deja al chat esperando; el cron lo marca pasado el umbral.
 *
 * La llamada pasa por lib/ai.ts (cuota, rate limit, ai_usage). Si la AI no
 * está disponible o falla, el mensaje cuenta como pregunta: es mejor marcar
 * de más que dejar a un cliente sin respuesta. En e2e (GROUPS_AI_FAKE=1)
 * corre contra un modelo falso que usa la regla de looksLikeQuestion.
 * Server-only.
 */
import { generateText } from 'ai';
import { assertAiAvailable, assertAiQuota, recordAiUsage, resolveAiModel } from './ai';
import { fakeModel } from './crm-ai-fake';
import { getDb } from './db';
import { getSettings } from './groups';
import { looksLikeQuestion } from './groups-rules';

const MARK = 'MESSAGE:';

/** Modelo falso para e2e: nunca en un deploy de producción. */
export function groupsAiFakeActive(): boolean {
  if (process.env.GROUPS_AI_FAKE !== '1') return false;
  if (process.env.VERCEL_ENV === 'production') return false;
  return process.env.NODE_ENV === 'test' || process.env.DEMO_MODE === 'true';
}

export function flagPrompt(body: string, rules: string): string {
  return [
    'You triage WhatsApp messages from customers for a support team.',
    'Answer with exactly one word: QUESTION if the message asks something, requests an action, reports a problem or otherwise needs a reply from the team; COMMENT if it does not (thanks, greetings, acknowledgements, reactions, small talk).',
    ...(rules.trim() ? ['Team rules (they win over the defaults):', rules.trim()] : []),
    '',
    MARK,
    body.slice(0, 1500),
  ].join('\n');
}

/** true si el mensaje pide respuesta. Tira AiError si la AI no está disponible. */
export async function classifyNeedsReply(ws: string, body: string, rules = ''): Promise<boolean> {
  const fake = groupsAiFakeActive();
  let choice;
  if (fake) {
    await assertAiQuota(ws);
    choice = {
      model: fakeModel((info) => {
        const text = info.userTexts.join('\n');
        const msg = text.slice(text.lastIndexOf(MARK) + MARK.length);
        return { text: looksLikeQuestion(msg) ? 'QUESTION' : 'COMMENT' };
      }),
      modelId: 'groups-fake',
    };
  } else {
    await assertAiAvailable(ws);
    choice = resolveAiModel();
  }
  const res = await generateText({
    model: choice.model,
    prompt: flagPrompt(body, rules),
    maxOutputTokens: 5,
    temperature: 0,
    timeout: 20_000,
    maxRetries: 1,
  });
  await recordAiUsage({
    workspaceId: ws,
    feature: 'groups_flag',
    model: choice.modelId,
    inputTokens: res.totalUsage?.inputTokens ?? 0,
    outputTokens: res.totalUsage?.outputTokens ?? 0,
  }).catch(() => {});
  return !/^\s*comment/i.test(res.text);
}

/**
 * Después de guardar un mensaje entrante en el modo "preguntas": lo
 * clasifica y, si pide respuesta, el chat pasa a esperar desde ese mensaje.
 * No pisa una respuesta que llegó mientras tanto (el NOT EXISTS de salida).
 */
export async function flagInbound(ws: string, chatId: string, msg: { id: string; body: string; created_at: string; media_type?: string }): Promise<boolean> {
  const settings = await getSettings(ws);
  if (settings.flagMode !== 'questions') return false;
  let needs = true;
  let known: number | null = null;
  if (msg.body.trim()) {
    try {
      needs = await classifyNeedsReply(ws, msg.body, settings.flagRules);
      known = needs ? 1 : 0;
    } catch {
      needs = true;
    }
  }
  const db = getDb();
  await db.prepare('UPDATE groups_messages SET needs_reply = ? WHERE id = ?').run(known, msg.id);
  if (!needs) return false;
  await db
    .prepare(
      `UPDATE groups_chats SET awaiting_since = COALESCE(awaiting_since, ?) WHERE id = ? AND status = 'open'
       AND NOT EXISTS (SELECT 1 FROM groups_messages m WHERE m.chat_id = ? AND m.direction = 'out' AND m.author_kind != 'broadcast' AND m.created_at >= ?)`,
    )
    .run(msg.created_at, chatId, chatId, msg.created_at);
  return true;
}
