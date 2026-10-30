import type { useTranslations } from 'next-intl';
import type { AgentChatLabels } from './AgentChat';

type T = ReturnType<typeof useTranslations<'agents'>>;

/** Mensaje traducido para un código de error de la API (agents.errors.*). */
export function errorText(t: T, code: string | null | undefined): string {
  const key = `errors.${code ?? 'generic'}`;
  return t.has(key as never) ? t(key as never) : t('errors.generic');
}

export function toolName(t: T, tool: string): string {
  const key = `tools.items.${tool}.name`;
  return t.has(key as never) ? t(key as never) : tool;
}

export function chatLabels(t: T): AgentChatLabels {
  return {
    placeholder: t('chat.placeholder'),
    send: t('chat.send'),
    thinking: t('chat.thinking'),
    newConversation: t('chat.newConversation'),
    handoff: t('chat.handoff'),
    stepLimit: t('chat.stepLimit'),
    input: t('chat.input'),
    output: t('chat.output'),
    toolError: t('chat.toolError'),
    running: t('chat.running'),
    handedOffNotice: t('chat.handedOffNotice'),
    teammate: t('chat.teammate'),
    simulated: t('chat.simulated'),
    wouldRun: t('chat.wouldRun'),
    formSend: t('chat.formSend'),
    formRequired: t('chat.formRequired'),
    formChoose: t('chat.formChoose'),
    error: (code) => errorText(t, code),
    toolName: (tool) => toolName(t, tool),
  };
}

export async function api<R>(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; data: R & { error?: string } }> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  }).catch(() => null);
  const data = ((await res?.json().catch(() => null)) ?? {}) as R & { error?: string };
  return { ok: Boolean(res?.ok), status: res?.status ?? 0, data };
}
