'use client';

import { usePathname } from '@/i18n/navigation';
import { PRODUCT_CONFIG } from '@/lib/products';
import { appButtonColors, type ButtonTone } from '@/lib/app-accent';
import { appProductFromPath, productKeyOf } from './sidebar-nav';

/**
 * Dentro de una app, los botones primarios (.btn-primary) toman el color de
 * esa app (styles/ui.css lee --app-btn, --app-btn-on, --app-btn-hover y
 * --app-btn-active). El tono cambia con el tema: el bloque oscuro sigue el mismo
 * patrón que styles/themes/dark.css (preferencia del sistema y data-theme). En
 * Inicio, Ajustes y el asistente no hay app: quedan en tinta. Va como <style>
 * para que salga en el HTML del servidor y no haya un salto de color al hidratar.
 */
const vars = (t: ButtonTone) => `--app-btn:${t.bg};--app-btn-on:${t.on};--app-btn-hover:${t.hover};--app-btn-active:${t.active}`;

export default function AppAccent() {
  const key = productKeyOf(appProductFromPath(usePathname()));
  const colors = key ? appButtonColors(PRODUCT_CONFIG[key]?.color) : null;
  if (!colors) return null;
  const dark = vars(colors.dark);
  const css =
    `.app-frame{${vars(colors.light)}}` +
    `@media (prefers-color-scheme: dark){:root:not([data-theme='light']) .app-frame{${dark}}}` +
    `:root[data-theme='dark'] .app-frame{${dark}}`;
  return <style>{css}</style>;
}
