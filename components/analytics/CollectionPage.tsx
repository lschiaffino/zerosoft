'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { useSearchParams } from 'next/navigation';
import PageHeader from '@/components/ui/PageHeader';
import EmptyState from '@/components/ui/EmptyState';
import NameDialog from './NameDialog';
import RecordList, { type RecordItem } from './RecordList';
import { ApiError, api, notifyChanged, setProjectCookie } from './client';

export type CollectionKind = 'insights' | 'dashboards' | 'flags' | 'cohorts' | 'projects';

const ENDPOINT: Record<CollectionKind, string> = {
  insights: '/api/analytics/insights',
  dashboards: '/api/analytics/dashboards',
  flags: '/api/analytics/flags',
  cohorts: '/api/analytics/cohorts',
  projects: '/api/analytics/projects',
};

/** Clave de flag válida a partir de lo que se escribe ("Nuevo checkout" → "nuevo-checkout"). */
export function flagKeyFrom(text: string): string {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100) || 'flag'
  );
}

/**
 * Lista de una colección de Analytics con su estado vacío, crear (modal con
 * el nombre o, para insights, el editor) y renombrar o borrar cada fila.
 */
export default function CollectionPage({
  kind,
  projectId,
  items,
  canCreate,
  canEdit,
  description,
  extra,
}: {
  kind: CollectionKind;
  projectId: string | null;
  items: RecordItem[];
  canCreate: boolean;
  canEdit: boolean;
  description?: string;
  extra?: ReactNode;
}) {
  const t = useTranslations(`analytics.${kind}`);
  const tc = useTranslations('analytics.common');
  const router = useRouter();
  const search = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (search.get('new') === '1' && canCreate && kind !== 'insights') setCreating(true);
  }, [search, canCreate, kind]);

  const create = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const body =
        kind === 'projects'
          ? { name }
          : kind === 'flags'
            ? { projectId, key: flagKeyFrom(name), name: '' }
            : kind === 'cohorts'
              ? { projectId, name, definition: { properties: [], behavior: { event: '$pageview', days: 30, minCount: 1 } } }
              : { projectId, name };
      const res = await api<Record<string, { id: string }>>(ENDPOINT[kind], { body });
      const created = Object.values(res)[0];
      notifyChanged();
      setCreating(false);
      if (kind === 'projects') {
        setProjectCookie(created.id);
        router.push('/app/analytics/settings');
        router.refresh();
      } else if (kind === 'cohorts') {
        router.push(`/app/analytics/cohorts?open=${created.id}`);
        router.refresh();
      } else {
        router.push(`/app/analytics/${kind}/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? tc('errorCode', { code: err.code }) : tc('error'));
    } finally {
      setBusy(false);
    }
  };

  const createButton = canCreate ? (
    kind === 'insights' ? (
      <Link href="/app/analytics/insights/new" className="btn btn-primary">
        {t('new')}
      </Link>
    ) : (
      <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
        {t('new')}
      </button>
    )
  ) : null;

  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={description ?? t('description')} actions={createButton} />
      {extra}
      {items.length === 0 ? (
        <EmptyState
          product="analytics"
          title={t('emptyTitle')}
          body={t('emptyBody')}
          action={
            canCreate ? (
              kind === 'insights' ? (
                { label: t('new'), href: '/app/analytics/insights/new' }
              ) : (
                <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                  {t('new')}
                </button>
              )
            ) : undefined
          }
        />
      ) : (
        <RecordList
          items={items}
          canEdit={canEdit}
          testId={`an-list-${kind}`}
          labels={{
            name: t('name'),
            meta: t.has('meta') ? t('meta') : undefined,
            rename: tc('rename'),
            delete: tc('delete'),
            deleteTitle: (name) => t('deleteTitle', { name }),
            deleteBody: t('deleteBody'),
          }}
          onRename={async (id, name) => {
            const url = kind === 'projects' ? `/api/analytics/projects/${id}` : `${ENDPOINT[kind]}/${id}`;
            await api(url, { method: 'PATCH', body: { name } });
          }}
          onDelete={async (id) => {
            await api(`${ENDPOINT[kind]}/${id}`, { method: 'DELETE' });
          }}
        />
      )}
      <NameDialog
        open={creating}
        title={t('new')}
        label={kind === 'flags' ? t('key') : t('name')}
        submitLabel={tc('create')}
        busy={busy}
        error={error}
        onClose={() => {
          setCreating(false);
          setError(null);
        }}
        onSubmit={(name) => void create(name)}
      />
    </div>
  );
}
