'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import DataTable from '@/components/ui/DataTable';
import EmptyState from '@/components/ui/EmptyState';
import FormSection from '@/components/ui/FormSection';
import LocalText from '@/components/ui/LocalText';
import type { ConnectedClient } from '@/lib/oauth/store';
import { parseDbUtc } from '@/lib/utils';

const fmt = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(parseDbUtc(iso));

/** Ajustes › API: lo que la persona conectó por OAuth (Claude, la CLI). Solo lo suyo, aunque sea admin. */
export default function ConnectedClientsPanel({ initial }: { initial: ConnectedClient[] }) {
  const t = useTranslations('settings.connected');
  const locale = useLocale();
  const [clients, setClients] = useState(initial);
  const [target, setTarget] = useState<ConnectedClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/oauth/grants', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: target.id }),
      });
      if (!res.ok && res.status !== 404) throw new Error(String(res.status));
      setClients((prev) => prev.filter((c) => c.id !== target.id));
      setTarget(null);
    } catch {
      setError(t('error'));
      setTarget(null);
    }
    setBusy(false);
  }

  return (
    <FormSection id="connected" title={t('title')} description={t('desc')} footer={<p className="ui-section-note">{t('note')}</p>}>
      {error && <p className="ui-error" role="alert">{error}</p>}
      <DataTable
        caption={t('title')}
        rows={clients}
        rowKey={(c) => c.id}
        compact
        className="st-table-stack"
        empty={<EmptyState quiet title={t('emptyTitle')} body={t('emptyBody')} action={{ label: t('emptyAction'), href: '/docs/mcp' }} />}
        columns={[
          {
            key: 'name',
            header: t('colClient'),
            cell: (c) => (
              <span className="st-connected-app">
                <span className="st-strong">{c.clientName}</span>
                <span className="st-muted">{c.origin.kind === 'host' ? c.origin.host : t(c.origin.kind === 'device' ? 'originDevice' : 'originLocal')}</span>
                <span className="st-muted">
                  <LocalText>{t('connectedOn', { date: fmt(c.createdAt, locale) })}</LocalText>
                </span>
              </span>
            ),
          },
          { key: 'workspace', header: t('colWorkspace'), cell: (c) => c.workspaceName ?? t('ownWorkspace') },
          { key: 'scope', header: t('colAccess'), cell: (c) => <span className="st-nowrap">{t(c.scope.split(' ').includes('write') ? 'accessWrite' : 'accessRead')}</span> },
          {
            key: 'used',
            header: t('colLastUsed'),
            cell: (c) => (
              <span className="st-connected-app st-nowrap">
                {c.lastUsedAt ? <LocalText>{fmt(c.lastUsedAt, locale)}</LocalText> : <span className="st-muted">{t('never')}</span>}
                <span className="st-muted">{t('changes', { count: c.writes })}</span>
              </span>
            ),
            data: true,
          },
          {
            key: 'actions',
            header: <span className="sr-only">{t('colActions')}</span>,
            cell: (c) => (
              <div className="st-row-actions">
                <button type="button" className="btn btn-ghost btn-danger btn-sm" onClick={() => setTarget(c)} disabled={busy} aria-label={`${t('revoke')} ${c.clientName}`}>
                  {t('revoke')}
                </button>
              </div>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={Boolean(target)}
        title={t('confirmTitle', { client: target?.clientName ?? '' })}
        body={t('confirmBody')}
        confirmLabel={t('revoke')}
        cancelLabel={t('cancel')}
        danger
        busy={busy}
        onConfirm={() => void revoke()}
        onCancel={() => setTarget(null)}
      />
    </FormSection>
  );
}
