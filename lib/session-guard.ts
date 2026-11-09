/**
 * Revisión de sesión al abrir una página de la app (script en línea, antes de
 * pintar nada). Una página de /app puede venir de la copia que guardó el
 * service worker (public/sw.js) para usarla sin conexión: si la sesión del
 * navegador ya no es la de quien la guardó, no se muestra.
 *
 * - `expected`: la cookie zs_who con la que el servidor armó la página (vacía
 *   si no venía en el pedido).
 * - Sin la cookie zs_who (sesión cerrada o vencida): se oculta la página y se
 *   va al login.
 * - Con otra cookie: con red se recarga una vez (el servidor la arma de nuevo
 *   con la sesión actual); sin red, se oculta y se va al login.
 *
 * Una página recién servida siempre tiene la cookie: el middleware la pone en
 * la misma respuesta (middleware.ts withWhoCookie).
 */
export const WHO_COOKIE_NAME = 'zs_who';

export function sessionGuardScript(expected: string, signinPath: string): string {
  const exp = JSON.stringify(expected.replace(/[^a-f0-9]/gi, '').slice(0, 64));
  const signin = JSON.stringify(signinPath);
  return (
    'try{' +
    `var m=/(?:^|;\\s*)${WHO_COOKIE_NAME}=([^;]+)/.exec(document.cookie),w=m?decodeURIComponent(m[1]):'',e=${exp},k='zs-guard-reload';` +
    "if(!w||(e&&w!==e)){document.documentElement.style.visibility='hidden';" +
    "if(w&&navigator.onLine&&!sessionStorage.getItem(k)){sessionStorage.setItem(k,'1');location.reload();}" +
    'else{' +
    `location.replace(${signin}+'?callbackUrl='+encodeURIComponent(location.pathname+location.search));}` +
    "}else{sessionStorage.removeItem(k);}" +
    '}catch(_){}'
  );
}
