'use client';

import { useEffect, useRef, type FocusEvent, type KeyboardEvent, type TextareaHTMLAttributes } from 'react';
import { flushSync } from 'react-dom';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'rows' | 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
};

/**
 * Título editable de una página de detalle: una sola "línea" lógica (Enter no
 * agrega saltos, confirma) que crece al alto del texto, así un título largo se
 * lee entero igual que uno de solo lectura en lugar de cortarse a mitad de letra.
 * Esc vuelve al texto que tenía al entrar y sale; quien pasa su onKeyDown y
 * llama preventDefault se encarga solo.
 */
export default function TitleInput({ value, onValueChange, onKeyDown, onFocus, className = '', ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const atFocus = useRef(value);

  // Navegadores sin field-sizing: content (ver .ui-title-input): se mide a mano.
  useEffect(() => {
    const el = ref.current;
    if (!el || (typeof CSS !== 'undefined' && CSS.supports('field-sizing', 'content'))) return;
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter de un IME confirma la composición, no el título.
    if (e.nativeEvent.isComposing) return;
    onKeyDown?.(e);
    if (e.key === 'Enter' && !e.defaultPrevented) {
      e.preventDefault();
      e.currentTarget.blur();
    }
    if (e.key === 'Escape' && !e.defaultPrevented) {
      e.preventDefault();
      const el = e.currentTarget;
      // Antes del blur, para que un guardado en onBlur ya vea el texto original.
      flushSync(() => onValueChange(atFocus.current));
      el.blur();
    }
  };

  return (
    <textarea
      {...rest}
      ref={ref}
      rows={1}
      className={`ui-title-input ${className}`.trim()}
      value={value}
      onChange={(e) => onValueChange(e.target.value.replace(/\s*\n\s*/g, ' '))}
      onFocus={(e: FocusEvent<HTMLTextAreaElement>) => {
        atFocus.current = value;
        onFocus?.(e);
      }}
      onKeyDown={handleKeyDown}
    />
  );
}
