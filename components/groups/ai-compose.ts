import type { ComposeRequest } from '@/components/ai/compose-machine';
import type { ComposeResult } from '@/components/ai/useAiCompose';

/**
 * Lines: los pedidos de "Ayudame a escribir" contra las rutas del chat. El
 * borrador y los cambios van a /api/groups/chats/<id>/draft (con el contexto
 * del chat, las respuestas rápidas y la base de conocimiento); traducir va a
 * /api/groups/translate. La respuesta llega entera (no de a pedazos): mientras
 * tanto la barra muestra "Escribiendo…" y se puede cortar.
 */
export async function linesCompose(chatId: string, request: ComposeRequest, signal: AbortSignal): Promise<ComposeResult> {
  const [url, body] =
    request.kind === 'translate'
      ? ['/api/groups/translate', { text: request.text, to: request.to }]
      : request.kind === 'rewrite'
        ? [`/api/groups/chats/${chatId}/draft`, { mode: 'rewrite', text: request.text, change: request.change, instruction: request.instruction }]
        : [`/api/groups/chats/${chatId}/draft`, { mode: 'draft', instruction: request.instruction || undefined }];
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal });
    const data = (await res.json().catch(() => ({}))) as { text?: string; sources?: Array<{ title: string }>; error?: string };
    if (!res.ok) return { ok: false, code: typeof data.error === 'string' ? data.error : 'server_error' };
    return { ok: true, text: String(data.text ?? ''), sources: (data.sources ?? []).map((s) => s.title) };
  } catch {
    return { ok: false, code: signal.aborted ? 'aborted' : 'network_error' };
  }
}
