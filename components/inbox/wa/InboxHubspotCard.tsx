'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import { ChatPersonHubspot } from '@/components/groups/wa/PersonHubspot';
import HubspotScreen from '@/components/groups/HubspotScreen';
import HubspotMyProps from '@/components/groups/HubspotMyProps';
import { useHubspotSchema } from '@/components/groups/hubspot-client';
import { useHubspotDocked } from '@/components/groups/hubspot-dock';
import { api } from '@/components/groups/dialog-kit';
import type { ChatCompanyDto } from '@/lib/groups-hubspot-sync';
import { formatHubspotValue } from '@/lib/groups-hubspot-shared';

/**
 * HubSpot en la info de un chat 1:1 de WhatsApp de Inbox (el HubSpot del
 * workspace activo), igual que en Lines: el contacto (vincular o crear), la
 * empresa del contacto con las propiedades que la persona eligió, "Elegir
 * propiedades" y el panel con todas (que se puede fijar al costado). Sin
 * HubSpot conectado, o para un invitado, no se muestra.
 */
export default function InboxHubspotCard({ threadId }: { threadId: string }) {
  const t = useTranslations('inboxWa.contacts');
  const th = useTranslations('groups.hubspot');
  const tp = useTranslations('groups.props');
  const locale = useLocale();
  const { schema } = useHubspotSchema(true);
  const docked = useHubspotDocked();
  const [company, setCompany] = useState<ChatCompanyDto | null>(null);
  const [screen, setScreen] = useState(false);
  const [myProps, setMyProps] = useState(false);

  const loadCompany = useCallback(async () => {
    const res = await api<ChatCompanyDto>(`/api/inbox/hubspot/company?thread=${encodeURIComponent(threadId)}`);
    setCompany(res.data ?? null);
  }, [threadId]);

  useEffect(() => {
    setCompany(null);
    if (schema?.connected) void loadCompany();
  }, [schema?.connected, loadCompany]);

  if (!schema?.connected) return null;
  const names = schema.mine ?? schema.pinned;
  const defs = new Map(schema.props.map((p) => [p.name, p]));
  const format = { locale, owners: schema.owners, yes: tp('yes'), no: th('screen.no') };
  const shown = company?.company
    ? names
        .map((n) => defs.get(n))
        .filter((d): d is NonNullable<typeof d> => Boolean(d))
        .map((d) => ({ name: d.name, label: d.label, value: formatHubspotValue(d, company.values[d.name] ?? '', format) }))
        .filter((p) => p.value)
    : [];

  return (
    <section className="ib-wa-card ib-hs-card" data-testid="inbox-chat-hubspot">
      <h3 className="ib-wa-card-title">{t('hsSection')}</h3>
      <ChatPersonHubspot endpoint="/api/inbox/people" query={`thread=${encodeURIComponent(threadId)}`} canWrite onRow={() => void loadCompany()} />
      {company?.company && (
        <div className="ib-hs-company" data-testid="inbox-hs-company">
          {shown.length > 0 && (
            <dl className="gr-hs-props">
              {shown.map((p) => (
                <div key={p.name} data-prop={p.name}>
                  <dt>{p.label}</dt>
                  <dd>
                    <LocalText>{p.value}</LocalText>
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="gr-hs-title-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMyProps(true)} data-testid="hubspot-choose-props">
              {th('mine.open')}
            </button>
            {!docked && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setScreen(true)} data-testid="inbox-hs-open">
                {th('screen.open')}
              </button>
            )}
          </div>
        </div>
      )}
      <HubspotMyProps open={myProps} onClose={() => setMyProps(false)} />
      <HubspotScreen source={{ app: 'inbox', threadId }} open={screen} isAdmin={false} onClose={() => setScreen(false)} />
    </section>
  );
}
