import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

type AdminSection = 'feedback' | 'roadmap' | 'changelog';

const SECTIONS: Array<{ key: AdminSection; href: string }> = [
  { key: 'feedback', href: '/app/settings/feedback' },
  { key: 'roadmap', href: '/app/settings/roadmap' },
  { key: 'changelog', href: '/app/settings/changelog' },
];

/** Grupo de links pegados (segmented) con el activo en tinta. Para vistas y filtros por URL. */
export function LinkGroup({ label, items }: { label: string; items: Array<{ key: string; href: string; label: string; active: boolean }> }) {
  return (
    <nav className="btn-group st-link-group" aria-label={label}>
      {items.map((i) => (
        <Link key={i.key} href={i.href} className="btn btn-sm" aria-current={i.active ? 'page' : undefined}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Cabecera de las pantallas de Admin (dentro de la pestaña Admin de Ajustes):
 * Feedback / Roadmap / Changelog, una línea de ayuda, y a la derecha los
 * filtros o el link público de cada pantalla.
 */
export default async function AdminNav({
  locale,
  current,
  description,
  aside,
}: {
  locale: string;
  current: AdminSection;
  description: string;
  aside?: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'settings.admin' });
  return (
    <div className="st-admin-head">
      <div className="st-admin-bar">
        <LinkGroup
          label={t('nav')}
          items={SECTIONS.map((s) => ({ key: s.key, href: s.href, label: t(s.key), active: s.key === current }))}
        />
        {aside && <div className="st-admin-aside">{aside}</div>}
      </div>
      <p className="ui-help st-prose">{description}</p>
    </div>
  );
}
