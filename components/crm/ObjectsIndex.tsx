'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { Link, useRouter } from '@/i18n/navigation';
import QuickModal, { useKeyShortcut } from '@/components/app/QuickModal';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import { notifyObjectsChanged } from './CrmObjectsBranch';

export interface ObjectRow {
  id: string;
  slug: string;
  singular: string;
  plural: string;
  description: string;
  records: number;
  properties: number;
}

/** Index de objetos propios: tabla y alta (solo admins) en un modal. */
export default function ObjectsIndex({ rows, canAdmin }: { rows: ObjectRow[]; canAdmin: boolean }) {
  const t = useTranslations('crm');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [singular, setSingular] = useState('');
  const [plural, setPlural] = useState('');
  const [pluralTouched, setPluralTouched] = useState(false);
  const [primaryLabel, setPrimaryLabel] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useKeyShortcut('c', () => setOpen(true), canAdmin && !open);

  useEffect(() => {
    if (canAdmin && searchParams.get('new') === '1') setOpen(true);
  }, [canAdmin, searchParams]);

  function close() {
    setOpen(false);
    setSingular('');
    setPlural('');
    setPluralTouched(false);
    setPrimaryLabel('');
    setDescription('');
    setError(null);
  }

  const pluralValue = pluralTouched ? plural : singular ? `${singular}s` : '';

  async function submit() {
    if (!singular.trim() || !pluralValue.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch('/api/crm/objects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        singular: singular.trim(),
        plural: pluralValue.trim(),
        primaryLabel: primaryLabel.trim() || undefined,
        description: description.trim() || undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (res?.status === 201) {
      const created = (await res.json()) as { slug: string };
      notifyObjectsChanged();
      close();
      router.push(`/app/crm/objects/${created.slug}?settings=1`);
      router.refresh();
      return;
    }
    const code = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
    setError(code && t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic'));
  }

  return (
    <>
      <PageHeader
        title={t('objects.title')}
        description={t('objects.subtitle')}
        actions={
          canAdmin ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
              {t('objects.newCta')}
              <kbd className="kbd" aria-hidden>
                C
              </kbd>
            </button>
          ) : null
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title={t('objects.emptyTitle')}
          body={canAdmin ? t('objects.emptyBody') : t('objects.emptyMember')}
          action={
            canAdmin ? (
              <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
                {t('objects.newCta')}
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="table crm-table" data-testid="objects-table">
            <caption className="sr-only">{t('objects.title')}</caption>
            <thead>
              <tr>
                <th scope="col">{t('objects.columnName')}</th>
                <th scope="col" className="num">
                  {t('objects.columnRecords')}
                </th>
                <th scope="col" className="num hide-sm">
                  {t('objects.columnProperties')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link href={`/app/crm/objects/${o.slug}`} className="cell-name">
                      {o.plural}
                    </Link>
                    {o.description && <span className="muted cell-sub">{o.description}</span>}
                  </td>
                  <td className="num">{o.records}</td>
                  <td className="num muted hide-sm">{o.properties}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <QuickModal
        open={open}
        onClose={close}
        title={t('objects.newTitle')}
        onSubmit={submit}
        submitLabel={busy ? t('common.creating') : t('common.create')}
        cancelLabel={t('common.cancel')}
        submitDisabled={!singular.trim() || !pluralValue.trim()}
        busy={busy}
        error={error}
      >
        <div className="qm-row">
          <label className="qm-field">
            <span>{t('objects.singular')}</span>
            <input
              data-autofocus
              value={singular}
              onChange={(e) => setSingular(e.target.value)}
              placeholder={t('objects.singularPlaceholder')}
              maxLength={80}
            />
          </label>
          <label className="qm-field">
            <span>{t('objects.plural')}</span>
            <input
              value={pluralValue}
              onChange={(e) => {
                setPluralTouched(true);
                setPlural(e.target.value);
              }}
              placeholder={t('objects.pluralPlaceholder')}
              maxLength={80}
            />
          </label>
        </div>
        <label className="qm-field">
          <span>{t('objects.primaryLabel')}</span>
          <input
            value={primaryLabel}
            onChange={(e) => setPrimaryLabel(e.target.value)}
            placeholder={t('objects.defaultPrimary')}
            maxLength={80}
            aria-describedby="obj-primary-help"
          />
        </label>
        <p className="ui-help" id="obj-primary-help">
          {t('objects.primaryLabelHelp')}
        </p>
        <label className="qm-field">
          <span>{t('objects.description')}</span>
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
        </label>
      </QuickModal>
    </>
  );
}
