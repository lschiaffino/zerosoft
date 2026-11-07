import { NextRequest } from 'next/server';
import { handle, need, readJson } from '@/lib/books-http';
import { createRule, listRules, type RuleInput } from '@/lib/books-bankrules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return handle(async ({ actor }) => {
    need(actor, 'banking.read');
    return { rules: await listRules(actor.ws) };
  });
}

export async function POST(req: NextRequest) {
  return handle(async ({ actor }) => ({ rule: await createRule(actor, (await readJson(req)) as RuleInput) }), 201);
}
