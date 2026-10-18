import { cookies } from 'next/headers';
import { THEME_COOKIE, parseThemePref, type ThemePref } from './color-theme';

/** Preferencia de modo de color de este request (cookie zs_theme). */
export async function getThemePref(): Promise<ThemePref> {
  return parseThemePref((await cookies()).get(THEME_COOKIE)?.value);
}
