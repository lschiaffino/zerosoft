'use client';

import { useTranslations } from 'next-intl';

/** "Nuevo plan" de la cabecera: abre el modal de la lista (evento de ventana). */
export default function NewPlanButton() {
  const t = useTranslations('trackPlanning');
  return (
    <button type="button" className="btn btn-primary" onClick={() => window.dispatchEvent(new Event('zs:track-new-plan'))} data-testid="tp-new-plan">
      {t('plans.new')}
    </button>
  );
}
