'use client';

import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';

/**
 * Campo de búsqueda que guarda lo que se escribe en su propio estado y avisa
 * (`onCommit`) cuando se deja de escribir. La pantalla que lo usa no se
 * vuelve a dibujar con cada tecla: solo cuando cambia la búsqueda de verdad.
 * `value` es la búsqueda vigente; si cambia desde afuera (limpiar, abrir una
 * lista guardada) el campo la toma. Escape la limpia en el acto (salvo
 * `clearOnEscape={false}`).
 */
const DebouncedInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onCommit: (value: string) => void; delay?: number; clearOnEscape?: boolean }
>(function DebouncedInput({ value, onCommit, delay = 220, clearOnEscape = true, onKeyDown, ...rest }, ref) {
  const [text, setText] = useState(value);
  const committed = useRef(value);
  const commit = useRef(onCommit);
  useEffect(() => {
    commit.current = onCommit;
  });
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setText(value);
  }, [value]);
  useEffect(() => {
    if (text === committed.current) return;
    const id = window.setTimeout(() => {
      committed.current = text;
      commit.current(text);
    }, delay);
    return () => window.clearTimeout(id);
  }, [text, delay]);
  return (
    <input
      {...rest}
      ref={ref}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (clearOnEscape && e.key === 'Escape' && text) {
          committed.current = '';
          setText('');
          commit.current('');
        }
        onKeyDown?.(e);
      }}
    />
  );
});

export default DebouncedInput;
