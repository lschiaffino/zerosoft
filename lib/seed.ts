/**
 * Seed de cuenta nueva: datos de ejemplo para que ningún producto arranque
 * vacío. Corre una sola vez por usuario (flag users.seeded_at).
 */
import { getDb } from './db';
import {
  createCompany,
  createContact,
  createDeal,
  createPipeline,
  createStage,
  updateStage,
} from './crm';
import { createDocPage } from './docs';
import { createProject, createIssue } from './track-data';
import { createEventType, getOrCreateCalendarUser, setAvailability } from './calendar';

async function seedCrm(userId: string) {
  // Idempotente: si el workspace ya tiene pipelines (p. ej. `npm run seed`
  // cargó el dataset demo) no creamos otro "Sales" duplicado.
  const existing = await getDb()
    .prepare('SELECT 1 AS x FROM crm_pipelines WHERE user_id = ? LIMIT 1')
    .get(userId);
  if (existing) return;
  const pipeline = await createPipeline(userId, 'Sales');
  const lead = await createStage(userId, pipeline.id, { name: 'Lead', probability: 10 });
  const contacted = await createStage(userId, pipeline.id, { name: 'Contacted', probability: 30 });
  const demo = await createStage(userId, pipeline.id, { name: 'Demo', probability: 60 });
  const won = await createStage(userId, pipeline.id, { name: 'Won', probability: 100 });
  const lost = await createStage(userId, pipeline.id, { name: 'Lost', probability: 0 });
  if (won) await updateStage(userId, won.id, { isWon: true });
  if (lost) await updateStage(userId, lost.id, { isLost: true });

  const company = await createCompany(userId, {
    name: 'Acme Corp',
    domain: 'acme.com',
    industry: 'Software',
    employees: 42,
    website: 'https://acme.com',
    city: 'San Francisco',
    country: 'United States',
    lifecycleStage: 'customer',
  });

  const contact = await createContact(userId, {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@acme.com',
    phone: '+1 415 555 0132',
    jobTitle: 'Head of Operations',
    lifecycleStage: 'customer',
    leadStatus: 'open',
    source: 'referral',
    companyId: company.id,
  });

  if (lead) {
    await createDeal(userId, {
      pipelineId: pipeline.id,
      stageId: demo?.id ?? lead.id,
      name: 'Acme Corp — Team plan',
      amount: 1200,
      currency: 'USD',
      priority: 'high',
      source: 'referral',
      description: 'Demo deal created automatically. Drag it across stages on the board.',
      contactIds: [contact.id],
    });
  }
}

async function seedDocs(userId: string) {
  await createDocPage(userId, {
    title: 'Getting started',
    icon: '0️⃣',
    content: [
      { id: crypto.randomUUID(), type: 'heading', level: 1, content: 'Welcome to Docs' },
      {
        id: crypto.randomUUID(),
        type: 'paragraph',
        content: 'This is your first page. Type / to insert blocks, [[ to link pages.',
      },
      { id: crypto.randomUUID(), type: 'todo', content: 'Create your first real page', checked: false },
    ],
  });
}

type SeedLocale = 'en' | 'es' | 'pt';

/**
 * Idioma de la request que dispara el seed (header de next-intl, cookie o
 * Accept-Language). Fuera de una request (scripts) queda en inglés.
 */
async function requestLocale(): Promise<SeedLocale> {
  const pick = (v: string | null | undefined): SeedLocale | null => {
    const l = (v ?? '').slice(0, 2).toLowerCase();
    return l === 'es' || l === 'pt' || l === 'en' ? l : null;
  };
  try {
    const { cookies, headers } = await import('next/headers');
    const h = await headers();
    return (
      pick(h.get('x-next-intl-locale')) ??
      pick((await cookies()).get('NEXT_LOCALE')?.value) ??
      pick(h.get('accept-language')) ??
      'en'
    );
  } catch {
    return 'en';
  }
}

const TRACK_SEED: Record<SeedLocale, { name: string; description: string; issues: [string, 'high' | 'medium' | 'low'][] }> = {
  en: {
    name: 'Launch',
    description: 'Sample project. Switch views, open an issue, drag it on the board.',
    issues: [
      ['Design the landing page', 'high'],
      ['Set up CI and deploys', 'medium'],
      ['Write the announcement post', 'low'],
    ],
  },
  es: {
    name: 'Lanzamiento',
    description: 'Proyecto de ejemplo. Cambiá de vista, abrí un issue, arrastralo en el tablero.',
    issues: [
      ['Diseñar la landing', 'high'],
      ['Configurar CI y deploys', 'medium'],
      ['Escribir el post del anuncio', 'low'],
    ],
  },
  pt: {
    name: 'Lançamento',
    description: 'Projeto de exemplo. Troque de visualização, abra um issue, arraste no quadro.',
    issues: [
      ['Desenhar a landing', 'high'],
      ['Configurar CI e deploys', 'medium'],
      ['Escrever o post de anúncio', 'low'],
    ],
  },
};

async function seedTrack(userId: string) {
  const copy = TRACK_SEED[await requestLocale()];
  const project = await createProject(userId, null, { name: copy.name, description: copy.description });
  for (const [title, priority] of copy.issues) {
    await createIssue(project.id, userId, { title, priority, description: [] });
  }
}

async function seedCalendar(userId: string) {
  await getOrCreateCalendarUser(userId);
  const eventType = await createEventType(userId, {
    slug: '30min',
    title: '30 min meeting',
    durationMin: 30,
    location: 'https://meet.google.com/new',
    description: 'Quick intro call.',
    active: true,
  });
  // Disponibilidad: lunes a viernes 9:00–17:00.
  await setAvailability(eventType.id, {
    rules: [1, 2, 3, 4, 5].map((dayOfWeek) => ({
      dayOfWeek,
      startTime: '09:00',
      endTime: '17:00',
    })),
  });
}

/**
 * Siembra datos demo si el usuario todavía no fue seedeado.
 * Nunca lanza: un fallo de seed no puede romper el login.
 */
export async function seedUserIfNeeded(userId: string): Promise<void> {
  try {
    // Reclamo atómico: solo una request siembra, y nunca dos veces aunque un
    // paso falle (antes un fallo dejaba seeded_at NULL y se re-sembraba el CRM
    // y Docs en cada login).
    const claim = await getDb()
      .prepare('UPDATE users SET seeded_at = ? WHERE id = ? AND seeded_at IS NULL')
      .run(new Date().toISOString(), userId);
    if (claim.changes === 0) return;
  } catch {
    return;
  }

  // Cada producto es independiente: si uno falla, los demás igual se siembran.
  for (const [name, step] of [
    ['crm', seedCrm],
    ['docs', seedDocs],
    ['track', seedTrack],
    ['calendar', seedCalendar],
  ] as const) {
    try {
      await step(userId);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[seed:${name}] user=${userId}`, err);
    }
  }
}
