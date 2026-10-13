/**
 * Una fila de ceros chicos que hace de separador entre secciones (en lugar de
 * los rótulos tipo "01 — Features"). La jerarquía la da la tipografía grande;
 * esto solo marca el corte. El primer cero toma el --accent del contexto
 * (el color del producto en sus páginas, tinta en el resto).
 *
 * Es decorativo: un div con máscara CSS (ver .zero-dots en globals.css).
 */
export default function ZeroDots({ className = '' }: { className?: string }) {
  return <div className={`zero-dots ${className}`.trim()} aria-hidden="true" />;
}
