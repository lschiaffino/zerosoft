'use client';

import { Fragment, useMemo, type ReactNode } from 'react';
import { parseTalkMarkdown, type TalkInline } from '@/lib/talk-markdown';
import { useTalk } from './talk-context';

/** Pinta el texto de un mensaje (lib/talk-markdown.ts) con React: nunca HTML crudo. */
export default function MessageBody({ body }: { body: string }) {
  const blocks = useMemo(() => parseTalkMarkdown(body), [body]);
  return (
    <div className="talk-body">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i}>
                <Inline nodes={b.c} />
              </p>
            );
          case 'pre':
            return (
              <pre key={i} className="talk-pre">
                <code>{b.v}</code>
              </pre>
            );
          case 'quote':
            return (
              <blockquote key={i}>
                <Inline nodes={b.c} />
              </blockquote>
            );
          case 'ul':
            return (
              <ul key={i}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline nodes={it} />
                  </li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} start={b.start}>
                {b.items.map((it, j) => (
                  <li key={j}>
                    <Inline nodes={it} />
                  </li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}

function Inline({ nodes }: { nodes: TalkInline[] }): ReactNode {
  const { personName, channelById, boot, open, me } = useInlineCtx();
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'br':
        return <br key={i} />;
      case 'b':
        return (
          <strong key={i}>
            <Inline nodes={n.c} />
          </strong>
        );
      case 'i':
        return (
          <em key={i}>
            <Inline nodes={n.c} />
          </em>
        );
      case 's':
        return (
          <s key={i}>
            <Inline nodes={n.c} />
          </s>
        );
      case 'code':
        return (
          <code key={i} className="talk-code">
            {n.v}
          </code>
        );
      case 'link': {
        const internal = isInternal(n.href);
        return (
          <a key={i} href={n.href} target={internal ? undefined : '_blank'} rel={internal ? undefined : 'noopener noreferrer nofollow'}>
            {n.label}
          </a>
        );
      }
      case 'user':
        return (
          <span key={i} className={`talk-mention${n.id === me ? ' is-me' : ''}`}>
            @{personName(n.id)}
          </span>
        );
      case 'group': {
        const g = boot.groups.find((x) => x.id === n.id);
        return (
          <span key={i} className={`talk-mention${g?.members.includes(me) ? ' is-me' : ''}`}>
            @{g?.handle ?? n.id}
          </span>
        );
      }
      case 'special':
        return (
          <span key={i} className="talk-mention is-me">
            @{n.v}
          </span>
        );
      case 'chan': {
        const c = channelById.get(n.id);
        return (
          <button key={i} type="button" className="talk-chan-link" onClick={() => open({ channelId: n.id })}>
            #{c?.name ?? n.id}
          </button>
        );
      }
      case 'emoji':
        return (
          <span key={i} className="talk-emoji" title={`:${n.name}:`}>
            {n.char}
          </span>
        );
    }
  });
}

function useInlineCtx() {
  const ctx = useTalk();
  return { ...ctx, me: ctx.boot.me };
}

function isInternal(href: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return new URL(href).origin === window.location.origin;
  } catch {
    return false;
  }
}

/** Avatar con la inicial (o la foto) y el punto de presencia. */
export function Avatar({ id, size = 32, presence = false }: { id: string | null; size?: number; presence?: boolean }) {
  const { people, presence: pres, personName } = useTalk();
  const p = id ? people.get(id) : undefined;
  const name = id ? personName(id) : '';
  const active = id ? pres.get(id)?.active : false;
  return (
    <span className="talk-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {p?.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.image} alt="" width={size} height={size} referrerPolicy="no-referrer" />
      ) : (
        <span className="talk-avatar-initial" style={{ fontSize: Math.round(size * 0.42) }}>
          {(name || '?').slice(0, 1).toUpperCase()}
        </span>
      )}
      {presence && <span className={`talk-dot${active ? ' is-active' : ''}`} />}
    </span>
  );
}
