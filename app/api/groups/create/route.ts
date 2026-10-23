import { NextResponse } from 'next/server';
import { createGroups, parseGroupsCsv, type CreateGroupRow } from '@/lib/groups';
import { parseCsv } from '@/lib/csv-parse';
import { groupsError, groupsSession, handleGroupsError, readJson, str, strArr } from '@/lib/groups-http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Crea grupos desde un número. Uno: { numberId, name, phones }. Varios:
 * { numberId, csv } (name, participants, description, admins) o
 * { numberId, rows }. Con { preview: true } solo valida el CSV.
 */
export async function POST(req: Request) {
  const s = await groupsSession({ write: true });
  if (s instanceof NextResponse) return s;
  const b = await readJson(req);
  const numberId = str(b.numberId, 100) ?? '';
  let rows: CreateGroupRow[] = [];
  let errors: Array<{ line: number; error: string }> = [];
  if (typeof b.csv === 'string') {
    const parsed = parseGroupsCsv(parseCsv(b.csv.slice(0, 500_000)));
    rows = parsed.rows;
    errors = parsed.errors;
  } else if (Array.isArray(b.rows)) {
    rows = (b.rows as unknown[]).slice(0, 100).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { name: str(o.name, 100) ?? '', phones: strArr(o.phones, 1000), description: str(o.description, 2000), admins: strArr(o.admins, 100) };
    });
  } else {
    rows = [
      {
        name: str(b.name, 100) ?? '',
        phones: strArr(b.phones, 1000),
        description: str(b.description, 2000),
        labelIds: strArr(b.labelIds, 20),
        crmCompanyId: str(b.crmCompanyId, 100) || null,
      },
    ];
  }
  if (b.preview === true) return NextResponse.json({ rows, errors });
  if (!numberId) return groupsError(400, 'invalid_number');
  try {
    const results = await createGroups(s.ws, numberId, rows);
    return NextResponse.json({ results, errors }, { status: 201 });
  } catch (err) {
    return handleGroupsError(err);
  }
}
