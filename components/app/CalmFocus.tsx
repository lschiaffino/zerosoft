'use client';

import { useEffect } from 'react';
import { installKbdNav } from '@/lib/kbd-nav';
import '@/styles/calm-focus.css';

/**
 * Foco tranquilo (Inbox y Lines): el anillo de foco aparece solo cuando se navega con Tab, o dentro
 * de un diálogo o menú abierto con un atajo. Va una vez en el layout de la app; mientras está montado,
 * la raíz lleva `data-kbd-nav` y styles/calm-focus.css decide qué se ve. El modelo está en lib/kbd-nav.ts.
 */
export default function CalmFocus() {
  useEffect(() => installKbdNav(), []);
  return null;
}
