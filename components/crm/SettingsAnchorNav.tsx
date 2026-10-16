'use client';

import { useEffect, useState } from 'react';

interface SettingsAnchorNavProps {
  sections: Array<{ id: string; label: string }>;
  ariaLabel: string;
  className?: string;
}

/**
 * Índice de anclas de una página de ajustes con scroll-spy: marca como activa
 * la sección más arriba que está a la vista (IntersectionObserver).
 */
export default function SettingsAnchorNav({ sections, ariaLabel, className = 'crm-settings-nav' }: SettingsAnchorNavProps) {
  const [active, setActive] = useState<string>(sections[0]?.id ?? '');

  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (fromHash && sections.some((s) => s.id === fromHash)) setActive(fromHash);
    if (typeof IntersectionObserver === 'undefined') return;

    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => el !== null);
    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // La primera sección (en orden de página) que está en la franja superior.
        const first = sections.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      // Franja: desde arriba hasta el 40% del viewport.
      { rootMargin: '0px 0px -60% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  return (
    <nav className={className} aria-label={ariaLabel}>
      {sections.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className={s.id === active ? 'active' : undefined}
          aria-current={s.id === active ? 'location' : undefined}
          onClick={() => setActive(s.id)}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}
