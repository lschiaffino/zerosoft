'use client';

import { createContext, type ReactNode } from 'react';
import type { DocsBlock } from '@/lib/docs-types';

/**
 * Lo que una app quiere mostrar al lado de un todo del editor (Notes: fecha y
 * responsable). Sin proveedor no se dibuja nada: Docs no cambia.
 */
export const DocsTodoAccessory = createContext<((block: DocsBlock) => ReactNode) | null>(null);
