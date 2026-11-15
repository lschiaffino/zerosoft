/**
 * Fleet: todo lo que muestra el tablero en un solo paquete (la página del servidor y el refresco del cliente).
 * Server-only.
 */
import { feedCursor, listConnections, listDeploys, listPulls, listReleases, listRuns, type FleetActor } from './core';
import { listSessions } from './sessions';
import type { ConnectionDto, DeployDto, NowSummary, PullDto, ReleaseDto, RunDto, SessionDto } from './types';

export interface BoardData {
  sessions: SessionDto[];
  pulls: PullDto[];
  deploys: DeployDto[];
  runs: RunDto[];
  releases: ReleaseDto[];
  connections: ConnectionDto[];
  summary: NowSummary;
  cursor: number;
}

export function summarize(sessions: SessionDto[], pulls: PullDto[], deploys: DeployDto[]): NowSummary {
  return {
    working: sessions.filter((s) => s.status === 'working').length,
    waiting: sessions.filter((s) => s.status === 'waiting').length,
    prsOpen: pulls.length,
    failingChecks: pulls.filter((p) => p.checks === 'failure').length,
    deploying: deploys.filter((d) => d.state === 'building' || d.state === 'queued').length,
  };
}

export async function loadBoard(actor: FleetActor): Promise<BoardData> {
  // El cursor primero: lo que pase mientras se lee llega después por el feed.
  const cursor = await feedCursor(actor);
  const [sessions, pulls, deploys, runs, releases, connections] = await Promise.all([
    listSessions(actor),
    listPulls(actor),
    listDeploys(actor),
    listRuns(actor),
    listReleases(actor),
    listConnections(actor),
  ]);
  return { sessions, pulls, deploys, runs, releases, connections, summary: summarize(sessions, pulls, deploys), cursor };
}
