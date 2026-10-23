'use client';

let pending: Promise<unknown> | null = null;

/**
 * Baja el chunk del lienzo (Excalidraw, ~600 KB de JS) antes de abrir una
 * pizarra: al apuntar o enfocar una en la lista o el sidebar. next/dynamic
 * en BoardEditor reusa el mismo módulo, así que al abrirla ya está cargado.
 */
export function preloadCanvas(): void {
  pending ??= import('./ExcalidrawCanvas').catch(() => {
    pending = null; // un fallo de red no impide reintentar en el próximo hover
  });
}
