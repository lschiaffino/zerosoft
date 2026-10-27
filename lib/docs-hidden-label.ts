import { cookies, headers } from 'next/headers';
import { hiddenPageLabel } from './docs-page-links';
import { requestLocale } from './request-locale';

/**
 * "Página privada" en el idioma de quien pide (el de la ruta si lo puso
 * next-intl, si no su cookie o su navegador). Fuera de un request (tests,
 * cron): inglés.
 */
export async function requestHiddenLabel(): Promise<string> {
  try {
    const h = await headers();
    const c = await cookies();
    const locale = h.get('x-next-intl-locale') ?? requestLocale(c.get('NEXT_LOCALE')?.value, h.get('accept-language'));
    return hiddenPageLabel(locale);
  } catch {
    return hiddenPageLabel('en');
  }
}
