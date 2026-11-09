'use client';

import { useRef, type ComponentProps } from 'react';
import { Link, useRouter } from '@/i18n/navigation';

/**
 * Link a un issue desde una fila o card. Sin prefetch por estar visible (una
 * lista de cien issues pedía cien páginas): se prefetchea al pasar el mouse o
 * al enfocar, una sola vez.
 */
export default function IssueLink({ href, onMouseEnter, onFocus, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const router = useRouter();
  const done = useRef(false);
  const warm = () => {
    if (done.current) return;
    done.current = true;
    router.prefetch(href);
  };
  return (
    <Link
      href={href}
      prefetch={false}
      onMouseEnter={(e) => {
        warm();
        onMouseEnter?.(e);
      }}
      onFocus={(e) => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    />
  );
}
