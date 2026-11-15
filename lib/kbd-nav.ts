/**
 * Modalidad de teclado: quién maneja la pantalla, el mouse o el teclado.
 *
 * El navegador prende `:focus-visible` en lo último que se tocó con el mouse apenas se aprieta
 * cualquier tecla. En una app con atajos de una letra (j/k, e, h, flechas) eso dibuja un recuadro
 * alrededor de una carpeta o de un chat mientras el teclado en realidad mueve la lista.
 *
 * Acá el anillo de foco sigue la intención:
 *  - `pointer`: se tocó con el mouse o el dedo. Sin anillos (los campos de texto conservan su borde).
 *  - `tab`: se apretó Tab o Shift+Tab. Anillos visibles hasta el próximo toque.
 *  - `overlay`: un atajo abrió un diálogo o un menú y el foco entró ahí. Anillos visibles adentro;
 *    al volver el foco a la página se apagan.
 *
 * El estado queda en `data-kbd-nav` de la raíz ("0" sin anillos, "1" con anillos) y
 * styles/calm-focus.css lo lee. `data-kbd-last` dice qué manejó la pantalla por última vez ("key" o
 * "pointer"): con el teclado, el cursor de la lista lleva una marca al costado. Sin JavaScript el atributo no existe y el foco se ve como siempre.
 *
 * Además, un clic de mouse sobre un link de navegación o una fila (RELEASE) suelta el foco: el
 * teclado maneja la lista, y Enter o la vuelta de un diálogo no reactivan lo último que se tocó.
 * Tab sigue desde ahí (el navegador recuerda el punto de partida).
 */

export type KbdMode = 'pointer' | 'tab' | 'overlay';

/** Capas que atrapan el foco: adentro, un foco que llegó por teclado siempre se ve. */
export const OVERLAY = 'dialog, [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** Lo que suelta el foco después de un clic de mouse: navegación del sidebar, filas de chat, pestañas y chips. */
export const RELEASE = [
  '[data-focus-release]',
  'a.side-link',
  '.docs-tree-link',
  '.ib-row-btn',
  '.gr-row',
  'a.ui-tab',
  '.gr-filter',
  '.gr-view',
  '.wa-archived-row',
  '.ib-archived-entry',
].join(', ');

export const KBD_ATTR = 'data-kbd-nav';
/** Lo último que manejó la pantalla ("key" o "pointer"): con "key" se marca el cursor de la lista. */
export const KBD_LAST_ATTR = 'data-kbd-last';

/** Campos donde las teclas son texto. */
export const TEXT_ENTRY = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable]:not([contenteditable="false"])';

/** Qué estado sigue a un foco que llegó después de una tecla que no es Tab. */
export function modeAfterFocus(mode: KbdMode, inOverlay: boolean): KbdMode {
  if (mode === 'pointer' && inOverlay) return 'overlay';
  if (mode === 'overlay' && !inOverlay) return 'pointer';
  return mode;
}

/** Qué estado sigue a una tecla. Las teclas modificadoras solas no cuentan. */
export function modeAfterKey(mode: KbdMode, e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): KbdMode {
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) return 'tab';
  return mode;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

let installs = 0;
let uninstall: (() => void) | null = null;

/** Instala la modalidad en el documento. Devuelve cómo sacarla; varias instalaciones comparten una sola. */
export function installKbdNav(doc: Document = document): () => void {
  installs += 1;
  if (!uninstall) {
    const root = doc.documentElement;
    let mode: KbdMode = 'pointer';
    let lastInput: 'key' | 'pointer' = 'pointer';
    const set = (m: KbdMode) => {
      mode = m;
      root.setAttribute(KBD_ATTR, m === 'pointer' ? '0' : '1');
    };
    const setLast = (v: 'key' | 'pointer') => {
      lastInput = v;
      root.setAttribute(KBD_LAST_ATTR, v);
    };
    const onPointer = () => {
      setLast('pointer');
      if (mode !== 'pointer') set('pointer');
    };
    const onKey = (e: KeyboardEvent) => {
      if (MODIFIERS.has(e.key)) return;
      const typing = e.target instanceof Element && e.target.matches(TEXT_ENTRY);
      // Escribir en un campo no es manejar la pantalla con el teclado: el cursor de la lista no se marca por eso.
      if (typing) lastInput = 'key';
      else setLast('key');
      // El diálogo o el menú que abrió un atajo ya se cerró y el foco no volvió a ningún lado: se apagan los anillos.
      const from = mode === 'overlay' && !doc.activeElement?.closest(OVERLAY) ? 'pointer' : mode;
      const next = modeAfterKey(from, e);
      if (next !== mode) set(next);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (lastInput !== 'key' || mode === 'tab') return;
      const el = e.target instanceof Element ? e.target : null;
      const next = modeAfterFocus(mode, !!el?.closest(OVERLAY));
      if (next !== mode) set(next);
    };
    const onClick = (e: MouseEvent) => {
      // detail 0: el "clic" de Enter o Espacio. Ese foco se queda donde está.
      if (mode !== 'pointer' || e.detail === 0) return;
      const hit = e.target instanceof Element ? e.target.closest<HTMLElement>(RELEASE) : null;
      if (hit && hit === doc.activeElement) hit.blur();
    };
    set('pointer');
    setLast('pointer');
    doc.addEventListener('pointerdown', onPointer, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('focusin', onFocusIn, true);
    doc.addEventListener('click', onClick);
    uninstall = () => {
      doc.removeEventListener('pointerdown', onPointer, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('focusin', onFocusIn, true);
      doc.removeEventListener('click', onClick);
      root.removeAttribute(KBD_ATTR);
      root.removeAttribute(KBD_LAST_ATTR);
    };
  }
  return () => {
    installs -= 1;
    if (installs === 0 && uninstall) {
      uninstall();
      uninstall = null;
    }
  };
}
