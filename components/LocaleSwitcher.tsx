'use client';

import { Link, usePathname } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';

export default function LocaleSwitcher({ locale }: { locale: string }) {
  const pathname = usePathname();

  return (
    <div className="locale-switcher" aria-label="Idioma / Language / Idioma">
      {routing.locales.map((l) => (
        <Link
          key={l}
          href={pathname}
          locale={l}
          className={l === locale ? 'active' : ''}
        >
          {l.toUpperCase()}
        </Link>
      ))}
    </div>
  );
}
