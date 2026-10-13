import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { getAgentByHandle } from '@/lib/agents';
import { aiEnabled } from '@/lib/ai';
import PublicAgentChat from '@/components/agents/PublicAgentChat';
import '@/styles/agents.css';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string; handle: string }> };

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { handle } = await props.params;
  const agent = await getAgentByHandle(handle);
  if (!agent || agent.enabled !== 1) return { title: 'Not found', robots: { index: false } };
  return { title: agent.name, robots: { index: false } };
}

/** Página pública de un agente: chat a pantalla completa, sin chrome del sitio. */
export default async function PublicAgentPage(props: Props) {
  const { locale, handle } = await props.params;
  const agent = await getAgentByHandle(handle);
  if (!agent || agent.enabled !== 1) notFound();
  const t = await getTranslations({ locale, namespace: 'agents' });
  return (
    <main className="ag-public">
      <header className="ag-public-head">
        <span className="ag-avatar ag-avatar-lg" aria-hidden="true">
          {agent.emoji || agent.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1>{agent.name}</h1>
          <p className="muted">{t('public.subtitle')}</p>
        </div>
      </header>
      <PublicAgentChat
        handle={agent.public_handle ?? handle}
        welcome={agent.welcome_message || t('public.defaultWelcome')}
        offline={!aiEnabled()}
      />
      <p className="ag-public-foot muted">{t('public.disclaimer')}</p>
    </main>
  );
}
