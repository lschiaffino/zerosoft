'use client';

import { useEffect } from 'react';

/**
 * Teléfono, como WhatsApp: al abrirse el teclado la pantalla se acomoda. El chat queda del alto
 * que se ve (arriba del teclado) con el campo pegado al teclado, y si estabas al final de la
 * conversación seguís viendo los últimos mensajes.
 *
 * Android (Chrome) achica la página solo con `interactive-widget=resizes-content` (viewport en
 * app/[locale]/layout.tsx). iOS (Safari) no: el teclado tapa la página y `100dvh` no cambia. Acá se
 * lee window.visualViewport y, con el teclado abierto, se publica el alto visible en
 * `--app-vh` (lo usan .gr-inbox de Lines e Inbox), se deshace el corrimiento que hace Safari al
 * enfocar un campo y se vuelve al final de los chats que estaban al final.
 */

/** Diferencia de alto desde la que se considera que hay un teclado (y no una barra del navegador). */
const KEYBOARD_PX = 120;
/** Qué tan cerca del final cuenta como "estaba al final". */
const NEAR_BOTTOM_PX = 80;

export default function KeyboardViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    // Los chats que estaban al final antes del cambio de alto (se mide antes de aplicarlo).
    let pinned: HTMLElement[] = [];
    const remember = () => {
      pinned = Array.from(document.querySelectorAll<HTMLElement>('.wa-messages')).filter((el) => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX);
    };
    const apply = () => {
      frame = 0;
      const open = window.innerHeight - vv.height > KEYBOARD_PX;
      if (open) {
        root.style.setProperty('--app-vh', `${Math.round(vv.height)}px`);
        root.dataset.keyboard = 'open';
        // Safari corre la página para mostrar el campo: con el alto ya ajustado, se vuelve arriba.
        if (window.scrollY !== 0) window.scrollTo(0, 0);
      } else {
        root.style.removeProperty('--app-vh');
        delete root.dataset.keyboard;
      }
      const keep = pinned;
      requestAnimationFrame(() => keep.forEach((el) => (el.scrollTop = el.scrollHeight)));
    };
    const onChange = () => {
      if (!frame) {
        remember();
        frame = requestAnimationFrame(apply);
      }
    };
    // Al enfocar un campo (el teclado está por abrirse) se guarda qué chats estaban al final.
    const onFocus = (e: FocusEvent) => {
      if ((e.target as Element | null)?.matches?.('textarea, input')) remember();
    };
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    document.addEventListener('focusin', onFocus);
    return () => {
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      document.removeEventListener('focusin', onFocus);
      if (frame) cancelAnimationFrame(frame);
      root.style.removeProperty('--app-vh');
      delete root.dataset.keyboard;
    };
  }, []);
  return null;
}
