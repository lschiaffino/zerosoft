'use client';

import { useEffect, useState } from 'react';

const DESKTOP = '(min-width: 1024px)';

/**
 * Hueco #side-branch del sidebar del shell, donde un producto cuelga su lista
 * (páginas de Docs, pizarras, proyectos de Track). Solo en ≥1024px y con el
 * sidebar abierto: colapsado (solo íconos) o en mobile (drawer) devuelve null.
 */
export function useShellBranch(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const frame = document.querySelector('.app-frame');
    let raf = 0;
    const update = () => {
      const slot = document.getElementById('side-branch');
      const collapsed = frame?.classList.contains('sidebar-collapsed') ?? false;
      setEl(mq.matches && !collapsed ? slot : null);
      // Al entrar desde otro producto el hueco puede montarse un frame después.
      if (!slot && mq.matches && !collapsed && !raf) raf = requestAnimationFrame(update);
    };
    update();
    mq.addEventListener('change', update);
    const mo = frame ? new MutationObserver(update) : null;
    mo?.observe(frame!, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mq.removeEventListener('change', update);
      mo?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  return el;
}

/**
 * El mismo hueco #side-branch, pero solo con el sidebar colapsado (≥1024px): ahí
 * un producto cuelga una versión angosta de su lista (las carpetas como íconos).
 */
export function useCollapsedBranch(): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const frame = document.querySelector('.app-frame');
    const update = () => {
      const collapsed = frame?.classList.contains('sidebar-collapsed') ?? false;
      setEl(mq.matches && collapsed ? document.getElementById('side-branch') : null);
    };
    update();
    mq.addEventListener('change', update);
    const mo = frame ? new MutationObserver(update) : null;
    mo?.observe(frame!, { attributes: true, attributeFilter: ['class'] });
    return () => {
      mq.removeEventListener('change', update);
      mo?.disconnect();
    };
  }, []);
  return el;
}
