import { getTranslations } from 'next-intl/server';
import type { WaitlistLabels } from './WaitlistForm';

/** Textos del formulario de lista de espera (common.comingSoon), armados en el servidor. */
export async function waitlistLabels(locale: string, name: string, email?: string | null): Promise<WaitlistLabels> {
  const t = await getTranslations({ locale, namespace: 'common.comingSoon' });
  return {
    join: t('join'),
    joining: t('joining'),
    joined: email ? t('joined', { name, email }) : t('joinedSite', { name }),
    already: t('already', { name }),
    useCase: t('useCase'),
    useCasePlaceholder: t('useCasePlaceholder'),
    email: t('email'),
    emailPlaceholder: t('emailPlaceholder'),
    invalidEmail: t('invalidEmail'),
    error: t('error'),
    limited: t('limited'),
    privacy: t('privacy'),
  };
}
