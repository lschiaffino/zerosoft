'use client';

import { usePathname } from '@/i18n/navigation';
import { PRODUCT_CONFIG } from '@/lib/products';
import { appButtonColors } from '@/lib/app-accent';
import { appProductFromPath, productKeyOf } from './sidebar-nav';

/**
 * Dentro de una app, los botones primarios (.btn-primary) toman el color de
 * esa app (styles/ui.css lee --app-btn, --app-btn-on y --app-btn-hover). En
 * Inicio, Ajustes y el asistente no hay app: quedan en tinta. Va como <style>
 * para que salga en el HTML del servidor y no haya un salto de color al hidratar.
 */
export default function AppAccent() {
  const key = productKeyOf(appProductFromPath(usePathname()));
  const colors = key ? appButtonColors(PRODUCT_CONFIG[key]?.color) : null;
  if (!colors) return null;
  return <style>{`.app-frame{--app-btn:${colors.bg};--app-btn-on:${colors.on};--app-btn-hover:${colors.hover}}`}</style>;
}
