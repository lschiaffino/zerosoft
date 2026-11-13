import { cookies } from 'next/headers';
import { ANALYTICS_TZ_COOKIE, validTz } from './period';

/**
 * Analítica, el kit (servidor): la zona horaria de quien mira, que el
 * navegador guarda en una cookie al abrir un tablero (TimeZoneSync). UTC si
 * todavía no la mandó o no es válida.
 */
export async function viewerTz(): Promise<string> {
  const raw = (await cookies()).get(ANALYTICS_TZ_COOKIE)?.value;
  if (!raw) return 'UTC';
  try {
    return validTz(decodeURIComponent(raw));
  } catch {
    return 'UTC';
  }
}
