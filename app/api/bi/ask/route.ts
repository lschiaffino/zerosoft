import type { NextRequest } from 'next/server';
import { withViewer, str } from '@/lib/bi/http';
import { askSql } from '@/lib/bi/ai';
import { sourceSchema } from '@/lib/bi/run';
import { databaseConfig, BiStoreError } from '@/lib/bi/store';
import { ZS_SOURCE } from '@/lib/bi/types';

export const dynamic = 'force-dynamic';

/** Pregunta en lenguaje natural → SQL (no se corre acá: la app lo muestra primero). Body: { question, source, locale } */
export async function POST(req: NextRequest) {
  return withViewer(req, 'read', async (viewer, body) => {
    const question = (str(body.question) ?? '').trim();
    if (!question || question.length > 1000) throw new BiStoreError('question_required');
    const source = str(body.source) || ZS_SOURCE;
    const schema = await sourceSchema(viewer, source);
    const dialect = source === ZS_SOURCE ? 'sqlite' : ((await databaseConfig(viewer.workspaceId, source))?.engine ?? 'postgres');
    const locale = ['en', 'es', 'pt'].includes(str(body.locale) ?? '') ? str(body.locale)! : 'en';
    return { answer: await askSql({ workspaceId: viewer.workspaceId, question, schema, dialect, locale }) };
  });
}
