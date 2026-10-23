import { TZ_DEPENDENT_ATTR } from '@/lib/tz-client';

/**
 * Marca invisible: esta página muestra fechas que dependen de "hoy" en la
 * zona de quien mira. Si el servidor la armó sin la cookie tz, TimezoneCookie
 * la refresca una vez; el resto de las páginas no lo necesita.
 */
export default function TzDependent() {
  return <span hidden {...{ [TZ_DEPENDENT_ATTR]: '' }} />;
}
