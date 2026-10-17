import { useRef } from 'react';

/**
 * Claves estables para una lista sin ids propios (pasos, entradas): siguen al
 * elemento cuando se mueve o se borra otro, así el estado local de cada fila
 * (reintentos abiertos, foco) no se queda pegado al índice.
 * Si la lista cambia de largo desde afuera (pegar, guardar), se completan o recortan.
 */
export function useStableKeys(length: number) {
  const keys = useRef<string[]>([]);
  const seq = useRef(0);
  const make = () => `k${seq.current++}`;
  if (keys.current.length !== length) {
    keys.current = Array.from({ length }, (_, i) => keys.current[i] ?? make());
  }
  return {
    keys: keys.current,
    swap(i: number, j: number) {
      const next = [...keys.current];
      [next[i], next[j]] = [next[j], next[i]];
      keys.current = next;
    },
    remove(i: number) {
      keys.current = keys.current.filter((_, k) => k !== i);
    },
  };
}
