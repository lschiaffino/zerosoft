/**
 * Aspecto de la interfaz (look): cómo se dibujan los controles y las
 * superficies de toda la app. Independiente del modo de color
 * (lib/color-theme.ts) y del tema de marca (lib/brand-theme.ts).
 *
 * - `current` (default): la app tal como se ve hoy, una mezcla de WhatsApp y
 *   líneas. No tiene CSS propio: nada cambia para quien no elige otro.
 * - `lines`: el estilo de líneas de zerosoft entero y más plano: bordes de 1px,
 *   esquinas rectas, sin sombras; el color de la app en bordes activos,
 *   botones principales y filetes.
 * - `classic`: WhatsApp + Linear: superficies blancas redondeadas con sombra
 *   suave, menús con íconos y rellenos al pasar, botones de ícono redondos.
 * - `liquid`: superficies translúcidas con desenfoque, radios grandes
 *   (Liquid Glass de Apple).
 * - `retro`: un escritorio de los noventa (Windows 98): botones y ventanas en
 *   relieve, campos hundidos, barras de título con degradé.
 *
 * <html data-look="…"> lo pone LOOK_INIT_SCRIPT antes del primer paint desde
 * la cookie zs_look; la preferencia de verdad vive en users.ui_look (la app la
 * escribe en la cookie si este navegador no la tenía). El CSS de cada aspecto
 * está en styles/looks.css y styles/looks-retro.css.
 * Sin imports de Node ni de React: lo usan el layout y el cliente.
 */

export const LOOKS = ['current', 'lines', 'classic', 'liquid', 'retro'] as const;
export type Look = (typeof LOOKS)[number];

export const DEFAULT_LOOK: Look = 'current';

/** El sitio y las páginas públicas (fuera de la app) siempre se dibujan así. */
export const SITE_LOOK: Look = 'current';

/** Cookie que guarda el aspecto en este navegador (copia de users.ui_look). */
export const LOOK_COOKIE = 'zs_look';

/** Un año, en segundos. */
export const LOOK_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLook(v: unknown): v is Look {
  return typeof v === 'string' && (LOOKS as readonly string[]).includes(v);
}

export function parseLook(value: string | null | undefined): Look {
  const v = (value ?? '').trim().toLowerCase();
  return isLook(v) ? v : DEFAULT_LOOK;
}

/** Lee el aspecto de un header Cookie entero (`a=1; zs_look=classic`). */
export function lookFromCookieHeader(header: string | null | undefined): Look {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() !== LOOK_COOKIE) continue;
    let raw = part.slice(i + 1).trim();
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Valor mal codificado: se toma tal cual.
    }
    return parseLook(raw);
  }
  return DEFAULT_LOOK;
}

/** La cookie a escribir desde el cliente. */
export function lookCookieString(look: Look): string {
  return `${LOOK_COOKIE}=${look}; Path=/; Max-Age=${LOOK_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Script en línea al principio del <body> (layout raíz, estático: su hash va
 * en la CSP, lib/csp.ts). En una página de la app (/en/app, /es/app/…) lee
 * zs_look y pone <html data-look> antes del primer paint (sin cookie o con un
 * valor desconocido, DEFAULT_LOOK); fuera de la app, SITE_LOOK.
 */
export const LOOK_INIT_SCRIPT =
  "try{var l=document.cookie.match(/(?:^|;\\s*)zs_look=([^;]*)/),w=l?decodeURIComponent(l[1]).trim().toLowerCase():'';" +
  `var a=/^\\/(?:en|es|pt)\\/app(?:\\/|$)/.test(location.pathname),k=${JSON.stringify(LOOKS)};` +
  `document.documentElement.setAttribute('data-look',a?(k.indexOf(w)>=0?w:'${DEFAULT_LOOK}'):'${SITE_LOOK}')}catch(e){}`;

/**
 * Script de la app (que sí conoce users.ui_look; va con el nonce de la CSP):
 * pone el atributo antes de que se pinte la app y, si la cookie de este
 * navegador no coincide (primera vez en otro equipo, cookie borrada), la
 * reescribe.
 */
export function lookSyncScript(look: Look): string {
  const v = JSON.stringify(look);
  return (
    `try{var r=document.documentElement;if(r.getAttribute('data-look')!==${v})r.setAttribute('data-look',${v});` +
    `if(!new RegExp('(?:^|;\\\\s*)${LOOK_COOKIE}=${look}(?:;|$)').test(document.cookie))document.cookie=${JSON.stringify(lookCookieString(look))}}catch(e){}`
  );
}

/** El aspecto que se ve en este navegador (solo cliente; en el servidor, el default). */
export function lookFromDocument(): Look {
  if (typeof document === 'undefined') return DEFAULT_LOOK;
  const attr = document.documentElement.getAttribute('data-look');
  return isLook(attr) ? attr : lookFromCookieHeader(document.cookie);
}
