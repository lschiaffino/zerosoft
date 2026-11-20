// Fixture de tests/unit/api-route-guards.test.ts: un archivo de ruta con un
// handler con guard, otro que llega al guard por una función local y uno sin guard.
import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/session';

async function viewer() {
  return getCurrentUser();
}

export async function GET() {
  const user = await getCurrentUser();
  return user ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}

export const PATCH = async () => ((await viewer()) ? NextResponse.json({ ok: true }) : NextResponse.json({}, { status: 401 }));

export async function DELETE() {
  return NextResponse.json({ deleted: true });
}
