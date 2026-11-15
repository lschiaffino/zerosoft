'use client';

/**
 * Texto de un agente (Markdown de Claude Code) en una burbuja: bloques de código, código en línea, **negrita**,
 * listas y links. Sin HTML: todo se arma con nodos de React, nada se inyecta.
 */
import { Fragment, type ReactNode } from 'react';

const URL_RE = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  // `código` primero; dentro del resto, **negrita** y links.
  const parts = text.split(/(`[^`\n]+`)/g);
  parts.forEach((part, i) => {
    if (/^`[^`\n]+`$/.test(part)) {
      out.push(
        <code key={`${key}c${i}`} className="flt-ic">
          {part.slice(1, -1)}
        </code>,
      );
      return;
    }
    part.split(/(\*\*[^*\n]+\*\*)/g).forEach((seg, j) => {
      if (/^\*\*[^*\n]+\*\*$/.test(seg)) {
        out.push(<strong key={`${key}b${i}.${j}`}>{seg.slice(2, -2)}</strong>);
        return;
      }
      seg.split(URL_RE).forEach((bit, k) => {
        if (!bit) return;
        if (/^https?:\/\//.test(bit)) {
          out.push(
            <a key={`${key}u${i}.${j}.${k}`} href={bit} target="_blank" rel="noopener noreferrer">
              {bit}
            </a>,
          );
        } else {
          out.push(<Fragment key={`${key}t${i}.${j}.${k}`}>{bit}</Fragment>);
        }
      });
    });
  });
  return out;
}

export default function AgentText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const k = `p${blocks.length}`;
    blocks.push(
      <p key={k} className="flt-p">
        {para.map((l, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(l.replace(/^#{1,6}\s+/, ''), `${k}.${n}`)}
          </Fragment>
        ))}
      </p>,
    );
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={`pre${blocks.length}`} className="flt-pre">
          <code>{code.join('\n')}</code>
        </pre>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      flush();
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const k = `l${blocks.length}`;
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={k} className="flt-ul">
          {items.map((it, n) => (
            <li key={n}>{inline(it, `${k}.${n}`)}</li>
          ))}
        </List>,
      );
      continue;
    }
    if (!line.trim()) flush();
    else para.push(line);
    i++;
  }
  flush();
  return <div className="flt-md">{blocks}</div>;
}
