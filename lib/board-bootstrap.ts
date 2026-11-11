/**
 * Board — lo que el editor necesita al abrir, en una sola lectura del
 * servidor (la página lo manda con la pizarra): estado del taller, tarjetas
 * de Track y comentarios. Así el editor no hace un pedido por cada cosa al
 * cargar; después, cada parte se actualiza sola (eventos en vivo y sondeo).
 */
import { getPrivateMode, getTimerRow, getVoting, timerView } from './board-workshop';
import { draftsView, listPrivateDrafts } from './board-private';
import { listBoardTrackCards } from './board-track';
import { listThreads } from './board-comments';
import { boardAudience } from './board-access';

/** Estado del taller para `personId` (`now` es la hora del servidor, para la cuenta regresiva). */
export async function workshopState(workspaceId: string, boardId: string, personId: string) {
  const now = Date.now();
  const [row, privateMode, voting] = await Promise.all([getTimerRow(workspaceId, boardId), getPrivateMode(workspaceId, boardId), getVoting(boardId, personId)]);
  return {
    now,
    timer: row ? timerView(row, now) : null,
    voting,
    privateMode,
    // Lo propio completo; de los demás, solo dónde están (sin texto).
    drafts: privateMode ? draftsView(await listPrivateDrafts(boardId), personId) : null,
  };
}

export type WorkshopSnapshot = Awaited<ReturnType<typeof workshopState>>;

export interface BoardBootstrap {
  workshop: WorkshopSnapshot;
  track: Awaited<ReturnType<typeof listBoardTrackCards>>;
  comments: { threads: Awaited<ReturnType<typeof listThreads>>; members: Awaited<ReturnType<typeof boardAudience>>; me: string };
}

export async function boardBootstrap(workspaceId: string, boardId: string, personId: string): Promise<BoardBootstrap> {
  const [workshop, track, threads, members] = await Promise.all([
    workshopState(workspaceId, boardId, personId),
    listBoardTrackCards(boardId, personId),
    listThreads(workspaceId, boardId),
    boardAudience(workspaceId, boardId),
  ]);
  return { workshop, track, comments: { threads, members, me: personId } };
}
