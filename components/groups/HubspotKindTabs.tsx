'use client';

import { useRef, type KeyboardEvent } from 'react';
import { useTranslations } from 'next-intl';
import { HUBSPOT_OBJECT_KINDS, type HubspotObjectKind } from '@/lib/groups-hubspot-shared';

/**
 * Empresa, contacto o negocio: de qué objeto de HubSpot son las propiedades
 * que se eligen o se muestran (el selector "Elegir propiedades", los ajustes
 * y el panel). Pestañas con flechas, Inicio y Fin, como cualquier tablist.
 */
export default function HubspotKindTabs({
  value,
  onChange,
  kinds = HUBSPOT_OBJECT_KINDS,
  label,
  controls,
  className = '',
}: {
  value: HubspotObjectKind;
  onChange: (kind: HubspotObjectKind) => void;
  kinds?: readonly HubspotObjectKind[];
  label: string;
  /** id del panel que muestran las pestañas. */
  controls?: string;
  className?: string;
}) {
  const t = useTranslations('groups.hubspot');
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = kinds.indexOf(value);
    const next =
      e.key === 'ArrowRight' ? kinds[(i + 1) % kinds.length] : e.key === 'ArrowLeft' ? kinds[(i - 1 + kinds.length) % kinds.length] : e.key === 'Home' ? kinds[0] : e.key === 'End' ? kinds[kinds.length - 1] : null;
    if (!next) return;
    e.preventDefault();
    onChange(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-kind="${next}"]`)?.focus());
  };
  return (
    <div ref={ref} className={`ui-tabs gr-hs-kinds ${className}`.trim()} role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {kinds.map((k) => (
        <button
          key={k}
          type="button"
          role="tab"
          className="ui-tab"
          data-kind={k}
          data-testid={`hubspot-kind-${k}`}
          aria-selected={value === k}
          aria-controls={controls}
          tabIndex={value === k ? 0 : -1}
          onClick={() => onChange(k)}
        >
          {t(`types.${k}`)}
        </button>
      ))}
    </div>
  );
}
