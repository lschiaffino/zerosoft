'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Firma dibujada con mouse, dedo o lápiz (pointer events) sobre un canvas.
 * `onChange` recibe la firma como data URL JPEG con fondo blanco (lo que
 * guarda el servidor y va al certificado), o '' si está vacía. La comparten
 * las cotizaciones del CRM y Sign (estilos en styles/esign.css).
 */
export default function SignaturePad({
  label,
  clearLabel,
  onChange,
}: {
  label: string;
  clearLabel: string;
  onChange: (dataUrl: string) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [empty, setEmpty] = useState(true);

  function reset() {
    const c = ref.current;
    if (!c) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = c.getBoundingClientRect();
    c.width = Math.max(1, Math.round(rect.width * ratio));
    c.height = Math.max(1, Math.round(rect.height * ratio));
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, rect.width, rect.height);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
    setEmpty(true);
    onChange('');
  }

  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function exportImage() {
    const c = ref.current;
    if (!c) return;
    // Se exporta a un canvas chico: la firma no necesita más de 600 px de ancho.
    const out = document.createElement('canvas');
    const scale = Math.min(1, 600 / c.width);
    out.width = Math.round(c.width * scale);
    out.height = Math.round(c.height * scale);
    const ctx = out.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(c, 0, 0, out.width, out.height);
    onChange(out.toDataURL('image/jpeg', 0.85));
  }

  return (
    <div className="esign-pad">
      <canvas
        ref={ref}
        className="esign-pad-canvas"
        role="img"
        aria-label={label}
        data-testid="signature-pad"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
          const ctx = e.currentTarget.getContext('2d');
          if (ctx && last.current) {
            ctx.beginPath();
            ctx.arc(last.current.x, last.current.y, 1, 0, Math.PI * 2);
            ctx.fillStyle = '#111111';
            ctx.fill();
          }
        }}
        onPointerMove={(e) => {
          if (!drawing.current || !last.current) return;
          const ctx = e.currentTarget.getContext('2d');
          const p = point(e);
          if (ctx) {
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
          last.current = p;
          if (empty) setEmpty(false);
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          last.current = null;
          setEmpty(false);
          exportImage();
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      />
      <div className="esign-pad-row">
        <span className="esign-pad-label">{label}</span>
        <button type="button" className="esign-pad-clear" onClick={reset} disabled={empty}>
          {clearLabel}
        </button>
      </div>
    </div>
  );
}
