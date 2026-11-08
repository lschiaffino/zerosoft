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

/**
 * Una línea con lo de WhatsApp a nivel de línea: "> cita", "- " o "* " para
 * viñetas y "1. " para listas numeradas.
 */
function renderLine(line: string, key: string): ReactNode {
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) return <span key={key} className="wa-bq">{renderNodes(parseWa(quote[1]), key)}</span>;
  const bullet = /^[-*•]\s+(.*)$/.exec(line);
  if (bullet) return <span key={key} className="wa-li"><span className="wa-li-mark" aria-hidden="true">•</span>{renderNodes(parseWa(bullet[1]), key)}</span>;
  const num = /^(\d{1,3})\.\s+(.*)$/.exec(line);
  if (num) return <span key={key} className="wa-li"><span className="wa-li-mark">{num[1]}.</span>{renderNodes(parseWa(num[2]), key)}</span>;
  return <span key={key}>{renderNodes(parseWa(line), key)}</span>;
}

export default function RichText({ text, inline = false }: { text: string; inline?: boolean }) {
  // En una cita (una línea) solo el formato de palabras.
  if (inline) return <>{renderNodes(parseWa(text.replace(/\n+/g, ' ')))}</>;
  // Los bloques ``` primero (adentro no hay formato); el resto, línea por línea. Sin línea en blanco extra alrededor del bloque.
  const out: ReactNode[] = [];
  const re = /```([\s\S]+?)```/g;
  let last = 0;
  let k = 0;
  const pushText = (chunk: string) => {
    const lines = chunk.split('\n');
    lines.forEach((ln, i) => {
      if (i > 0) out.push('\n');
      if (ln) out.push(renderLine(ln, `l${k++}`));
    });
  };
  for (let m = re.exec(text); m; m = re.exec(text)) {
    pushText(text.slice(last, m.index).replace(/\n$/, ''));
    out.push(
      <code key={`p${k++}`} className="wa-pre">
        {m[1].replace(/^\n|\n$/g, '')}
      </code>,
    );
    last = m.index + m[0].length;
    if (text[last] === '\n') last++;
  }
  pushText(text.slice(last));
  return <>{out}</>;
}
