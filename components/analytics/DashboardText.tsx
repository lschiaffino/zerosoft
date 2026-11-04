import { renderTrackMarkdown } from '@/lib/track-markdown';

/** Tarjeta de texto de un tablero: Markdown, con el HTML seguro que arma lib/track-markdown. */
export default function DashboardText({ body }: { body: string }) {
  // eslint-disable-next-line react/no-danger
  return <div className="an-text-card" dangerouslySetInnerHTML={{ __html: renderTrackMarkdown(body) }} />;
}
