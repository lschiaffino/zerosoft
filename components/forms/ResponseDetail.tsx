'use client';

import { useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import PageHeader from '@/components/ui/PageHeader';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { FormDto } from '@/lib/forms/core';
import type { ResponseDto } from '@/lib/forms/responses';
import { answerDisplay, isEmptyAnswer } from '@/lib/forms/engine';
import type { FileAnswer } from '@/lib/forms/types';
import { FormTabs } from './ui';

/** Una respuesta: cada pregunta con lo que se contestó, ocultos, variables, final, archivos y borrar. */
export default function ResponseDetail({ form, response, timeZone }: { form: FormDto; response: ResponseDto; timeZone?: string }) {
  const t = useTranslations('forms.responses');
  const tp = useTranslations('forms.public');
  const format = useFormatter();
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const labels = { yes: tp('yes'), no: tp('no'), file: tp('file'), signed: tp('signed') };
  const def = form.definition;
  const ending = def.endings.find((e) => e.id === response.endingId);
  const when = format.dateTime(new Date(response.submittedAt ?? response.createdAt), { dateStyle: 'long', timeStyle: 'short', timeZone });

  async function remove() {
    setBusy(true);
    const res = await fetch(`/api/forms/${form.id}/responses/${response.id}`, { method: 'DELETE' }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t('deleteError'));
      setConfirm(false);
      return;
    }
    router.push(`/app/forms/${form.id}/responses`);
    router.refresh();
  }

  return (
    <div className="app-page ui-page fm-page">
      <PageHeader
        title={form.name}
        description={`${response.status === 'partial' ? t('status.partial') : t('status.completed')} · ${when}`}
        back={{ href: `/app/forms/${form.id}/responses`, label: t('backToResponses') }}
        actions={
          <button type="button" className="btn btn-danger" onClick={() => setConfirm(true)}>
            {t('deleteOne')}
          </button>
        }
      />
      <FormTabs id={form.id} active="responses" />
      {error && (
        <p className="fm-error" role="alert">
          {error}
        </p>
      )}
      <dl className="fm-answers">
        {def.questions
          .filter((q) => q.type !== 'statement')
          .map((q) => {
            const v = response.answers[q.id];
            const file = (q.type === 'file_upload' || q.type === 'signature') && v && typeof v === 'object' && 'fileId' in v ? (v as FileAnswer) : null;
            return (
              <div key={q.id} className="fm-answer">
                <dt>{q.title || q.ref}</dt>
                <dd>
                  {isEmptyAnswer(v) ? (
                    <span className="fm-dim">{t('noAnswer')}</span>
                  ) : file ? (
                    q.type === 'signature' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="fm-signature" src={`/api/forms/files/${file.fileId}`} alt={t('signatureAlt')} />
                    ) : (
                      <a href={`/api/forms/files/${file.fileId}`} target="_blank" rel="noopener noreferrer">
                        {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
                      </a>
                    )
                  ) : (
                    <span className="fm-answer-text">{answerDisplay(q, v, labels)}</span>
                  )}
                </dd>
              </div>
            );
          })}
      </dl>
      <dl className="fm-meta">
        {Object.entries(response.hidden).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {Object.entries(response.vars).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        {ending && (
          <div>
            <dt>{t('ending')}</dt>
            <dd>{ending.title}</dd>
          </div>
        )}
        <div>
          <dt>{t('language')}</dt>
          <dd>{response.lang}</dd>
        </div>
        {response.contactId && (
          <div>
            <dt>{t('crmContact')}</dt>
            <dd>
              <Link href={`/app/crm/contacts/${response.contactId}`}>{t('openContact')}</Link>
            </dd>
          </div>
        )}
      </dl>
      <ConfirmDialog open={confirm} title={t('deleteTitle', { n: 1 })} body={t('deleteBody')} confirmLabel={t('delete')} cancelLabel={t('cancel')} danger busy={busy} onConfirm={() => void remove()} onCancel={() => setConfirm(false)} />
    </div>
  );
}
