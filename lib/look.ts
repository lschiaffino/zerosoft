/**
 * Aspecto de la interfaz (look): cómo se dibujan los controles y las
 * superficies de toda la app. Independiente del modo de color
 * (lib/color-theme.ts) y del tema de marca (lib/brand-theme.ts).
 *
 * - `lines` (default): líneas finas, plano, esquinas chicas; el color de la
 *   app en los bordes y botones fuertes.
 * - `classic`: el aspecto de las apps de siempre (Linear, WhatsApp): menús y
 *   popovers con sombra suave, esquinas redondeadas, rellenos al pasar.
 * - `liquid`: superficies translúcidas con desenfoque, radios grandes y
 *   barras y menús que flotan (Liquid Glass de Apple).
 *
 * <html data-look="…"> lo pone LOOK_INIT_SCRIPT antes del primer paint desde
 * la cookie zs_look; la preferencia de verdad vive en users.look (la app la
 * escribe en la cookie si este navegador no la tenía). Los tokens de cada
 * aspecto están en styles/looks.css.
 * Sin imports de Node ni de React: lo usan el layout y el cliente.
 */

export const LOOKS = ['lines', 'classic', 'liquid'] as const;
export type Look = (typeof LOOKS)[number];

export const DEFAULT_LOOK: Look = 'lines';

/** Cookie que guarda el aspecto en este navegador (copia de users.look). */
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

/** Las páginas de la app (/en/app, /es/app/…): el aspecto se aplica solo ahí; el sitio y las páginas públicas quedan en lines. */
export const APP_PATH_RE = /^\/(?:en|es|pt)\/app(?:\/|$)/;

/**
 * Script en línea al principio del <body>: en una página de la app lee
 * zs_look y pone <html data-look> antes del primer paint (sin cookie, lines).
 * Va junto a THEME_INIT_SCRIPT.
 */
export const LOOK_INIT_SCRIPT =
  "try{var l=document.cookie.match(/(?:^|;\\s*)zs_look=([^;]*)/),w=l?decodeURIComponent(l[1]).trim().toLowerCase():'';" +
  "if(!/^\\/(?:en|es|pt)\\/app(?:\\/|$)/.test(location.pathname))w='';" +
  "document.documentElement.setAttribute('data-look',w==='classic'||w==='liquid'?w:'lines')}catch(e){}";

/**
 * Script de la app (que sí conoce users.look): si la cookie de este navegador
 * no coincide (primera vez en otro equipo), pone el atributo y la cookie antes
 * de que se pinte la app.
 */
export function lookSyncScript(look: Look): string {
  return (
    `try{var r=document.documentElement;if(r.getAttribute('data-look')!==${JSON.stringify(look)}){` +
    `r.setAttribute('data-look',${JSON.stringify(look)});document.cookie=${JSON.stringify(lookCookieString(look))}}}catch(e){}`
  );
}

/** El aspecto que se ve en este navegador (solo cliente; en el servidor, el default). */
export function lookFromDocument(): Look {
  if (typeof document === 'undefined') return DEFAULT_LOOK;
  const attr = document.documentElement.getAttribute('data-look');
  return isLook(attr) ? attr : lookFromCookieHeader(document.cookie);
}
