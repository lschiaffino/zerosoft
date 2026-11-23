import { NextRequest, NextResponse } from 'next/server';
import { issueAccess } from '@/lib/track-triage-http';
import { getIssueSla } from '@/lib/track-sla';
import { listIssueRequests } from '@/lib/track-customers';
import { listAgentOptions, listIssueSessions } from '@/lib/track-agents';
import { getIssueSummary, getTriageSuggestions, trackAiAvailable } from '@/lib/track-ai';
import { getTriageSettings } from '@/lib/track-triage';
import { loadStatusTime } from '@/lib/track-status-time-db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Todo lo de T3 para la página del issue: SLA, pedidos, agentes, resumen y sugerencias de IA, y el time in status. */
export async function GET(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const a = await issueAccess((await props.params).id);
  if (!a.ok) return a.res;
  const [sla, requests, sessions, agents, summary, suggestions, ai, settings, statusTime] = await Promise.all([
    getIssueSla(a.issue.id),
    listIssueRequests(a.issue.id),
    listIssueSessions(a.issue.id),
    listAgentOptions(a.user.id),
    getIssueSummary(a.issue.id),
    getTriageSuggestions(a.issue.id),
    trackAiAvailable(),
    getTriageSettings(a.issue.project_id),
    loadStatusTime(a.issue.id),
  ]);
  return NextResponse.json({
    sla,
    slaEnabled: settings.slaEnabled,
    requests,
    sessions,
    agents,
    summary,
    suggestions: suggestions.suggestions,
    aiAvailable: ai,
    statusTime,
  });
}
