'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';
import { whenStreamSettled } from '@/lib/stream-settled';

/** Falta alguna ficha: la pide una vez (el GET de la página no escribe) y vuelve a pintar. */
export default function PeopleSync() {
  const router = useRouter();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    // Con el HTML todavía llegando, un refresh tira la hidratación (ver lib/stream-settled.ts).
    whenStreamSettled(() => {
      void fetch('/api/people/me', { method: 'POST' })
        .then(async (res) => {
          await res.text(); // Sin leer el cuerpo, el pedido queda abierto.
          if (res.ok) router.refresh();
        })
        .catch(() => undefined);
    });
  }, [router]);
  return null;
}
