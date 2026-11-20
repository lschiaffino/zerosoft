'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import LocalText from '@/components/ui/LocalText';
import { ChatPersonHubspot, ExternalIcon } from '@/components/groups/wa/PersonHubspot';
import HubspotScreen from '@/components/groups/HubspotScreen';
import HubspotMyProps from '@/components/groups/HubspotMyProps';
import { useHubspotSchema } from '@/components/groups/hubspot-client';
import { useHubspotDocked } from '@/components/groups/hubspot-dock';
import { api } from '@/components/groups/dialog-kit';
import type { ChatCompanyDto } from '@/lib/groups-hubspot-sync';
import { formatHubspotValue, type HubspotObjectKind, type HubspotSchemaDto } from '@/lib/groups-hubspot-shared';

type Records = Partial<Record<HubspotObjectKind, ChatCompanyDto | null>>;

/**
 * HubSpot en la info de un chat 1:1 de WhatsApp de Inbox (el HubSpot del
 * workspace activo), igual que en Lines: el contacto (vincular o crear) con
 * las propiedades que la persona eligió, la empresa y el negocio del contacto
 * con las suyas, "Elegir propiedades" y el panel con todas (que se puede fijar
 * al costado). Sin HubSpot conectado, o para un invitado, no se muestra.
 */
export default function InboxHubspotCard({ threadId }: { threadId: string }) {
  const t = useTranslations('inboxWa.contacts');
  const th = useTranslations('groups.hubspot');
  const tp = useTranslations('groups.props');
  const locale = useLocale();
  const { schema } = useHubspotSchema(true);
  const connected = Boolean(schema?.connected);
  const { schema: contactSchema } = useHubspotSchema(connected, 'contact');
  const { schema: dealSchema } = useHubspotSchema(connected, 'deal');
  const docked = useHubspotDocked();
  const [records, setRecords] = useState<Records>({});
  const [screen, setScreen] = useState(false);
  const [myProps, setMyProps] = useState(false);

  const loadKind = useCallback(
    async (kind: HubspotObjectKind) => {
      const res = await api<ChatCompanyDto>(`/api/inbox/hubspot/company?thread=${encodeURIComponent(threadId)}${kind === 'company' ? '' : `&type=${kind}`}`);
      setRecords((r) => ({ ...r, [kind]: res.data ?? null }));
    },
    [threadId],
  );
  const loadAll = useCallback(() => {
    for (const k of ['company', 'contact', 'deal'] as const) void loadKind(k);
  }, [loadKind]);

  useEffect(() => {
    setRecords({});
    if (connected) loadAll();
  }, [connected, loadAll]);

  if (!schema?.connected) return null;
  const format = { locale, owners: schema.owners, yes: tp('yes'), no: th('screen.no') };
  /** Las propiedades elegidas de un registro que tienen valor, como se leen. */
  const shownOf = (sc: HubspotSchemaDto | null, rec: ChatCompanyDto | null | undefined) => {
    if (!sc || !rec?.company) return [];
    const defs = new Map(sc.props.map((p) => [p.name, p]));
    return (sc.mine ?? sc.pinned)
      .map((n) => defs.get(n))
      .filter((d): d is NonNullable<typeof d> => Boolean(d))
      .map((d) => {
        const raw = rec.values[d.name] ?? '';
        return { name: d.name, label: d.label, value: raw === '•••' ? raw : formatHubspotValue(d, raw, { ...format, currency: rec.values.deal_currency_code }) };
      })
      .filter((p) => p.value);
  };
  const props = (kind: HubspotObjectKind, list: Array<{ name: string; label: string; value: string }>) =>
    list.length > 0 && (
      <dl className="gr-hs-props" data-testid={`inbox-hs-props-${kind}`}>
        {list.map((p) => (
          <div key={p.name} data-prop={p.name}>
            <dt>{p.label}</dt>
            <dd>
              <LocalText>{p.value}</LocalText>
            </dd>
          </div>
        ))}
      </dl>
    );
  const contact = records.contact?.company ? records.contact : null;
  const company = records.company?.company ? records.company : null;
  const deal = records.deal?.company ? records.deal : null;
  const any = Boolean(contact || company || deal);
  const contactShown = shownOf(contactSchema, contact);
  const companyShown = shownOf(schema, company);

  return (
    <section className="ib-wa-card ib-hs-card" data-testid="inbox-chat-hubspot">
      <h3 className="ib-wa-card-title">{t('hsSection')}</h3>
      <ChatPersonHubspot endpoint="/api/inbox/people" query={`thread=${encodeURIComponent(threadId)}`} canWrite onRow={loadAll} />
      {/* El nombre del contacto y de la empresa ya están arriba: acá van sus propiedades. */}
      {contactShown.length > 0 && (
        <div className="ib-hs-record" data-testid="inbox-hs-contact">
          <p className="gr-hs-kind">{th('types.contact')}</p>
          {props('contact', contactShown)}
        </div>
      )}
      {companyShown.length > 0 && (
        <div className="ib-hs-record" data-testid="inbox-hs-company">
          <p className="gr-hs-kind">{th('types.company')}</p>
          {props('company', companyShown)}
        </div>
      )}
      {deal && (
        <div className="ib-hs-record" data-testid="inbox-hs-deal">
          <p className="ib-hs-record-head">
            <span className="gr-hs-kind">{th('types.deal')}</span>
            <a className="gr-hs-name" href={deal.company?.url} target="_blank" rel="noopener noreferrer" aria-label={th('open', { name: deal.company?.name ?? '' })}>
              <span>{deal.company?.name}</span>
              <ExternalIcon />
            </a>
          </p>
          {deal.company?.broken ? <p className="ui-error">{th('screen.recordGone')}</p> : props('deal', shownOf(dealSchema, deal))}
        </div>
      )}
      {any && (
        <div className="gr-hs-title-actions ib-hs-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMyProps(true)} data-testid="hubspot-choose-props">
            {th('mine.open')}
          </button>
          {!docked && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScreen(true)} data-testid="inbox-hs-open">
              {th('screen.open')}
            </button>
          )}
        </div>
      )}
      <HubspotMyProps open={myProps} onClose={() => setMyProps(false)} />
      <HubspotScreen source={{ app: 'inbox', threadId }} open={screen} isAdmin={false} onClose={() => setScreen(false)} />
    </section>
  );
}
