/**
 * ¿Terminó de llegar y mostrarse el HTML en streaming de la página?
 *
 * Con un loading.tsx, Next manda primero el esqueleto y después cada boundary
 * de Suspense como un `<div hidden id="S:n">` que el script inline de React
 * ($RC/$RV) mete en su lugar. React 19 junta esas revelaciones y las demora
 * (requestAnimationFrame o hasta ~300 ms), así que la app puede hidratar con
 * un boundary todavía pendiente. Si en ese momento llega un update de arriba
 * (router.refresh()), React deja de hidratar ese boundary y lo renderiza de
 * cero en el cliente: durante un rato conviven esa copia viva y la copia
 * oculta del servidor (dos formularios, dos inputs con el mismo placeholder),
 * y se tira el trabajo de hidratación.
 *
 * Está listo cuando el documento cargó entero y no queda ningún segmento
 * oculto esperando su lugar. Puro: lo usan TimezoneCookie y los tests.
 */
export interface StreamDoc {
  readyState: DocumentReadyState;
  querySelector(selectors: string): unknown;
}

export const PENDING_SEGMENT = 'div[hidden][id^="S:"]';

export function isStreamSettled(doc: StreamDoc): boolean {
  return doc.readyState === 'complete' && !doc.querySelector(PENDING_SEGMENT);
}

/**
 * Llama a `cb` una sola vez cuando el streaming terminó (ver isStreamSettled).
 * Devuelve una función que cancela la espera.
 */
export function whenStreamSettled(cb: () => void): () => void {
  if (isStreamSettled(document)) {
    cb();
    return () => {};
  }
  let done = false;
  const check = () => {
    if (done || !isStreamSettled(document)) return;
    stop();
    cb();
  };
  const observer = new MutationObserver(check);
  observer.observe(document.body, { childList: true });
  window.addEventListener('load', check);
  function stop() {
    done = true;
    observer.disconnect();
    window.removeEventListener('load', check);
  }
  return stop;
}
