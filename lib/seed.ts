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
import { seedLocale as requestLocale, type SeedLocale } from './seed-locale';

const CRM_SEED: Record<SeedLocale, { pipeline: string; stages: [string, string, string, string, string]; jobTitle: string; deal: string; description: string; country: string }> = {
  en: { pipeline: 'Sales', stages: ['Lead', 'Contacted', 'Demo', 'Won', 'Lost'], jobTitle: 'Head of Operations', deal: 'Acme Corp: Team plan', description: 'Demo deal created automatically. Drag it across stages on the board.', country: 'United States' },
  es: { pipeline: 'Ventas', stages: ['Lead', 'Contactado', 'Demo', 'Ganado', 'Perdido'], jobTitle: 'Responsable de operaciones', deal: 'Acme Corp: plan Team', description: 'Deal de ejemplo creado automáticamente. Arrastralo entre etapas en el tablero.', country: 'Estados Unidos' },
  pt: { pipeline: 'Vendas', stages: ['Lead', 'Contatado', 'Demo', 'Ganho', 'Perdido'], jobTitle: 'Responsável de operações', deal: 'Acme Corp: plano Team', description: 'Deal de exemplo criado automaticamente. Arraste entre as etapas no quadro.', country: 'Estados Unidos' },
};

async function seedCrm(userId: string) {
  // Idempotente: si el workspace ya tiene pipelines (p. ej. `npm run seed`
  // cargó el dataset demo) no creamos otro "Sales" duplicado.
  const existing = await getDb()
    .prepare('SELECT 1 AS x FROM crm_pipelines WHERE user_id = ? LIMIT 1')
    .get(userId);
  if (existing) return;
  const copy = CRM_SEED[await requestLocale()];
  const pipeline = await createPipeline(userId, copy.pipeline);
  const lead = await createStage(userId, pipeline.id, { name: copy.stages[0], probability: 10 });
  const contacted = await createStage(userId, pipeline.id, { name: copy.stages[1], probability: 30 });
  const demo = await createStage(userId, pipeline.id, { name: copy.stages[2], probability: 60 });
  const won = await createStage(userId, pipeline.id, { name: copy.stages[3], probability: 100 });
  const lost = await createStage(userId, pipeline.id, { name: copy.stages[4], probability: 0 });
  if (won) await updateStage(userId, won.id, { isWon: true });
  if (lost) await updateStage(userId, lost.id, { isLost: true });

  const company = await createCompany(userId, {
    name: 'Acme Corp',
    domain: 'acme.com',
    industry: 'Software',
    employees: 42,
    website: 'https://acme.com',
    city: 'San Francisco',
    country: copy.country,
    lifecycleStage: 'customer',
  });

  const contact = await createContact(userId, {
    firstName: 'John',
    lastName: 'Doe',
    email: 'john.doe@acme.com',
    phone: '+1 415 555 0132',
    jobTitle: copy.jobTitle,
    lifecycleStage: 'customer',
    leadStatus: 'open',
    source: 'referral',
    companyId: company.id,
  });

  if (lead) {
    await createDeal(userId, {
      pipelineId: pipeline.id,
      stageId: demo?.id ?? lead.id,
      name: copy.deal,
      amount: 1200,
      currency: 'USD',
      priority: 'high',
      source: 'referral',
      description: copy.description,
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
  const locale = await requestLocale();
  const copy = TRACK_SEED[locale];
  const project = await createProject(userId, null, { name: copy.name, description: copy.description }, { locale });
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
