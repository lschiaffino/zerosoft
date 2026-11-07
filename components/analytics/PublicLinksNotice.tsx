'use client';

import { useTranslations } from 'next-intl';

/** Al editar una cohorte o una acción que usa un link público: no se bloquea, pero se avisa. */
export default function PublicLinksNotice({ links }: { links: Array<{ shareId: string; name: string }> }) {
  const t = useTranslations('analytics.share');
  if (!links.length) return null;
  const names = [...new Set(links.map((l) => l.name))];
  return (
    <p className="an-note an-public-notice" role="status" data-testid="an-public-notice">
      {t('changesPublic', { count: names.length, list: names.join(', ') })}
    </p>
  );
}
