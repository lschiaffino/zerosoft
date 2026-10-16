import { POST as boardVote } from '@/app/api/board/items/[id]/vote/route';

export const dynamic = 'force-dynamic';

/** Ruta vieja del roadmap: ahora el voto es por usuario (toggle, requiere sesión). */
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  return boardVote(req, props);
}
