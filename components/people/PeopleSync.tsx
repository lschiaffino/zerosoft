'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from '@/i18n/navigation';

/** Falta alguna ficha: la pide una vez (el GET de la página no escribe) y vuelve a pintar. */
export default function PeopleSync() {
  const router = useRouter();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    void fetch('/api/people/me', { method: 'POST' })
      .then((res) => {
        if (res.ok) router.refresh();
      })
      .catch(() => undefined);
  }, [router]);
  return null;
}
