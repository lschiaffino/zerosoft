import type { ComposeRequest } from '@/components/ai/compose-machine';
import type { ComposeResult } from '@/components/ai/useAiCompose';

/** Marca de error al final de un stream (igual que STREAM_ERROR_MARK en lib/inbox/ai.ts). */
const ERROR_MARK = '\u0000error:';

type Channel = 'whatsapp' | 'gmail';
type Mode = 'polish' | 'shorter' | 'longer' | 'formal' | 'casual' | 'fix' | 'custom';

/** Lo que entiende POST /api/inbox/ai (lib/inbox/schemas.ts, aiSchema). */
export type InboxAiAsk =
  | { action: 'draft'; threadId: string; instruction?: string }
  | { action: 'new'; channel: Channel; instruction: string; to?: string; subject?: string }
  | { action: 'rewrite'; text: string; mode: Mode; instruction?: string; threadId?: string; channel?: Channel };

/**
 * Pide texto a la IA de Inbox y lo va pasando a `onText` (el texto entero
 * hasta ahora) a medida que llega. Nunca lanza: devuelve el texto final o el
 * código de error.
 */
export async function streamInboxAi(ask: InboxAiAsk, onText: (full: string) => void, signal?: AbortSignal): Promise<ComposeResult> {
  let res: Response;
  try {
    res = await fetch('/api/inbox/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...ask, stream: true }), signal });
  } catch {
    return { ok: false, code: signal?.aborted ? 'aborted' : 'network' };
  }
  if (!res.ok || !res.body) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, code: data.error ?? (res.status === 429 ? 'rate_limited' : 'ai_failed') };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let full = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      full += dec.decode(value, { stream: true });
      const at = full.indexOf(ERROR_MARK);
      if (at >= 0) return { ok: false, code: full.slice(at + ERROR_MARK.length).trim() || 'ai_failed' };
      onText(full.trimStart());
    }
  } catch {
    return { ok: false, code: signal?.aborted ? 'aborted' : 'network' };
  }
  return { ok: true, text: full.trim() };
}

const LANG_NAME: Record<string, string> = { en: 'English', es: 'Spanish', pt: 'Portuguese' };
export const INBOX_TRANSLATE_LANGS = Object.keys(LANG_NAME);

/**
 * Pedido de la barra → pedido de Inbox. `where` dice de dónde sale el
 * contexto: un chat abierto (`threadId`) o un mensaje nuevo que todavía no
 * tiene chat (canal, destinatario y asunto escritos en el diálogo).
 */
export function inboxAsk(request: ComposeRequest, where: { threadId: string } | { channel: Channel; to?: string; subject?: string }): InboxAiAsk | null {
  const scope = 'threadId' in where ? { threadId: where.threadId } : { channel: where.channel };
  if (request.kind === 'translate') {
    const lang = LANG_NAME[request.to];
    if (!lang) return null;
    return { action: 'rewrite', text: request.text, mode: 'custom', instruction: `Translate the message to ${lang}. Keep the meaning, the tone and the formatting.`, ...scope };
  }
  if (request.kind === 'rewrite') return { action: 'rewrite', text: request.text, mode: request.change, instruction: request.instruction, ...scope };
  if ('threadId' in where) return { action: 'draft', threadId: where.threadId, instruction: request.instruction || undefined };
  if (!request.instruction.trim()) return null;
  return { action: 'new', channel: where.channel, instruction: request.instruction, to: where.to?.trim().slice(0, 1000) || undefined, subject: where.subject?.trim().slice(0, 300) || undefined };
}

/** Corre un pedido de la barra contra Inbox (la respuesta llega de a pedazos). */
export async function inboxCompose(request: ComposeRequest, where: Parameters<typeof inboxAsk>[1], onText: (partial: string) => void, signal: AbortSignal): Promise<ComposeResult> {
  const ask = inboxAsk(request, where);
  if (!ask) return { ok: false, code: 'invalid_input' };
  return streamInboxAi(ask, onText, signal);
}
