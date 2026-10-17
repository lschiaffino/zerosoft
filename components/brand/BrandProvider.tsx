'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_BRAND, type BrandTheme } from '@/lib/brand-theme';

const BrandContext = createContext<BrandTheme>(DEFAULT_BRAND);

/**
 * El tema de marca del request, para los componentes que dibujan la marca
 * (Logo, ProductGlyph). Lo resuelve el layout en el servidor (cookie o ruta),
 * así server y cliente renderizan lo mismo.
 */
export default function BrandProvider({ brand, children }: { brand: BrandTheme; children: ReactNode }) {
  return <BrandContext.Provider value={brand}>{children}</BrandContext.Provider>;
}

export function useBrand(): BrandTheme {
  return useContext(BrandContext);
}
