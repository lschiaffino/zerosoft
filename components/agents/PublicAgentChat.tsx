'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import AgentChat from './AgentChat';
import { chatLabels } from './agents-ui';

const VISITOR_KEY = 'zs-agent-visitor';

function visitorKey(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 16) return existing;
    const fresh = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
    window.localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    return `${crypto.randomUUID()}`.replace(/-/g, '') + Date.now().toString(36);
  }
}

/** Chat de la página pública /a/<handle> (la conversación se recuerda en este navegador). */
export default function PublicAgentChat({
  handle,
  welcome,
  offline,
}: {
  handle: string;
  welcome: string;
  offline: boolean;
}) {
  const t = useTranslations('agents');
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => setKey(visitorKey()), []);
  return (
    <AgentChat
      endpoint={`/api/agents/public/${encodeURIComponent(handle)}`}
      labels={chatLabels(t)}
      welcome={welcome}
      extraBody={key ? { visitorKey: key } : undefined}
      storageKey={`zs-agent-conv:${handle}`}
      disabledReason={offline ? t('public.offline') : key ? null : t('chat.thinking')}
      variant="page"
      historyUrl={
        key
          ? (id) =>
              `/api/agents/public/${encodeURIComponent(handle)}?conversationId=${encodeURIComponent(id)}&visitorKey=${encodeURIComponent(key)}`
          : undefined
      }
    />
  );
}
