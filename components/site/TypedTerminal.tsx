'use client';

import { useEffect, useRef, useState } from 'react';

export type TermLine = { kind: 'cmd' | 'out'; text: string };

/** Un cuadro a 30 fps; cada cuadro escribe dos caracteres. */
const STEP_MS = 33;
const CHARS_PER_STEP = 2;
/** Pausa después de cada comando, como si corriera. */
const PAUSE_STEPS = 9;

/**
 * Una terminal que se escribe sola: los comandos aparecen carácter por
 * carácter y la salida entera de una vez, por pasos y sin easing. Empieza
 * cuando entra en pantalla. Sin JS o con movimiento reducido se ve completa.
 * El texto completo queda para lectores de pantalla y para copiar.
 */
export default function TypedTerminal({ title, lines }: { title: string; lines: TermLine[] }) {
  const ref = useRef<HTMLDivElement>(null);
  // Infinity = todo escrito (servidor, sin JS, movimiento reducido).
  const [shown, setShown] = useState(Number.POSITIVE_INFINITY);
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // Si ya está a la vista al cargar, no se borra lo que la persona está leyendo.
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;

    setShown(0);
    let timer = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        setTyping(true);
        let n = 0;
        let pause = 0;
        const total = budget(lines);
        timer = window.setInterval(() => {
          if (pause > 0) {
            pause--;
            return;
          }
          const before = cursorLine(lines, n);
          // Nunca se pasa del final de la línea: ahí corre el comando.
          n = Math.min(n + CHARS_PER_STEP, lineEnd(lines, before));
          if (cursorLine(lines, n) !== before && lines[before]?.kind === 'cmd') pause = PAUSE_STEPS;
          setShown(n);
          if (n >= total) {
            window.clearInterval(timer);
            setTyping(false);
          }
        }, STEP_MS);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, [lines]);

  const typed = progress(lines, shown);
  const at = cursorLine(lines, shown);

  return (
    <div className="term" ref={ref}>
      <div className="term-bar">
        <span className="term-title">{title}</span>
      </div>
      <pre className="lp-code">
        <code className="sr-only">{lines.map((l) => (l.kind === 'cmd' ? `$ ${l.text}` : l.text)).join('\n')}</code>
        {/* Lo que falta escribir ocupa su lugar sin verse: la caja no salta. */}
        <code aria-hidden="true">
          {lines.map((l, i) => {
            const n = typed[i];
            const started = i <= at;
            return (
              <span key={i} className={started ? 'term-line' : 'term-line term-ghost'}>
                {l.kind === 'cmd' ? (
                  <>
                    <span className={started ? 'tk-p' : 'tk-p term-ghost'}>$ </span>
                    {l.text.slice(0, n)}
                    {typing && i === at && <span className="term-cursor" />}
                    <span className="term-ghost">{l.text.slice(n)}</span>
                  </>
                ) : (
                  <span className={n > 0 ? 'tk-c' : 'tk-c term-ghost'}>{l.text}</span>
                )}
                {'\n'}
              </span>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

/** Cuántos "caracteres" lleva escribir todo: la salida cuenta como uno. */
function budget(lines: TermLine[]) {
  return lines.reduce((s, l) => s + (l.kind === 'cmd' ? l.text.length : 1), 0);
}

function lineEnd(lines: TermLine[], i: number) {
  return budget(lines.slice(0, i + 1));
}

function cursorLine(lines: TermLine[], n: number) {
  let left = n;
  for (let i = 0; i < lines.length; i++) {
    const cost = lines[i].kind === 'cmd' ? lines[i].text.length : 1;
    if (left < cost) return i;
    left -= cost;
  }
  return lines.length;
}

/** Cuántos caracteres de cada línea ya se escribieron. */
function progress(lines: TermLine[], n: number): number[] {
  let left = n;
  return lines.map((l) => {
    const cost = l.kind === 'cmd' ? l.text.length : 1;
    const got = Math.max(0, Math.min(cost, left));
    left -= cost;
    return l.kind === 'cmd' ? got : got > 0 ? 1 : 0;
  });
}
