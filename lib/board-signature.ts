// Firmas baratas de una escena de Excalidraw para saber si algo cambió sin
// comparar ni serializar los elementos. Cada edición sube `version` del
// elemento tocado, así que la suma de versiones más la cantidad alcanza.

type Versioned = { version?: number };

/** Cambia cuando se agrega, borra o edita un elemento (no con cambios de solo appState). */
export function elementsSignature(elements: readonly unknown[]): string {
  let sum = 0;
  for (const e of elements as Versioned[]) sum += e.version ?? 0;
  return `${elements.length}:${sum}`;
}

/** Firma de lo que se guarda: elementos, color de fondo y cantidad de archivos. */
export function sceneSignature(elements: readonly unknown[], bg: unknown, fileCount: number): string {
  return `${elementsSignature(elements)}:${String(bg)}:${fileCount}`;
}
