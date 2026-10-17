import { cookies, headers } from 'next/headers';
import { BRAND_COOKIE, BRAND_HEADER, parseBrand, type BrandTheme } from './brand-theme';

/**
 * Tema de marca de este request (solo servidor): el que fuerza la ruta
 * (header del middleware) o el de la cookie zs_brand. Default si no hay.
 */
export async function getBrandTheme(): Promise<BrandTheme> {
  const forced = (await headers()).get(BRAND_HEADER);
  if (forced) return parseBrand(forced);
  return parseBrand((await cookies()).get(BRAND_COOKIE)?.value);
}
