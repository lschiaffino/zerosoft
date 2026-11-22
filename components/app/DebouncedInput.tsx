'use client';

import { forwardRef, useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import SearchClear from './SearchClear';

/**
 * Campo de búsqueda que guarda lo que se escribe en su propio estado y avisa
 * (`onCommit`) cuando se deja de escribir. La pantalla que lo usa no se
 * vuelve a dibujar con cada tecla: solo cuando cambia la búsqueda de verdad.
 * `value` es la búsqueda vigente; si cambia desde afuera (limpiar, abrir una
 * lista guardada) el campo la toma. Escape la limpia en el acto (salvo
 * `clearOnEscape={false}`). Con `clearLabel` suma la × propia para vaciarlo
 * (components/app/SearchClear.tsx); el contenedor tiene que ser `position: relative`.
 */
const DebouncedInput = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & { value: string; onCommit: (value: string) => void; delay?: number; clearOnEscape?: boolean; clearLabel?: string }
>(function DebouncedInput({ value, onCommit, delay = 220, clearOnEscape = true, clearLabel, onKeyDown, ...rest }, ref) {
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
  const clear = () => {
    committed.current = '';
    setText('');
    commit.current('');
  };
  const input = (
    <input
      {...rest}
      ref={ref}
      value={text}
      {...(clearLabel ? { 'data-clearable': '' } : {})}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (clearOnEscape && e.key === 'Escape' && text) clear();
        onKeyDown?.(e);
      }}
    />
  );
  if (!clearLabel) return input;
  return (
    <>
      {input}
      <SearchClear shown={text !== ''} onClear={clear} label={clearLabel} />
    </>
  );
});

export default DebouncedInput;
