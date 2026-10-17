import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';

export interface DataColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Cifras: alineadas a la derecha, tabulares. */
  numeric?: boolean;
  /** Valores para copiar o comparar (IDs, URLs, HEX): JetBrains Mono. */
  data?: boolean;
  width?: string;
}

/**
 * Tabla densa (filas de 36px, cabecera de 32px, filetes de 1px). Sirve en
 * server y client components; no ordena ni pagina: eso lo hace la página.
 * `rowHref` vuelve link la primera columna (el resto de la fila queda
 * seleccionable). `empty` se muestra en lugar de la tabla si no hay filas.
 * Cada celda lleva `data-label` con la cabecera (si es texto) para que una
 * pantalla pueda apilar la fila en pares rótulo/valor en mobile.
 *
 *   <DataTable caption="Links" rows={links} rowKey={(l) => l.id} rowHref={(l) => `/app/links/${l.id}`}
 *     columns={[{ key: 'slug', header: 'Link', cell: (l) => l.slug, data: true },
 *               { key: 'clicks', header: 'Clics', cell: (l) => fmt(l.clicks), numeric: true }]} />
 */
export default function DataTable<T>({
  columns,
  rows,
  rowKey,
  rowHref,
  caption,
  empty,
  compact = false,
  sticky = false,
  className = '',
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  rowHref?: (row: T) => string;
  /** Nombre de la tabla para lectores de pantalla. */
  caption?: string;
  empty?: ReactNode;
  compact?: boolean;
  sticky?: boolean;
  className?: string;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  const cls = ['table', compact && 'table-compact', sticky && 'table-sticky'].filter(Boolean).join(' ');
  const cellCls = (c: DataColumn<T>) => [c.numeric && 'num', c.data && 'data'].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`table-wrap ${className}`.trim()}>
      <table className={cls}>
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined} style={c.width ? { width: c.width } : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c, i) => (
                <td key={c.key} className={cellCls(c)} data-label={typeof c.header === 'string' ? c.header : undefined}>
                  {i === 0 && rowHref ? (
                    <Link href={rowHref(row)} className="cell-link">
                      {c.cell(row)}
                    </Link>
                  ) : (
                    c.cell(row)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
