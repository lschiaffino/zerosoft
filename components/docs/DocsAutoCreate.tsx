'use client';

import { useEffect, useRef } from 'react';

/**
 * /app/docs?new=1 (menú "+ Nuevo" / ⌘K): envía la server action de "nueva
 * página" al montar (nunca en el GET del servidor, que un prefetch podría
 * disparar). La action redirige al editor de la página creada.
 */
export default function DocsAutoCreate({ action }: { action: () => Promise<void> }) {
  const formRef = useRef<HTMLFormElement>(null);
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    // Saca ?new=1 de la URL: volver atrás no debe crear otro.
    const url = new URL(window.location.href);
    url.searchParams.delete('new');
    window.history.replaceState(window.history.state, '', url);
    formRef.current?.requestSubmit();
  }, []);

  return <form ref={formRef} action={action} hidden aria-hidden="true" />;
}
