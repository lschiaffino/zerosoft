'use client';

import { useEffect, useState } from 'react';

/** Un valor (HEX, OKLCH) que se copia al portapapeles con un click. */
export default function CopyValue({ value, label, copied }: { value: string; label: string; copied: string }) {
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(false), 1600);
    return () => clearTimeout(t);
  }, [done]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
    } catch {
      // Sin permiso de portapapeles: el valor queda visible para copiarlo a mano.
    }
  }

  return (
    <button type="button" className={`bp-copy data${done ? ' is-done' : ''}`} onClick={copy} aria-label={label}>
      <span className="bp-copy-value">{value}</span>
      <span className="bp-copy-state" aria-live="polite">
        {done ? copied : ''}
      </span>
    </button>
  );
}
