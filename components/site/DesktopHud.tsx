/**
 * La barra de dictado de la app de escritorio, armada con el mismo HTML y los
 * mismos colores que desktop/ui/hud.html (punto rojo, medidor, "Escuchando",
 * reloj y la pista de Esc), sobre una ventana cualquiera donde va a caer el
 * texto. Es la interfaz real redibujada, no una captura: el pie lo dice.
 */
export default function DesktopHud({
  labels,
}: {
  labels: { window: string; to: string; subject: string; body: string; listening: string; hint: string; caption: string; alt: string };
}) {
  return (
    <figure className="dk-fig">
      <div className="dk-stage" role="img" aria-label={labels.alt}>
        <div className="dk-window" aria-hidden="true">
          <div className="dk-window-bar">
            <span className="dk-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="dk-window-title">{labels.window}</span>
          </div>
          <div className="dk-mail">
            <p className="dk-mail-row">
              <span>{labels.to}</span>
            </p>
            <p className="dk-mail-row dk-mail-subject">{labels.subject}</p>
            <p className="dk-mail-body">
              {labels.body}
              <span className="dk-caret" />
            </p>
          </div>
        </div>
        <div className="dk-hud" aria-hidden="true">
          <span className="dk-hud-dot" />
          <span className="dk-hud-meter">
            {[5, 9, 14, 8, 16, 11, 6, 10, 4].map((h, i) => (
              <span key={i} style={{ height: h }} />
            ))}
          </span>
          <span className="dk-hud-label">{labels.listening}</span>
          <span className="dk-hud-clock">0:06</span>
          <span className="dk-hud-hint">{labels.hint}</span>
        </div>
      </div>
      <figcaption className="fig-cap">{labels.caption}</figcaption>
    </figure>
  );
}
