import type { ReactNode } from 'react';
import { linkify } from './format';
import { parseWa, type WaNode } from './rich';

export { parseWa };

/**
 * Formato de WhatsApp en un texto: *negrita*, _cursiva_, ~tachado~,
 * ```monoespaciado``` y `código`. Arma nodos de React (nunca HTML), así que
 * cualquier etiqueta queda como texto. Los links se vuelven links.
 *
 * Reglas como en WhatsApp: el marcador abre al principio o después de un
 * espacio o signo, y cierra antes de un espacio, signo o el final; el texto de
 * adentro no puede empezar ni terminar con espacio.
 */

function renderNodes(nodes: WaNode[], key = 'n'): ReactNode[] {
  return nodes.map((n, i) => {
    const k = `${key}-${i}`;
    if (typeof n === 'string') {
      return linkify(n).map((p, j) =>
        p.href ? (
          <a key={`${k}-${j}`} href={p.href} target="_blank" rel="noreferrer noopener">
            {p.text}
          </a>
        ) : (
          <span key={`${k}-${j}`}>{p.text}</span>
        ),
      );
    }
    const kids = n.kind === 'pre' || n.kind === 'code' ? (n.children as string[]).join('') : renderNodes(n.children, k);
    switch (n.kind) {
      case 'b':
        return <strong key={k}>{kids}</strong>;
      case 'i':
        return <em key={k}>{kids}</em>;
      case 's':
        return <s key={k}>{kids}</s>;
      case 'code':
        return (
          <code key={k} className="wa-code">
            {kids}
          </code>
        );
      default:
        return (
          <code key={k} className="wa-pre">
            {kids}
          </code>
        );
    }
  });
}

export default function RichText({ text }: { text: string }) {
  return <>{renderNodes(parseWa(text))}</>;
}
