'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import CrmDealList from '@/components/groups/wa/CrmDealList';
import { useDismiss } from '@/components/groups/wa/useDismiss';
import type { InboxCrmDto } from '@/lib/inbox/crm';
import { api } from '../api';

interface Hit {
  id: string;
  group: string;
  label: string;
}

/**
 * El CRM de zerosoft en la pestaña CRM de un chat de WhatsApp de Inbox, como en Lines: el contacto y la empresa
 * vinculados (con su link al CRM), buscar uno para vincular, los contactos con el mismo teléfono (un 1:1) y los
 * negocios. Todo con la visibilidad del CRM de quien mira (lib/inbox/crm.ts); sin la app CRM lo dice.
 */
export default function InboxCrm({ threadId, onError }: { threadId: string; onError: (code: string) => void }) {
  const td = useTranslations('groups.wa.details');
  const tc = useTranslations('groups.common');
  const [crm, setCrm] = useState<InboxCrmDto | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const search = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setFailed(false);
    void api<{ crm: InboxCrmDto | null }>(`/api/inbox/threads/${threadId}/wa?part=crm`).then((r) => {
      if (!live) return;
      if (r.ok) setCrm(r.data.crm);
      else setFailed(true);
    });
    return () => {
      live = false;
    };
  }, [threadId, retry]);

  // Buscar en el CRM (la búsqueda global, que ya filtra con la visibilidad de quien mira): contactos y empresas.
  useEffect(() => {
    const q = query.trim();
    if (!crm || q.length < 2) {
      setHits([]);
      return;
    }
    // Una búsqueda vieja que llega tarde (otra más nueva, o ya se vinculó) no pisa la lista.
    let live = true;
    const id = setTimeout(async () => {
      const r = await api<{ items: Hit[] }>(`/api/search?q=${encodeURIComponent(q)}`);
      if (live) setHits((r.ok ? r.data.items : []).filter((i) => i.group === 'contacts' || i.group === 'companies').slice(0, 8));
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [query, crm]);

  // La lista de resultados se cierra con Esc o con un toque afuera.
  useDismiss(hits.length > 0, () => setHits([]), [search]);

  async function link(patch: { crmContactId?: string | null; crmCompanyId?: string | null }) {
    setBusy(true);
    const r = await api<{ crm: InboxCrmDto | null }>(`/api/inbox/threads/${threadId}/wa`, { method: 'POST', json: { action: 'crm', ...patch } });
    setBusy(false);
    if (!r.ok) {
      onError(r.data.error ?? 'generic');
      return;
    }
    setCrm(r.data.crm);
    setQuery('');
    setHits([]);
  }

  if (failed) {
    return (
      <section className="ib-wa-card" data-testid="inbox-crm">
        <p className="ib-wa-muted" role="alert">
          {td('loadError')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setRetry((n) => n + 1)}>
            {td('retry')}
          </button>
        </p>
      </section>
    );
  }
  if (crm === undefined) {
    return (
      <section className="ib-wa-card" data-testid="inbox-crm" aria-busy="true">
        <span className="ui-skeleton ui-skeleton-row" />
      </section>
    );
  }
  if (crm === null) {
    return (
      <section className="ib-wa-card" data-testid="inbox-crm" data-off="true">
        <p className="ib-wa-muted">{td('crmOffInbox')}</p>
      </section>
    );
  }

  return (
    <>
      <section className="ib-wa-card ib-wa-crm" data-testid="inbox-crm" aria-busy={busy || undefined}>
        <h3 className="ib-wa-card-title">{td('crmTitle')}</h3>
        {(crm.company || crm.contact) && (
          <ul className="gr-crm-links">
            {crm.contact && (
              <li data-testid="inbox-crm-contact">
                <Link href={`/app/crm/contacts/${crm.contact.id}`}>{crm.contact.name || td('noName')}</Link>
                <span className="ui-help">{td('contact')}</span>
                <button type="button" className="btn btn-ghost btn-sm" data-testid="inbox-crm-unlink" disabled={busy} onClick={() => void link({ crmContactId: null })}>
                  {tc('remove')}
                </button>
              </li>
            )}
            {crm.company && (
              <li data-testid="inbox-crm-company">
                <Link href={`/app/crm/companies/${crm.company.id}`}>{crm.company.name || td('noName')}</Link>
                <span className="ui-help">{td('company')}</span>
                <button type="button" className="btn btn-ghost btn-sm" data-testid="inbox-crm-unlink" disabled={busy} onClick={() => void link({ crmCompanyId: null })}>
                  {tc('remove')}
                </button>
              </li>
            )}
          </ul>
        )}
        {crm.suggestions.length > 0 && (
          <div className="ib-wa-crm-suggest" data-testid="inbox-crm-suggestions">
            <p className="ui-help">{td('crmSamePhone')}</p>
            <ul className="gr-crm-links">
              {crm.suggestions.map((s) => (
                <li key={s.id}>
                  <Link href={`/app/crm/contacts/${s.id}`}>{s.name || td('noName')}</Link>
                  <button type="button" className="btn btn-secondary btn-sm" data-testid="inbox-crm-link" disabled={busy} onClick={() => void link({ crmContactId: s.id })}>
                    {td('crmLink')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {(!crm.company || !crm.contact) && (
          <div className="gr-crm-search" ref={search}>
            <input
              className="input"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && (query || hits.length)) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                  setHits([]);
                }
              }}
              placeholder={td('crmSearch')}
              aria-label={td('crmSearch')}
              data-testid="inbox-crm-search"
            />
            {hits.length > 0 && (
              <ul className="gr-crm-results" data-testid="inbox-crm-results">
                {hits.map((h) => (
                  <li key={`${h.group}-${h.id}`}>
                    <button type="button" disabled={busy} onClick={() => void link(h.group === 'contacts' ? { crmContactId: h.id } : { crmCompanyId: h.id })}>
                      {h.label} <span className="ui-help">{h.group === 'contacts' ? td('contact') : td('company')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <p className="ui-help">{td('crmInboxHelp')}</p>
      </section>
      {(crm.contact || crm.company) && (
        <section className="ib-wa-card" data-testid="details-deals">
          <h3 className="ib-wa-card-title">{td('deals')}</h3>
          <CrmDealList deals={crm.deals} />
        </section>
      )}
    </>
  );
}
