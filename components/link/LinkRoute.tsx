/**
 * El link dibujado como un tramo de su línea: la estación de origen es el link
 * corto y la de destino es la URL larga. Si hay ruteo (reglas, A/B, deep
 * links), el destino se marca como combinación con las variantes contadas.
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
      <span className="lk-route-stop">
        <span className="lk-route-station" aria-hidden="true" />
        <span className="lk-route-name data" title={short}>
          {shortText}
        </span>
      </span>
      <span className="lk-route-line" aria-hidden="true" />
      <span className="lk-route-stop lk-route-end">
        {branches > 0 ? (
          <span className="lk-route-ix" aria-hidden="true">
            <span className="lk-route-station" />
            <span className="lk-route-ix-bar" />
            <span className="lk-route-station" />
          </span>
        ) : (
          <span className="lk-route-station" aria-hidden="true" />
        )}
        <a className="lk-route-name data" href={destination} target="_blank" rel="noopener noreferrer" title={destination}>
          {destText}
        </a>
        {branches > 0 && branchesLabel && <span className="lk-route-branches">{branchesLabel}</span>}
      </span>
    </div>
  );
}
