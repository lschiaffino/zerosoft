import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';
import { getRobotRow, getRobotWorkspaceConfig } from '@/lib/robots';
import { clearDataset, listDataset, type DatasetFilter } from '@/lib/robots-dataset';
import { valueToCsv } from '@/lib/robots-csv';
import { canEditRobot, canEditRobots, forbidden, notFound, realUserId, robotViewer, unauthorized } from '@/lib/robots-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILTERS: readonly DatasetFilter[] = ['all', 'active', 'new', 'changed', 'removed'];

/**
 * Tabla acumulada del robot: ?filter=active|new|changed|removed|all, ?q=,
 * ?offset=, ?format=csv (todas las filas que ve quien pide, UTF-8 con BOM).
 * Las filas capturadas con un login solo las ven quien armó el robot y los admins.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const robot = await getRobotRow(user.id, id);
  if (!robot) return notFound();
  const sp = req.nextUrl.searchParams;
  const raw = sp.get('filter') ?? 'active';
  const filter = (FILTERS as readonly string[]).includes(raw) ? (raw as DatasetFilter) : 'active';
  const csv = sp.get('format') === 'csv';
  const res = await listDataset(user.id, id, {
    viewer: robotViewer(user),
    q: sp.get('q') ?? '',
    filter,
    limit: csv ? 5000 : 200,
    offset: Number(sp.get('offset')) || 0,
  });
  if (csv) {
    const body = valueToCsv(res.rows.map((r) => r.data)) ?? '';
    const name = `${robot.name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'robot'}-data.csv`;
    return new NextResponse(`﻿${body}`, {
      headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"` },
    });
  }
  return NextResponse.json(res);
}

/** Vaciar la tabla (las corridas no se tocan). Quien puede editar el robot. */
export async function DELETE(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const row = await getRobotRow(user.id, id);
  if (!row) return canEditRobots(user) ? notFound() : forbidden();
  if (!canEditRobot({ role: user.role, personId: realUserId(user) }, row, await getRobotWorkspaceConfig(user.id))) return forbidden();
  return NextResponse.json({ ok: true, deleted: await clearDataset(user.id, id) });
}
