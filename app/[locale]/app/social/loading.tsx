/** Social cargando: el esqueleto de la cabecera y unas filas. */
export default function SocialLoading() {
  return (
    <div className="ui-loading-stack" aria-busy="true">
      <div className="ui-skeleton ui-skeleton-title" />
      <div className="ui-skeleton ui-skeleton-row" />
      <div className="ui-skeleton ui-skeleton-row" />
      <div className="ui-skeleton ui-skeleton-row" />
    </div>
  );
}
