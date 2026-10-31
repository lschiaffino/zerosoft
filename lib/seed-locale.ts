export type SeedLocale = 'en' | 'es' | 'pt';

/**
 * Idioma de la request que dispara el seed (header de next-intl, cookie o
 * Accept-Language). Fuera de una request (scripts) queda en inglés.
 */
export async function seedLocale(): Promise<SeedLocale> {
  const pick = (v: string | null | undefined): SeedLocale | null => {
    const l = (v ?? '').slice(0, 2).toLowerCase();
    return l === 'es' || l === 'pt' || l === 'en' ? l : null;
  };
  try {
    const { cookies, headers } = await import('next/headers');
    const h = await headers();
    return (
      pick(h.get('x-next-intl-locale')) ??
      pick((await cookies()).get('NEXT_LOCALE')?.value) ??
      pick(h.get('accept-language')) ??
      'en'
    );
  } catch {
    return 'en';
  }
}
