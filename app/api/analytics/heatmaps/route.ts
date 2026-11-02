import { NextRequest, NextResponse } from 'next/server';
import { actorProject, aError, analyticsActor, isResponse } from '@/lib/analytics/http';
import { rangeStart, VIEWPORT_BUCKETS, type ViewportBucket } from '@/lib/analytics/heatmap-core';
import { heatmapData, heatmapPaths } from '@/lib/analytics/heatmaps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Sin ?path=: las rutas vistas. Con ?path=: clics, elementos y scroll de esa ruta y ese tamaño de pantalla. */
export async function GET(req: NextRequest) {
  const actor = await analyticsActor(req, 'read');
  if (isResponse(actor)) return actor;
  const sp = req.nextUrl.searchParams;
  const project = await actorProject(actor, sp.get('project'));
  if (isResponse(project)) return project;
  const now = Date.now();
  const from = rangeStart(sp.get('range') ?? '-7d', now) ?? now - 7 * 86_400_000;
  const path = sp.get('path');
  if (!path) return NextResponse.json({ paths: await heatmapPaths(project, from) });
  if (path.length > 2000) return aError(400, 'invalid_input');
  const bucket = (VIEWPORT_BUCKETS as readonly string[]).includes(sp.get('viewport') ?? '') ? (sp.get('viewport') as ViewportBucket) : 'desktop';
  return NextResponse.json({ result: await heatmapData(project, { path, from, to: now, bucket }) });
}
