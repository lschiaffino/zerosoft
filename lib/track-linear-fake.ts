/**
 * Linear por API — fake para tests y la demo (TRACK_LINEAR_FAKE=1 con
 * NODE_ENV=test o DEMO_MODE; en producción normal nunca).
 *
 * Responde como la API GraphQL de Linear: parsea la query, la valida contra
 * los tipos del schema público (lib/fixtures/linear-schema.json, sacado de
 * schema.graphql de Linear) y devuelve "Cannot query field ..." si pide algo
 * que no existe; pagina con first/after y endCursor; `first` mayor a 250 es
 * un error, como en Linear; una key desconocida da AUTHENTICATION_ERROR.
 *
 * Keys:
 * - lin_api_fake: workspace chico con todo (2 teams con workflows propios,
 *   triage, 2 projects con milestones y updates, una initiative, cycles, sub-issues,
 *   relaciones, adjuntos, comentarios con hilo, archivados, personas que no
 *   son miembros).
 * - lin_api_fake_v2: el mismo workspace un día después (un issue renombrado
 *   y movido de estado, un comentario y un issue nuevos) para probar que
 *   reimportar actualiza sin duplicar.
 * - lin_api_fake_big: además 2.500 issues generados (velocidad con muchos).
 * - lin_api_fake_sync: el workspace de lin_api_fake para la sincronización en
 *   vivo (lib/track-linear-sync.ts), con su propio estado.
 *
 * Mutations (issueCreate, issueUpdate, commentCreate, webhookCreate,
 * webhookDelete): cambian un estado en memoria por key (resetLinearFake lo
 * limpia) y, como Linear, mandan un webhook firmado a cada webhook creado con
 * webhookCreate, después de responder (también por los cambios que hace la
 * sincronización: así se prueba que no rebota). Los tests pueden recibirlos en
 * proceso con setLinearFakeWebhookSink.
 */
import { createHmac } from 'crypto';
import { parseOperation, validateOperation, type GqlField, type GqlSchemaMap } from './graphql-lite';
import schemaJson from './fixtures/linear-schema.json';

const SCHEMA = schemaJson as unknown as GqlSchemaMap;

export const LINEAR_FAKE_TOKENS = ['lin_api_fake', 'lin_api_fake_v2', 'lin_api_fake_big', 'lin_api_fake_sync'] as const;

export function linearFakeAllowed(): boolean {
  if (process.env.TRACK_LINEAR_FAKE !== '1') return false;
  if (process.env.NODE_ENV === 'test') return true;
  // Demo en producción solo con el permiso explícito de la demo (como el middleware) y nunca en Vercel.
  return process.env.DEMO_MODE === 'true' && (process.env.NODE_ENV !== 'production' || process.env.DEMO_MODE_ALLOW_PRODUCTION === 'true') && !process.env.VERCEL;
}

/** Toda key lin_api_fake… va al fake; las que no están en la lista dan AUTHENTICATION_ERROR (key equivocada). */
export function isLinearFakeToken(token: string): boolean {
  return token.startsWith('lin_api_fake');
}

type Node = Record<string, unknown>;

const DAY = 86_400_000;
const day = (offset: number, base: number) => new Date(base + offset * DAY).toISOString();
const dateOnly = (offset: number, base: number) => day(offset, base).slice(0, 10);

/** Workspace falso. `base` es medianoche UTC de hoy: los cycles quedan alrededor de hoy. */
export function linearFakeWorkspace(token: string, now = Date.now()): Record<string, Node[] | Node> {
  const base = Math.floor(now / DAY) * DAY;
  const v2 = token === 'lin_api_fake_v2';
  const users = {
    // La persona que importa (el usuario demo; en los tests unitarios, otro email).
    ana: { id: 'u-ana', name: 'Demo User', displayName: 'demo', email: process.env.TRACK_LINEAR_FAKE_EMAIL || 'demo@zerosoft.ai', active: true, guest: false, admin: true },
    bo: { id: 'u-bo', name: 'Bo Lindqvist', displayName: 'bo', email: 'bo@acme-linear.test', active: true, guest: false, admin: false },
    cy: { id: 'u-cy', name: 'Cy Okafor', displayName: 'cy', email: 'cy@acme-linear.test', active: false, guest: true, admin: false },
  };

  const engStates = [
    { id: 's-tri', name: 'Triage', type: 'triage', color: '#FC7840', position: 0 },
    { id: 's-bkl', name: 'Backlog', type: 'backlog', color: '#bec2c8', position: 1 },
    { id: 's-todo', name: 'Todo', type: 'unstarted', color: '#e2e2e2', position: 2 },
    { id: 's-prog', name: 'In Progress', type: 'started', color: '#f2c94c', position: 3 },
    { id: 's-rev', name: 'In Review', type: 'started', color: '#0f783c', position: 4 },
    { id: 's-done', name: 'Done', type: 'completed', color: '#5e6ad2', position: 5 },
    { id: 's-canc', name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 6 },
    { id: 's-dup', name: 'Duplicate', type: 'canceled', color: '#95a2b3', position: 7 },
  ];
  const desStates = [
    { id: 'd-bkl', name: 'Ideas', type: 'backlog', color: '#bec2c8', position: 0 },
    { id: 'd-todo', name: 'Ready', type: 'unstarted', color: '#e2e2e2', position: 1 },
    { id: 'd-prog', name: 'Designing', type: 'started', color: '#f2c94c', position: 2 },
    { id: 'd-done', name: 'Shipped', type: 'completed', color: '#5e6ad2', position: 3 },
    { id: 'd-canc', name: 'Canceled', type: 'canceled', color: '#95a2b3', position: 4 },
  ];
  const eng = { id: 't-eng', key: 'ENG', name: 'Engineering', description: 'Product engineering', color: '#5e6ad2', private: false, triageEnabled: true, cyclesEnabled: true, states: { nodes: engStates } };
  const des = { id: 't-des', key: 'DES', name: 'Design', description: '', color: '#f2994a', private: false, triageEnabled: false, cyclesEnabled: false, states: { nodes: desStates } };
  const teamRef = (t: typeof eng | typeof des) => ({ id: t.id, key: t.key, name: t.name });

  const cycles = [
    { id: 'c-41', number: 41, name: null, startsAt: day(-21, base), endsAt: day(-7, base), team: teamRef(eng) },
    { id: 'c-42', number: 42, name: 'Polish sprint', startsAt: day(-7, base), endsAt: day(7, base), team: teamRef(eng) },
    { id: 'c-43', number: 43, name: null, startsAt: day(7, base), endsAt: day(21, base), team: teamRef(eng) },
  ];

  const milestones = [
    { id: 'pm-beta', name: 'Beta', description: 'Invite-only beta', targetDate: dateOnly(10, base), sortOrder: 1 },
    { id: 'pm-ga', name: 'GA', description: '', targetDate: dateOnly(40, base), sortOrder: 2 },
  ];
  const projects = [
    {
      id: 'p-mobile',
      name: 'Mobile app v2',
      description: 'Rebuild the mobile app on the new API',
      content: '## Goals\n\n- Offline mode\n- Faster sync\n\n> Ship to beta before the conference.',
      icon: 'Mobile',
      color: '#4cb782',
      priority: 2,
      startDate: dateOnly(-30, base),
      targetDate: dateOnly(40, base),
      createdAt: day(-35, base),
      updatedAt: day(-2, base),
      status: { type: 'started', name: 'In Progress' },
      lead: users.ana,
      members: { nodes: [users.ana, users.bo] },
      teams: { nodes: [teamRef(eng), teamRef(des)] },
      projectMilestones: { nodes: milestones },
      projectUpdates: {
        nodes: [
          { id: 'pu-2', body: 'Sync is slower than planned. Moving GA a week.', health: 'atRisk', createdAt: day(-2, base), user: users.ana },
          { id: 'pu-1', body: 'Kickoff done, API contract agreed.', health: 'onTrack', createdAt: day(-16, base), user: users.bo },
        ],
      },
    },
    {
      id: 'p-billing',
      name: 'Billing revamp',
      description: '',
      content: null,
      icon: null,
      color: '#bec2c8',
      priority: 0,
      startDate: null,
      targetDate: null,
      createdAt: day(-10, base),
      updatedAt: day(-10, base),
      status: { type: 'planned', name: 'Planned' },
      lead: null,
      members: { nodes: [] },
      teams: { nodes: [teamRef(eng)] },
      projectMilestones: { nodes: [] },
      projectUpdates: { nodes: [] },
    },
  ];

  const label = (name: string, color: string) => ({ id: `l-${name.toLowerCase()}`, name, color });
  const bug = label('Bug', '#eb5757');
  const feature = label('Feature', '#bb87fc');
  const perf = label('Performance', '#4ea7fc');

  type IssueSpec = {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: (typeof engStates)[number] | (typeof desStates)[number];
    team: typeof eng | typeof des;
    priority?: number;
    estimate?: number | null;
    assignee?: (typeof users)[keyof typeof users] | null;
    creator?: (typeof users)[keyof typeof users];
    project?: (typeof projects)[number] | null;
    milestone?: (typeof milestones)[number] | null;
    cycle?: (typeof cycles)[number] | null;
    parent?: string | null;
    labels?: Array<{ name: string; color: string }>;
    dueDate?: string | null;
    createdAt: string;
    updatedAt?: string;
    archivedAt?: string | null;
  };
  const S = Object.fromEntries(engStates.map((s) => [s.id, s])) as Record<string, (typeof engStates)[number]>;
  const D = Object.fromEntries(desStates.map((s) => [s.id, s])) as Record<string, (typeof desStates)[number]>;
  const specs: IssueSpec[] = [
    {
      id: 'i-1',
      identifier: 'ENG-1',
      title: v2 ? 'Offline sync for the mobile app (v2)' : 'Offline sync for the mobile app',
      description:
        '## Context\n\nUsers lose edits when the connection drops.\n\n- [x] Spike the queue\n- [ ] Conflict handling\n\n```ts\nqueue.flush()\n```\n\nSee ![diagram](https://uploads.linear.app/fake/diagram.png)',
      state: v2 ? S['s-rev'] : S['s-prog'],
      team: eng,
      priority: 1,
      estimate: 5,
      assignee: users.ana,
      creator: users.bo,
      project: projects[0],
      milestone: milestones[0],
      cycle: cycles[1],
      labels: [feature, perf],
      dueDate: dateOnly(5, base),
      createdAt: day(-20, base),
      updatedAt: v2 ? day(0, base) : day(-1, base),
    },
    { id: 'i-2', identifier: 'ENG-2', title: 'Queue writes while offline', state: S['s-done'], team: eng, priority: 2, estimate: 2, assignee: users.ana, creator: users.ana, project: projects[0], milestone: milestones[0], cycle: cycles[0], parent: 'i-1', createdAt: day(-19, base) },
    { id: 'i-3', identifier: 'ENG-3', title: 'Resolve conflicts on reconnect', state: S['s-todo'], team: eng, priority: 2, estimate: 3, assignee: users.bo, creator: users.ana, project: projects[0], milestone: milestones[1], cycle: cycles[1], parent: 'i-1', createdAt: day(-18, base) },
    { id: 'i-4', identifier: 'ENG-4', title: 'Crash when opening a deleted issue', description: 'Steps:\n1. Delete an issue\n2. Open its link', state: S['s-prog'], team: eng, priority: 1, estimate: 1, assignee: users.cy, creator: users.cy, labels: [bug], cycle: cycles[1], createdAt: day(-12, base) },
    { id: 'i-5', identifier: 'ENG-5', title: 'Crash opening deleted issue from email', state: S['s-dup'], team: eng, priority: 3, labels: [bug], creator: users.bo, createdAt: day(-11, base) },
    { id: 'i-6', identifier: 'ENG-6', title: 'Customer reports slow search', description: 'From the support inbox.', state: S['s-tri'], team: eng, priority: 0, creator: users.bo, createdAt: day(-1, base) },
    { id: 'i-7', identifier: 'ENG-7', title: 'Invoice PDF layout', state: S['s-bkl'], team: eng, priority: 4, estimate: null, project: projects[1], creator: users.ana, createdAt: day(-9, base) },
    { id: 'i-8', identifier: 'ENG-8', title: 'Old migration cleanup', state: S['s-done'], team: eng, priority: 3, estimate: 1, assignee: users.ana, creator: users.ana, cycle: cycles[0], createdAt: day(-200, base), archivedAt: day(-20, base) },
    { id: 'i-9', identifier: 'ENG-9', title: 'Drop the legacy sync endpoint', state: S['s-canc'], team: eng, priority: 3, creator: users.ana, createdAt: day(-15, base) },
    { id: 'i-10', identifier: 'DES-1', title: 'Offline state illustrations', state: D['d-prog'], team: des, priority: 2, estimate: 3, assignee: users.bo, creator: users.ana, project: projects[0], milestone: milestones[0], labels: [feature], createdAt: day(-14, base) },
    { id: 'i-11', identifier: 'DES-2', title: 'Empty states audit', state: D['d-bkl'], team: des, priority: 0, creator: users.bo, createdAt: day(-6, base) },
  ];
  if (v2) {
    specs.push({ id: 'i-12', identifier: 'ENG-10', title: 'Retry failed uploads', state: S['s-todo'], team: eng, priority: 2, estimate: 2, assignee: users.ana, creator: users.ana, project: projects[0], cycle: cycles[1], createdAt: day(0, base) });
  }
  if (token === 'lin_api_fake_big') {
    const states = [S['s-bkl'], S['s-todo'], S['s-prog'], S['s-rev'], S['s-done'], S['s-canc']];
    const people = [users.ana, users.bo, null];
    for (let i = 0; i < 2500; i++) {
      specs.push({
        id: `i-big-${i}`,
        identifier: `ENG-${100 + i}`,
        title: `Generated issue ${i + 1}: ${['Fix', 'Add', 'Improve', 'Remove'][i % 4]} ${['sync', 'search', 'billing', 'onboarding', 'export'][i % 5]}`,
        description: i % 3 === 0 ? `Detail for issue ${i + 1}.` : '',
        state: states[i % states.length],
        team: eng,
        priority: i % 5,
        estimate: i % 4 === 0 ? null : (i % 8) + 1,
        assignee: people[i % 3],
        creator: users.ana,
        project: i % 7 === 0 ? projects[0] : null,
        cycle: i % 2 === 0 ? cycles[i % 3] : null,
        labels: i % 6 === 0 ? [bug] : [],
        createdAt: day(-300 + (i % 290), base),
      });
    }
  }

  const byId = new Map(specs.map((s) => [s.id, s]));
  const issues = specs.map((s) => ({
    id: s.id,
    identifier: s.identifier,
    title: s.title,
    description: s.description ?? null,
    priority: s.priority ?? 0,
    estimate: s.estimate ?? null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt ?? s.createdAt,
    dueDate: s.dueDate ?? null,
    archivedAt: s.archivedAt ?? null,
    state: s.state,
    team: teamRef(s.team),
    project: s.project ? { id: s.project.id, name: s.project.name } : null,
    projectMilestone: s.milestone ? { id: s.milestone.id, name: s.milestone.name } : null,
    cycle: s.cycle ?? null,
    assignee: s.assignee ?? null,
    creator: s.creator ?? users.ana,
    parent: s.parent ? { id: s.parent, identifier: byId.get(s.parent)!.identifier } : null,
    labels: { nodes: s.labels ?? [] },
  }));
  const ref = (id: string) => ({ id, identifier: byId.get(id)!.identifier });

  const comments = [
    { id: 'cm-1', body: 'Started on the queue, PR coming.', createdAt: day(-10, base), updatedAt: day(-10, base), user: users.ana, externalUser: null, issue: ref('i-1'), parent: null },
    { id: 'cm-2', body: 'Can we keep the queue under 5 MB?', createdAt: day(-9, base), updatedAt: day(-9, base), user: users.bo, externalUser: null, issue: ref('i-1'), parent: { id: 'cm-1' } },
    { id: 'cm-3', body: 'Seen this twice today.', createdAt: day(-11, base), updatedAt: day(-11, base), user: users.cy, externalUser: null, issue: ref('i-4'), parent: null },
    { id: 'cm-4', body: 'Reported via Intercom by Acme Corp.', createdAt: day(-1, base), updatedAt: day(-1, base), user: null, externalUser: { name: 'Intercom' }, issue: ref('i-6'), parent: null },
  ];
  if (v2) comments.push({ id: 'cm-5', body: 'Moved to review.', createdAt: day(0, base), updatedAt: day(0, base), user: users.ana, externalUser: null, issue: ref('i-1'), parent: null });

  const attachments = [
    { id: 'at-1', title: 'Offline queue', subtitle: 'Open', url: 'https://github.com/acme/mobile/pull/42', sourceType: 'github', createdAt: day(-8, base), updatedAt: day(-8, base), issue: ref('i-1') },
    { id: 'at-2', title: 'Thread in #mobile', subtitle: 'Slack message', url: 'https://acme.slack.com/archives/C123/p1700000000000100', sourceType: 'slack', createdAt: day(-8, base), updatedAt: day(-8, base), issue: ref('i-1') },
    { id: 'at-3', title: 'Spec', subtitle: null, url: 'https://docs.example.com/offline-spec', sourceType: null, createdAt: day(-7, base), updatedAt: day(-7, base), issue: ref('i-1') },
    { id: 'at-4', title: 'Illustrations', subtitle: null, url: 'https://www.figma.com/file/AbC123/Offline', sourceType: 'figma', createdAt: day(-6, base), updatedAt: day(-6, base), issue: ref('i-10') },
  ];

  const relations = [
    { id: 'r-1', type: 'blocks', issue: ref('i-2'), relatedIssue: ref('i-3') },
    { id: 'r-2', type: 'duplicate', issue: ref('i-5'), relatedIssue: ref('i-4') },
    { id: 'r-3', type: 'related', issue: ref('i-1'), relatedIssue: ref('i-10') },
    { id: 'r-4', type: 'similar', issue: ref('i-4'), relatedIssue: ref('i-6') },
  ];

  return {
    viewer: { id: users.ana.id, email: users.ana.email, name: users.ana.name },
    organization: { id: 'o-acme', name: 'Acme', urlKey: 'acme' },
    users: Object.values(users),
    teams: [eng, des],
    issueLabels: [bug, feature, perf],
    projects,
    cycles,
    issues,
    comments,
    attachments,
    issueRelations: relations,
    documents: [
      {
        id: 'doc-spec',
        title: 'Offline sync spec',
        content: '# Offline sync\n\nWrites queue locally and replay on reconnect.\n\n- Max queue: 5 MB\n- Conflicts: last writer wins',
        icon: null,
        createdAt: day(-25, base),
        updatedAt: v2 ? day(0, base) : day(-5, base),
        project: { id: 'p-mobile' },
      },
    ],
    initiatives: [
      {
        id: 'in-launch',
        name: 'Mobile launch',
        description: 'Everything for the mobile launch',
        content: '## Why\n\nOne launch, two projects.',
        icon: null,
        status: 'Active',
        targetDate: dateOnly(45, base),
        updatedAt: day(-3, base),
        owner: users.ana,
        projects: { nodes: [{ id: 'p-mobile' }, { id: 'p-billing' }] },
      },
    ],
  };
}

/** Recorta un nodo a lo que pidió la query (como un servidor GraphQL). */
function shape(value: unknown, sel: GqlField[]): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((v) => shape(v, sel));
  if (!sel.length || typeof value !== 'object') return value;
  const src = value as Node;
  const out: Node = {};
  for (const f of sel) {
    const v = src[f.name];
    // Conexiones anidadas (labels, states, members...): { nodes } con first.
    if (v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as Node).nodes)) {
      const first = Number(f.args.first ?? 50);
      const nodes = ((v as Node).nodes as unknown[]).slice(0, first);
      out[f.name] = shape({ ...(v as Node), nodes, pageInfo: { hasNextPage: ((v as Node).nodes as unknown[]).length > first, endCursor: null } }, f.selection);
    } else {
      out[f.name] = shape(v, f.selection);
    }
  }
  return out;
}

// PNG de 1x1: lo que devuelve uploads.linear.app en el fake.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

export function fakeLinearUpload(url: string): { buffer: Buffer; contentType: string } | null {
  return url.startsWith('https://uploads.linear.app/fake/') ? { buffer: PNG, contentType: 'image/png' } : null;
}

const encode = (n: number) => Buffer.from(`idx:${n}`).toString('base64');
const decode = (c: unknown) => {
  if (typeof c !== 'string') return 0;
  const m = /^idx:(\d+)$/.exec(Buffer.from(c, 'base64').toString());
  return m ? Number(m[1]) : 0;
};

// ---------- Estado en memoria (mutations) ----------

interface FakeStore {
  /** Cambios de issues existentes, por id. */
  patches: Map<string, Node>;
  created: Node[];
  comments: Node[];
  webhooks: Array<{ id: string; url: string; secret: string; resourceTypes: string[] }>;
  seq: number;
}

type WebhookSink = (delivery: { url: string; body: string; headers: Record<string, string> }) => Promise<void> | void;

const g = globalThis as unknown as { __zsLinearFake?: Map<string, FakeStore>; __zsLinearFakeSink?: WebhookSink | null };
const stores = (g.__zsLinearFake ??= new Map<string, FakeStore>());

function store(token: string): FakeStore {
  let s = stores.get(token);
  if (!s) {
    s = { patches: new Map(), created: [], comments: [], webhooks: [], seq: 0 };
    stores.set(token, s);
  }
  return s;
}

/** Vuelve el fake al workspace de origen (tests). */
export function resetLinearFake(token?: string): void {
  if (token) stores.delete(token);
  else stores.clear();
}

/** Los webhooks del fake van a esta función en vez de a su URL (tests unitarios). */
export function setLinearFakeWebhookSink(sink: WebhookSink | null): void {
  g.__zsLinearFakeSink = sink;
}

/** Workspace con los cambios hechos por mutations. */
function currentWorkspace(token: string): Record<string, Node[] | Node> {
  const ws = linearFakeWorkspace(token);
  const st = stores.get(token);
  if (!st) return ws;
  ws.issues = [...(ws.issues as Node[]).map((i) => (st.patches.has(i.id as string) ? { ...i, ...st.patches.get(i.id as string) } : i)), ...st.created];
  ws.comments = [...(ws.comments as Node[]), ...st.comments];
  return ws;
}

/** Hora de un cambio: siempre después de la anterior (dos cambios en el mismo ms quedan ordenados). */
function stamp(st: FakeStore): string {
  st.seq += 1;
  return new Date(Date.now() + st.seq).toISOString();
}

function allStates(ws: Record<string, Node[] | Node>): Node[] {
  return (ws.teams as Node[]).flatMap((t) => ((t.states as Node).nodes as Node[]));
}

function issueRef(ws: Record<string, Node[] | Node>, id: unknown): Node | null {
  const i = (ws.issues as Node[]).find((x) => x.id === id);
  return i ? { id: i.id, identifier: i.identifier } : null;
}

const FLAT: Record<string, string> = { state: 'stateId', assignee: 'assigneeId', parent: 'parentId', project: 'projectId', projectMilestone: 'projectMilestoneId', labels: 'labelIds' };

/** IssueCreateInput / IssueUpdateInput → campos del nodo. */
function issueFieldsFromInput(ws: Record<string, Node[] | Node>, input: Node): Node {
  const out: Node = {};
  for (const k of ['title', 'description', 'priority', 'estimate', 'dueDate'] as const) if (k in input) out[k] = input[k] ?? null;
  if ('stateId' in input) {
    const st = allStates(ws).find((s) => s.id === input.stateId);
    if (st) out.state = st;
  }
  if ('assigneeId' in input) out.assignee = (ws.users as Node[]).find((u) => u.id === input.assigneeId) ?? null;
  if ('labelIds' in input) {
    const ids = (input.labelIds as string[] | null) ?? [];
    out.labels = { nodes: (ws.issueLabels as Node[]).filter((l) => ids.includes(l.id as string)) };
  }
  if ('parentId' in input) out.parent = input.parentId ? issueRef(ws, input.parentId) : null;
  if ('projectId' in input) {
    const p = (ws.projects as Node[]).find((x) => x.id === input.projectId);
    out.project = p ? { id: p.id, name: p.name } : null;
  }
  if ('projectMilestoneId' in input) {
    const m = (ws.projects as Node[]).flatMap((p) => (p.projectMilestones as Node).nodes as Node[]).find((x) => x.id === input.projectMilestoneId);
    out.projectMilestone = m ? { id: m.id, name: m.name } : null;
  }
  return out;
}

/** Como Linear: data con los ids planos (stateId, teamId…). */
function webhookData(node: Node): Node {
  const ref = (k: string) => ((node[k] as Node | null | undefined)?.id as string | undefined) ?? null;
  return {
    ...node,
    teamId: ref('team'),
    stateId: ref('state'),
    assigneeId: ref('assignee'),
    projectId: ref('project'),
    parentId: ref('parent'),
    issueId: ref('issue'),
    labelIds: ((node.labels as Node | undefined)?.nodes as Node[] | undefined)?.map((l) => l.id) ?? undefined,
  };
}

function deliver(token: string, type: 'Issue' | 'Comment', action: 'create' | 'update', node: Node, updatedFrom?: Node): void {
  const st = stores.get(token);
  if (!st?.webhooks.length) return;
  for (const hook of st.webhooks) {
    if (hook.resourceTypes.length && !hook.resourceTypes.includes(type)) continue;
    const body = JSON.stringify({
      action,
      type,
      data: webhookData(node),
      ...(updatedFrom ? { updatedFrom } : {}),
      url: `https://linear.app/acme/issue/${String(node.identifier ?? '')}`,
      createdAt: new Date().toISOString(),
      organizationId: 'o-acme',
      webhookTimestamp: Date.now(),
      webhookId: hook.id,
    });
    const headers = {
      'content-type': 'application/json',
      'linear-event': type,
      'linear-delivery': crypto.randomUUID(),
      'linear-signature': createHmac('sha256', hook.secret).update(body).digest('hex'),
    };
    // Después de responder la mutation, como Linear.
    setTimeout(() => {
      const sink = g.__zsLinearFakeSink;
      const run = sink ? Promise.resolve(sink({ url: hook.url, body, headers })) : fetch(hook.url, { method: 'POST', headers, body }).then(() => undefined);
      run.catch(() => undefined);
    }, 0);
  }
}

function gqlError(message: string, code = 'INVALID_INPUT') {
  return { status: 400, body: { errors: [{ message, extensions: { code } }] } };
}

type MutationResult = { ok: true; value: Node } | { ok: false; res: { status: number; body: unknown } };

function runMutation(token: string, ws: Record<string, Node[] | Node>, f: GqlField): MutationResult {
  const st = store(token);
  const input = (f.args.input ?? {}) as Node;
  switch (f.name) {
    case 'issueUpdate': {
      const current = (ws.issues as Node[]).find((i) => i.id === f.args.id);
      if (!current) return { ok: false, res: gqlError('Entity not found: Issue') };
      const fields = issueFieldsFromInput(ws, input);
      const updatedFrom: Node = {};
      for (const [k, v] of Object.entries(fields)) {
        if (JSON.stringify(current[k] ?? null) === JSON.stringify(v)) continue;
        if (k === 'labels') updatedFrom.labelIds = (((current.labels as Node)?.nodes as Node[]) ?? []).map((l) => l.id);
        else if (FLAT[k]) updatedFrom[FLAT[k]] = (current[k] as Node | null)?.id ?? null;
        else updatedFrom[k] = current[k] ?? null;
      }
      const updated = { ...current, ...fields, updatedAt: stamp(st) };
      if (st.created.some((c) => c.id === current.id)) st.created = st.created.map((c) => (c.id === current.id ? updated : c));
      else st.patches.set(current.id as string, { ...(st.patches.get(current.id as string) ?? {}), ...fields, updatedAt: updated.updatedAt });
      if (Object.keys(updatedFrom).length) deliver(token, 'Issue', 'update', updated, { ...updatedFrom, updatedAt: current.updatedAt });
      return { ok: true, value: { success: true, lastSyncId: st.seq, issue: updated } };
    }
    case 'issueCreate': {
      const team = (ws.teams as Node[]).find((t) => t.id === input.teamId);
      if (!team) return { ok: false, res: gqlError('Entity not found: Team') };
      if (!input.title) return { ok: false, res: gqlError('title must be a string') };
      const nums = (ws.issues as Node[]).filter((i) => (i.team as Node).id === team.id).map((i) => Number(String(i.identifier).split('-')[1]) || 0);
      const states = ((team.states as Node).nodes as Node[]).slice().sort((a, b) => Number(a.position) - Number(b.position));
      const at = stamp(st);
      const node: Node = {
        id: typeof input.id === 'string' && input.id ? input.id : crypto.randomUUID(),
        identifier: `${team.key}-${Math.max(0, ...nums) + 1}`,
        title: '',
        description: null,
        priority: 0,
        estimate: null,
        createdAt: at,
        updatedAt: at,
        dueDate: null,
        archivedAt: null,
        state: states.find((s) => s.type === 'unstarted') ?? states[0],
        team: { id: team.id, key: team.key, name: team.name },
        project: null,
        projectMilestone: null,
        cycle: null,
        assignee: null,
        creator: ws.viewer,
        parent: null,
        labels: { nodes: [] },
        ...issueFieldsFromInput(ws, input),
      };
      st.created.push(node);
      deliver(token, 'Issue', 'create', node);
      return { ok: true, value: { success: true, lastSyncId: st.seq, issue: node } };
    }
    case 'commentCreate': {
      const issue = issueRef(ws, input.issueId);
      if (!issue) return { ok: false, res: gqlError('Entity not found: Issue') };
      const at = stamp(st);
      const node: Node = {
        id: typeof input.id === 'string' && input.id ? input.id : crypto.randomUUID(),
        body: String(input.body ?? ''),
        createdAt: at,
        updatedAt: at,
        user: ws.viewer,
        externalUser: null,
        issue,
        parent: input.parentId ? { id: input.parentId } : null,
      };
      st.comments.push(node);
      deliver(token, 'Comment', 'create', node);
      return { ok: true, value: { success: true, lastSyncId: st.seq, comment: node } };
    }
    case 'webhookCreate': {
      if (typeof input.url !== 'string' || !/^https?:\/\//.test(input.url)) return { ok: false, res: gqlError('url must be a URL address') };
      const hook = {
        id: `wh-${st.webhooks.length + 1}`,
        url: input.url,
        secret: typeof input.secret === 'string' && input.secret ? input.secret : 'lin_wh_fake',
        resourceTypes: Array.isArray(input.resourceTypes) ? (input.resourceTypes as string[]) : [],
      };
      st.webhooks.push(hook);
      return { ok: true, value: { success: true, lastSyncId: st.seq, webhook: { id: hook.id, url: hook.url, enabled: true, label: input.label ?? null } } };
    }
    case 'webhookDelete': {
      const before = st.webhooks.length;
      st.webhooks = st.webhooks.filter((w) => w.id !== f.args.id);
      return { ok: true, value: { success: before !== st.webhooks.length, lastSyncId: st.seq, entityId: f.args.id } };
    }
    default:
      return { ok: false, res: gqlError(`Unknown mutation ${f.name}`) };
  }
}

/** filter de Linear, lo que usa la sincronización: updatedAt.gt, team.id.in, id.eq. */
function matchesFilter(row: Node, filter: unknown): boolean {
  if (!filter || typeof filter !== 'object') return true;
  const fl = filter as Node;
  const gt = (fl.updatedAt as Node | undefined)?.gt;
  if (typeof gt === 'string' && !(String(row.updatedAt ?? '') > gt)) return false;
  const teamIn = ((fl.team as Node | undefined)?.id as Node | undefined)?.in;
  if (Array.isArray(teamIn) && !teamIn.includes((row.team as Node | undefined)?.id)) return false;
  const idEq = (fl.id as Node | undefined)?.eq;
  if (typeof idEq === 'string' && row.id !== idEq) return false;
  return true;
}

export function fakeLinearGraphql(token: string, query: string, variables: Record<string, unknown>): { status: number; body: unknown } {
  if (!(LINEAR_FAKE_TOKENS as readonly string[]).includes(token)) {
    return { status: 400, body: { errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] } };
  }
  let op;
  try {
    op = parseOperation(query, variables);
  } catch (err) {
    return { status: 400, body: { errors: [{ message: `Syntax Error: ${err instanceof Error ? err.message : 'invalid'}`, extensions: { code: 'GRAPHQL_PARSE_FAILED' } }] } };
  }
  const errors = validateOperation(op, SCHEMA);
  if (errors.length) return { status: 400, body: { errors: errors.map((message) => ({ message, extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } })) } };

  const ws = currentWorkspace(token);
  const data: Node = {};
  if (op.kind === 'mutation') {
    for (const f of op.selection) {
      const res = runMutation(token, ws, f);
      if (!res.ok) return res.res;
      data[f.name] = shape(res.value, f.selection);
    }
    return { status: 200, body: { data } };
  }
  for (const f of op.selection) {
    if (f.name === 'issue') {
      const row = (ws.issues as Node[]).find((i) => i.id === f.args.id || i.identifier === f.args.id);
      if (!row) return gqlError('Entity not found: Issue');
      data.issue = shape(row, f.selection);
      continue;
    }
    const src = ws[f.name];
    if (!Array.isArray(src)) {
      data[f.name] = shape(src, f.selection);
      continue;
    }
    const first = Number(f.args.first ?? 50);
    if (first > 250) return { status: 400, body: { errors: [{ message: 'first must be <= 250', extensions: { code: 'INVALID_INPUT' } }] } };
    let rows = src;
    if (f.name === 'issues' && f.args.includeArchived !== true) rows = rows.filter((r) => !(r as Node).archivedAt);
    if (f.args.filter) rows = rows.filter((r) => matchesFilter(r as Node, f.args.filter));
    const start = decode(f.args.after);
    const nodes = rows.slice(start, start + first);
    const end = start + nodes.length;
    data[f.name] = shape({ nodes, pageInfo: { hasNextPage: end < rows.length, endCursor: nodes.length ? encode(end) : null } }, f.selection);
  }
  return { status: 200, body: { data } };
}
