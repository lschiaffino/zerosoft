import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import FormSection from '@/components/ui/FormSection';

/**
 * Sección de Ajustes que todavía no tiene contenido propio: dice qué va a
 * vivir acá y, si lo equivalente ya existe en otra pantalla, lleva ahí.
 */
export default function SettingsSoon({
  title,
  description,
  empty,
  whereLabel,
  links = [],
  children,
}: {
  title: string;
  description: string;
  /** Una línea: qué pasa hoy con esta sección. */
  empty: string;
  /** Rótulo de la lista de links ("Hoy está en"). */
  whereLabel?: string;
  links?: Array<{ href: string; label: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="st-stack">
      {/* Lo que ya existe va primero; después, lo que falta y dónde está hoy. */}
      {children}
      <FormSection title={title} description={description}>
        <div className="st-soon" data-testid="settings-soon">
          <p className="st-empty-line">{empty}</p>
          {links.length > 0 && (
            <div className="st-block">
              {whereLabel && <h3 className="st-subtitle">{whereLabel}</h3>}
              <ul className="st-links">
                {links.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className="st-link" prefetch={false}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </FormSection>
    </div>
  );
}
