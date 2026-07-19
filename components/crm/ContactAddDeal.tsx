'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import DealForm from './DealForm';

interface ContactAddDealProps {
  pipelineId: string;
  stageId: string;
  contactId: string;
  priorities: Array<{ value: string; label: string }>;
  sources: Array<{ value: string; label: string }>;
}

/** Botón "+ Add deal" en el detalle de contacto: abre DealForm con el contacto pre-vinculado. */
export default function ContactAddDeal({
  pipelineId,
  stageId,
  contactId,
  priorities,
  sources,
}: ContactAddDealProps) {
  const t = useTranslations('crm');
  const router = useRouter();
  const [open, setOpen] = useState(false);

  if (open) {
    return (
      <div className="add-deal-panel">
        <DealForm
          pipelineId={pipelineId}
          stageId={stageId}
          priorities={priorities}
          sources={sources}
          fixedContactId={contactId}
          onDone={() => {
            setOpen(false);
            router.refresh();
          }}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }

  return (
    <button type="button" className="kb-add" onClick={() => setOpen(true)}>
      {t('deals.addDeal')}
    </button>
  );
}
