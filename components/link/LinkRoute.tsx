/**
 * El recorrido del link en una fila de texto: link corto → URL larga. Si hay
 * ruteo (reglas, A/B, deep links), se suman las variantes contadas al final.
 */
export default function LinkRoute({
  short,
  destination,
  label,
  branches = 0,
  branchesLabel,
}: {
  short: string;
  destination: string;
  /** Nombre accesible del recorrido ("Recorrido del link"). */
  label: string;
  /** Destinos extra del ruteo (reglas + variantes + apps). */
  branches?: number;
  branchesLabel?: string;
}) {
  const shortText = short.replace(/^https?:\/\//, '');
  const destText = destination.replace(/^https?:\/\//, '');
  return (
    <div className="lk-route" role="group" aria-label={label}>
      <span className="lk-route-name data" title={short}>
        {shortText}
      </span>
      <span className="lk-route-arrow" aria-hidden="true">
        →
      </span>
      <a className="lk-route-name data" href={destination} target="_blank" rel="noopener noreferrer" title={destination}>
        {destText}
      </a>
      {branches > 0 && branchesLabel && <span className="lk-route-branches">{branchesLabel}</span>}
    </div>
  );
}
