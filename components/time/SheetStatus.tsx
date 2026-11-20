'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import type { SheetInfo } from '@/lib/time/approvals';
import type { SheetAction } from '@/lib/time/types';
import { api, useDayFormat, useErrorText } from './ui';

export const SHEET_BADGE: Record<SheetInfo['status'], string> = { open: '', submitted: 'badge-warn', approved: 'badge-ok', returned: 'badge-bad' };

/**
 * La barra de aprobación de la semana en la hoja (como "Submit week for
 * approval" de Harvest): enviar, retirar mientras está pendiente, ver quién la
 * aprobó o por qué la devolvió, y volver a enviarla.
 */
export default function SheetStatus({
  sheet,
  hasEntries,
  onChanged,
  push,
}: {
  sheet: SheetInfo;
  hasEntries: boolean;
  onChanged: (sheet: SheetInfo) => void;
  push: (msg: string, tone?: 'ok' | 'bad') => void;
}) {
  const t = useTranslations('time.approval');
  const tc = useTranslations('time.common');
  const errorText = useErrorText();
  const fmtDay = useDayFormat();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const act = async (action: SheetAction) => {
    setBusy(true);
    const r = await api<{ sheet: SheetInfo }>('/api/time/approvals', { method: 'POST', json: { action, week: sheet.week } });
    setBusy(false);
    setConfirm(false);
    if (!r.ok) return push(errorText(r.data.error), 'bad');
    push(action === 'submit' ? t('submittedToast') : t('withdrawnToast'));
    onChanged(r.data.sheet);
  };

  const decided = sheet.decidedAt ? fmtDay(sheet.decidedAt.slice(0, 10), { day: 'numeric', month: 'short' }) : '';
  const by = sheet.decidedByName ?? '';

  return (
    <div className={`tm-sheetbar is-${sheet.status}`} data-testid="time-sheet-status" data-status={sheet.status}>
      <div className="tm-sheetbar-text">
        {sheet.status !== 'open' && <span className={`badge ${SHEET_BADGE[sheet.status]}`}>{t(`status.${sheet.status}`)}</span>}
        <span className="tm-sheetbar-msg">
          {sheet.status === 'open'
            ? t('openHint')
            : sheet.status === 'submitted'
              ? t('submittedHint')
              : sheet.status === 'approved'
                ? t('approvedHint', { who: by, date: decided })
                : t('returnedHint', { who: by, date: decided })}
        </span>
        {sheet.status === 'returned' && sheet.note && (
          <q className="tm-sheetbar-note" data-testid="time-sheet-note">
            {sheet.note}
          </q>
        )}
      </div>
      {(sheet.status === 'open' || sheet.status === 'returned') && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirm(true)} disabled={!hasEntries || busy} data-testid="time-sheet-submit">
          {sheet.status === 'returned' ? t('submitAgain') : t('submit')}
        </button>
      )}
      {sheet.status === 'submitted' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act('withdraw')} disabled={busy} data-testid="time-sheet-withdraw">
          {t('withdraw')}
        </button>
      )}
      <ConfirmDialog
        open={confirm}
        title={t('submitTitle')}
        body={t('submitBody')}
        confirmLabel={t('submit')}
        cancelLabel={tc('cancel')}
        busy={busy}
        onConfirm={() => void act('submit')}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
