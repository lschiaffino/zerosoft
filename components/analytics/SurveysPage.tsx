'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useRouter } from '@/i18n/navigation';
import EmptyState from '@/components/ui/EmptyState';
import PageHeader from '@/components/ui/PageHeader';
import type { SurveyDisplayStatus } from '@/lib/analytics/surveys-core';
import NameDialog from './NameDialog';
import RecordList from './RecordList';
import { SurveyStatusBadge } from './SurveyStatusBadge';
import { api, apiErrorText, fmtNumber, notifyChanged } from './client';

export interface SurveyListEntry {
  id: string;
  name: string;
  status: SurveyDisplayStatus;
  responses: number;
  questions: number;
}

/** Lista de encuestas del proyecto: estado, respuestas, crear, renombrar y borrar. */
export default function SurveysPage({ projectId, items }: { projectId: string; items: SurveyListEntry[] }) {
  const t = useTranslations('analyticsMore.surveys');
  const tc = useTranslations('analytics.common');
  const locale = useLocale();
  const router = useRouter();
  const search = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (search.get('new') === '1') setCreating(true);
  }, [search]);

  const create = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const { survey } = await api<{ survey: { id: string } }>('/api/analytics/surveys', {
        body: { projectId, name, question: t('starterQuestion'), lowLabel: t('starterLow'), highLabel: t('starterHigh') },
      });
      notifyChanged();
      setCreating(false);
      router.push(`/app/pulse/surveys/${survey.id}`);
    } catch (err) {
      setError(apiErrorText(err, tc));
    } finally {
      setBusy(false);
    }
  };

  const newButton = (
    <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
      {t('new')}
    </button>
  );

  return (
    <div className="app-page ui-page an-page">
      <PageHeader title={t('title')} description={t('description')} actions={newButton} />
      {items.length === 0 ? (
        <EmptyState product="pulse" title={t('emptyTitle')} body={t('emptyBody')} action={newButton} />
      ) : (
        <RecordList
          testId="an-list-surveys"
          items={items.map((s) => ({
            id: s.id,
            name: s.name,
            href: `/app/pulse/surveys/${s.id}`,
            meta: (
              <span className="an-sv-meta">
                <SurveyStatusBadge status={s.status} />
                <span>{t('responsesCount', { count: s.responses, formatted: fmtNumber(s.responses, locale) })}</span>
              </span>
            ),
          }))}
          labels={{
            name: t('name'),
            meta: t('meta'),
            rename: tc('rename'),
            delete: tc('delete'),
            deleteTitle: (name) => t('deleteTitle', { name }),
            deleteBody: t('deleteBody'),
          }}
          onRename={async (id, name) => {
            await api(`/api/analytics/surveys/${id}`, { method: 'PATCH', body: { name } });
          }}
          onDelete={async (id) => {
            await api(`/api/analytics/surveys/${id}`, { method: 'DELETE' });
          }}
        />
      )}
      <NameDialog
        open={creating}
        title={t('new')}
        label={t('name')}
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
