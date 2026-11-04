/**
 * Groups: datos de ejemplo. "Probar con datos de ejemplo" carga un número de
 * ejemplo (proveedor `sample`, nunca sale a la red) con chats y grupos,
 * mensajes con media, una encuesta, notas internas, etiquetas, un ticket, una
 * tarea, un envío programado y un chat esperando respuesta.
 *
 * Todo cuelga del número de ejemplo: borrarlo se lleva chats, mensajes,
 * miembros y envíos en cascada. Lo que no cuelga (tickets, tareas, avisos,
 * auditoría y las etiquetas que creamos) se borra a mano en clearSampleData,
 * sin tocar nada real. No se disparan eventos ni webhooks al cargar.
 */
import { randomBytes, randomUUID } from 'crypto';
import { getDb } from './db';
import { seal } from './secret-box';
import { GroupsError, getNumberRow, listPeople, readConfig, toNumberDto, type NumberDto, type NumberRow } from './groups';
import { SAMPLE_PHONE } from './groups-provider-sample';
import { pollPreview } from './groups-polls';

type Locale = 'es' | 'en' | 'pt';

interface SampleMsg {
  /** Minutos atrás. */
  ago: number;
  dir: 'in' | 'out' | 'note';
  from?: number;
  body: string;
  /** `url` de un archivo de public/groups-sample (o la imagen de abajo si `image`). */
  media?: { type: string; name: string; image?: boolean; url?: string };
  poll?: { question: string; options: string[]; votes: number[][] };
}

interface SampleChat {
  key: string;
  kind: 'dm' | 'group';
  name: string;
  /** Integrantes (el primero en un 1:1 es la otra persona). */
  people: Array<{ name: string; phone: string }>;
  messages: SampleMsg[];
  labels?: string[];
  assigned?: boolean;
  closed?: boolean;
  pinned?: boolean;
  awaiting?: boolean;
  unread?: number;
  announce?: boolean;
  description?: string;
}

const PEOPLE = {
  lucia: { name: 'Lucía Fernández', phone: '5491100001201' },
  martin: { name: 'Martín Acosta', phone: '5491100001202' },
  carla: { name: 'Carla Gómez', phone: '5491100001203' },
  diego: { name: 'Diego Ramírez', phone: '5491100001204' },
  sofia: { name: 'Sofía Méndez', phone: '5491100001205' },
  pablo: { name: 'Pablo Ortiz', phone: '5491100001206' },
  valen: { name: 'Valentina Ruiz', phone: '5491100001207' },
  joaco: { name: 'Joaquín Torres', phone: '5491100001208' },
  ana: { name: 'Ana Castro', phone: '5491100001209' },
  bruno: { name: 'Bruno Silva', phone: '5491100001210' },
  elena: { name: 'Elena Duarte', phone: '5491100001211' },
  tomas: { name: 'Tomás Rey', phone: '5491100001212' },
  marta: { name: 'Marta Ibáñez', phone: '5491100001213' },
  nico: { name: 'Nicolás Paz', phone: '5491100001214' },
};

/** Una captura chica de un panel (SVG en data URL: se ve sin pedir nada a la red). */
const PANEL_IMG =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="#f4f4f2"/><rect x="16" y="16" width="288" height="28" fill="#ffffff" stroke="#d9d9d4"/><rect x="24" y="26" width="90" height="8" fill="#9a9a94"/><rect x="16" y="56" width="138" height="128" fill="#ffffff" stroke="#d9d9d4"/><rect x="166" y="56" width="138" height="128" fill="#ffffff" stroke="#d9d9d4"/><rect x="30" y="150" width="16" height="22" fill="#3f7d58"/><rect x="54" y="132" width="16" height="40" fill="#3f7d58"/><rect x="78" y="112" width="16" height="60" fill="#3f7d58"/><rect x="102" y="92" width="16" height="80" fill="#3f7d58"/><rect x="180" y="72" width="100" height="8" fill="#9a9a94"/><rect x="180" y="92" width="80" height="8" fill="#c9c9c3"/><rect x="180" y="112" width="92" height="8" fill="#c9c9c3"/><rect x="180" y="132" width="64" height="8" fill="#c9c9c3"/></svg>',
  ).toString('base64');

const T: Record<Locale, Record<string, string>> = {
  es: {
    number: 'Número de ejemplo',
    lSupport: 'Soporte',
    lSales: 'Ventas',
    lOnboarding: 'Onboarding',
    lVip: 'VIP',
    lucia1: 'Hola! Hice el pedido #4821 ayer y todavía no me llegó el mail de confirmación. ¿Me ayudan?',
    lucia2: 'Lo pagué con tarjeta, por si sirve.',
    luciaTicket: 'Pedido #4821 sin mail de confirmación',
    acme: 'Acme · Implementación',
    acmeDesc: 'Puesta en marcha de Acme. Dudas, avances y archivos.',
    acme1: 'Buen día! Ya subimos el CSV con los 300 contactos.',
    acme2: 'Gracias, Martín. Lo revisamos hoy y les confirmamos.',
    acme3: 'Así nos quedó el panel con los primeros datos.',
    acmeNote: '{me} ojo que el CSV tiene teléfonos sin código de país. Lo arreglamos antes de importar.',
    acme4: '¿Para cuándo podemos tener la capacitación del equipo?',
    dist: 'Distribuidores zona norte',
    dist1: 'Buenas a todos. Armamos una capacitación sobre el nuevo catálogo.',
    distPoll: '¿Qué día prefieren para la capacitación?',
    o1: 'Martes 10 h',
    o2: 'Jueves 10 h',
    o3: 'Viernes 15 h',
    dist2: 'Jueves me queda perfecto.',
    diego1: 'Hola, ¿tienen plan anual? Somos 12 personas.',
    diego2: 'Sí, el anual tiene dos meses de descuento. Te armo la propuesta.',
    diego3: 'Buenísimo, gracias.',
    diegoNote: 'Viene de la feria. Le interesa también el módulo de tickets.',
    diegoTask: 'Mandar la propuesta anual a Diego',
    sofia1: 'No puedo entrar a mi cuenta, me dice que la clave es incorrecta.',
    sofia2: 'Te mandamos un link para crear una clave nueva. Avisanos si llega.',
    sofia3: 'Listo, ya pude entrar. Gracias!',
    sofia4: 'Genial. Cualquier cosa nos escribís por acá.',
    logi: 'Logística · Pedidos semanales',
    logi1: 'Mañana el camión sale a las 7. Confirmen pedidos antes de las 18.',
    logi2: 'Confirmado lo nuestro: 40 cajas.',
    logi3: 'Nosotros sumamos 12 más a lo de la semana pasada.',
    pablo1: '¿Me pueden mandar la factura de octubre?',
    pablo2: 'Es para la rendición de mañana.',
    comm: 'Comunidad de clientes',
    commDesc: 'Novedades del producto. Solo escriben los admins.',
    comm1: 'Nueva función: respuestas rápidas. Escriban / en el chat para usarlas.',
    comm2: 'El jueves hay mantenimiento de 22 a 23 h. No se pierde nada.',
    valen1: 'Te dejo un audio con el detalle del cambio de dirección.',
    valen2: 'Recibido, Valentina. Lo cambiamos y te confirmo.',
    prov: 'Proveedor · Packaging',
    prov1: 'Les paso la cotización actualizada de las cajas.',
    prov2: 'Gracias. ¿El precio incluye el envío?',
    prov3: 'Sí, a CABA y GBA.',
    joaco1: '¿Me pueden llamar hoy a las 15? Quiero ver lo de la integración.',
    joaco2: 'Dale, te llamo a las 15.',
    ventas: 'Equipo comercial · Leads',
    ventas1: 'Entraron 8 leads nuevos del formulario. Los repartimos?',
    ventas2: 'Yo tomo los de Córdoba.',
    broadcastName: 'Recordatorio de la capacitación',
    broadcast: 'Recordatorio: la capacitación del nuevo catálogo es el jueves a las 10 h. ¡Los esperamos!',
    voice: 'Nota de voz.wav',
    quote: 'Cotizacion-cajas.pdf',
  },
  en: {
    number: 'Sample number',
    lSupport: 'Support',
    lSales: 'Sales',
    lOnboarding: 'Onboarding',
    lVip: 'VIP',
    lucia1: 'Hi! I placed order #4821 yesterday and never got the confirmation email. Can you help?',
    lucia2: 'I paid by card, in case that helps.',
    luciaTicket: 'Order #4821 missing confirmation email',
    acme: 'Acme · Rollout',
    acmeDesc: 'Acme rollout. Questions, progress and files.',
    acme1: 'Morning! We uploaded the CSV with the 300 contacts.',
    acme2: 'Thanks, Martín. We will review it today and get back to you.',
    acme3: 'Here is the dashboard with the first data.',
    acmeNote: '{me} heads up, the CSV has phone numbers without a country code. Let us fix that before importing.',
    acme4: 'When can we schedule the team training?',
    dist: 'North region distributors',
    dist1: 'Hi all. We are putting together a training on the new catalog.',
    distPoll: 'Which day works best for the training?',
    o1: 'Tuesday 10 am',
    o2: 'Thursday 10 am',
    o3: 'Friday 3 pm',
    dist2: 'Thursday works for me.',
    diego1: 'Hi, do you have an annual plan? We are 12 people.',
    diego2: 'Yes, the annual plan comes with two months off. I will put the proposal together.',
    diego3: 'Great, thanks.',
    diegoNote: 'Came from the trade show. Also interested in tickets.',
    diegoTask: 'Send the annual proposal to Diego',
    sofia1: 'I cannot log in, it says my password is wrong.',
    sofia2: 'We sent you a link to set a new password. Let us know if it arrives.',
    sofia3: 'Done, I am in. Thanks!',
    sofia4: 'Great. Write to us here any time.',
    logi: 'Logistics · Weekly orders',
    logi1: 'The truck leaves tomorrow at 7. Please confirm orders before 6 pm.',
    logi2: 'Ours is confirmed: 40 boxes.',
    logi3: 'We are adding 12 more to last week.',
    pablo1: 'Could you send me the October invoice?',
    pablo2: 'I need it for tomorrow’s expense report.',
    comm: 'Customer community',
    commDesc: 'Product news. Only admins post.',
    comm1: 'New: quick replies. Type / in the chat to use them.',
    comm2: 'Maintenance on Thursday from 10 to 11 pm. Nothing gets lost.',
    valen1: 'Here is a voice note with the details of the address change.',
    valen2: 'Got it, Valentina. We will update it and confirm.',
    prov: 'Supplier · Packaging',
    prov1: 'Here is the updated quote for the boxes.',
    prov2: 'Thanks. Does the price include shipping?',
    prov3: 'Yes, within the metro area.',
    joaco1: 'Could you call me today at 3 pm? I want to go over the integration.',
    joaco2: 'Sure, I will call you at 3.',
    ventas: 'Sales team · Leads',
    ventas1: '8 new leads came in from the form. Shall we split them?',
    ventas2: 'I will take the ones from Córdoba.',
    broadcastName: 'Training reminder',
    broadcast: 'Reminder: the new catalog training is on Thursday at 10 am. See you there!',
    voice: 'Voice note.wav',
    quote: 'Boxes-quote.pdf',
  },
  pt: {
    number: 'Número de exemplo',
    lSupport: 'Suporte',
    lSales: 'Vendas',
    lOnboarding: 'Onboarding',
    lVip: 'VIP',
    lucia1: 'Oi! Fiz o pedido #4821 ontem e ainda não recebi o e-mail de confirmação. Podem me ajudar?',
    lucia2: 'Paguei com cartão, caso ajude.',
    luciaTicket: 'Pedido #4821 sem e-mail de confirmação',
    acme: 'Acme · Implantação',
    acmeDesc: 'Implantação da Acme. Dúvidas, avanços e arquivos.',
    acme1: 'Bom dia! Já subimos o CSV com os 300 contatos.',
    acme2: 'Obrigado, Martín. Revisamos hoje e confirmamos.',
    acme3: 'Assim ficou o painel com os primeiros dados.',
    acmeNote: '{me} atenção: o CSV tem telefones sem código do país. Vamos corrigir antes de importar.',
    acme4: 'Para quando podemos marcar o treinamento da equipe?',
    dist: 'Distribuidores região norte',
    dist1: 'Olá a todos. Montamos um treinamento sobre o novo catálogo.',
    distPoll: 'Qual dia vocês preferem para o treinamento?',
    o1: 'Terça 10 h',
    o2: 'Quinta 10 h',
    o3: 'Sexta 15 h',
    dist2: 'Quinta fica perfeito para mim.',
    diego1: 'Oi, vocês têm plano anual? Somos 12 pessoas.',
    diego2: 'Sim, o anual tem dois meses de desconto. Vou montar a proposta.',
    diego3: 'Ótimo, obrigado.',
    diegoNote: 'Veio da feira. Também tem interesse no módulo de tickets.',
    diegoTask: 'Enviar a proposta anual para o Diego',
    sofia1: 'Não consigo entrar na minha conta, diz que a senha está errada.',
    sofia2: 'Enviamos um link para criar uma senha nova. Avise se chegar.',
    sofia3: 'Pronto, já consegui entrar. Obrigada!',
    sofia4: 'Ótimo. Qualquer coisa, escreva por aqui.',
    logi: 'Logística · Pedidos semanais',
    logi1: 'Amanhã o caminhão sai às 7. Confirmem os pedidos antes das 18 h.',
    logi2: 'O nosso está confirmado: 40 caixas.',
    logi3: 'Nós somamos mais 12 ao da semana passada.',
    pablo1: 'Podem me mandar a nota fiscal de outubro?',
    pablo2: 'É para a prestação de contas de amanhã.',
    comm: 'Comunidade de clientes',
    commDesc: 'Novidades do produto. Só os admins escrevem.',
    comm1: 'Novo: respostas rápidas. Digitem / no chat para usar.',
    comm2: 'Na quinta tem manutenção das 22 às 23 h. Nada se perde.',
    valen1: 'Deixo um áudio com os detalhes da mudança de endereço.',
    valen2: 'Recebido, Valentina. Vamos alterar e confirmo.',
    prov: 'Fornecedor · Embalagens',
    prov1: 'Segue a cotação atualizada das caixas.',
    prov2: 'Obrigado. O preço inclui o frete?',
    prov3: 'Sim, para a capital e região.',
    joaco1: 'Podem me ligar hoje às 15 h? Quero ver a integração.',
    joaco2: 'Combinado, ligo às 15 h.',
    ventas: 'Time comercial · Leads',
    ventas1: 'Entraram 8 leads novos do formulário. Vamos dividir?',
    ventas2: 'Eu fico com os de Córdoba.',
    broadcastName: 'Lembrete do treinamento',
    broadcast: 'Lembrete: o treinamento do novo catálogo é na quinta às 10 h. Esperamos vocês!',
    voice: 'Mensagem de voz.wav',
    quote: 'Cotacao-caixas.pdf',
  },
};

function chats(t: Record<string, string>): SampleChat[] {
  const P = PEOPLE;
  return [
    {
      key: 'lucia',
      kind: 'dm',
      name: P.lucia.name,
      people: [P.lucia],
      labels: ['lSupport', 'lVip'],
      awaiting: true,
      unread: 2,
      messages: [
        { ago: 14, dir: 'in', body: t.lucia1 },
        { ago: 13, dir: 'in', body: t.lucia2 },
      ],
    },
    {
      key: 'acme',
      kind: 'group',
      name: t.acme,
      description: t.acmeDesc,
      people: [P.martin, P.carla, P.ana],
      labels: ['lOnboarding'],
      assigned: true,
      unread: 1,
      messages: [
        { ago: 180, dir: 'in', from: 0, body: t.acme1 },
        { ago: 170, dir: 'out', body: t.acme2 },
        { ago: 95, dir: 'in', from: 1, body: t.acme3, media: { type: 'image/svg+xml', name: 'panel.svg', image: true } },
        { ago: 90, dir: 'note', body: t.acmeNote },
        { ago: 32, dir: 'in', from: 0, body: t.acme4 },
      ],
    },
    {
      key: 'joaco',
      kind: 'dm',
      name: P.joaco.name,
      people: [P.joaco],
      pinned: true,
      labels: ['lVip'],
      messages: [
        { ago: 50, dir: 'in', body: t.joaco1 },
        { ago: 48, dir: 'out', body: t.joaco2 },
      ],
    },
    {
      key: 'dist',
      kind: 'group',
      name: t.dist,
      people: [P.bruno, P.elena, P.tomas, P.marta, P.nico],
      labels: ['lSales'],
      messages: [
        { ago: 300, dir: 'out', body: t.dist1 },
        { ago: 299, dir: 'out', body: t.distPoll, poll: { question: t.distPoll, options: [t.o1, t.o2, t.o3], votes: [[1], [1], [0], [2]] } },
        { ago: 240, dir: 'in', from: 1, body: t.dist2 },
      ],
    },
    {
      key: 'diego',
      kind: 'dm',
      name: P.diego.name,
      people: [P.diego],
      labels: ['lSales'],
      assigned: true,
      messages: [
        { ago: 26 * 60, dir: 'in', body: t.diego1 },
        { ago: 26 * 60 - 5, dir: 'out', body: t.diego2 },
        { ago: 26 * 60 - 8, dir: 'note', body: t.diegoNote },
        { ago: 26 * 60 - 9, dir: 'in', body: t.diego3 },
      ],
    },
    {
      key: 'pablo',
      kind: 'dm',
      name: P.pablo.name,
      people: [P.pablo],
      unread: 2,
      messages: [
        { ago: 75, dir: 'in', body: t.pablo1 },
        { ago: 74, dir: 'in', body: t.pablo2 },
      ],
    },
    {
      key: 'logi',
      kind: 'group',
      name: t.logi,
      people: [P.tomas, P.marta, P.bruno, P.nico],
      messages: [
        { ago: 6 * 60, dir: 'out', body: t.logi1 },
        { ago: 5 * 60, dir: 'in', from: 0, body: t.logi2 },
        { ago: 4 * 60, dir: 'in', from: 2, body: t.logi3 },
      ],
    },
    {
      key: 'valen',
      kind: 'dm',
      name: P.valen.name,
      people: [P.valen],
      messages: [
        { ago: 8 * 60, dir: 'in', body: t.valen1, media: { type: 'audio/wav', name: t.voice, url: '/groups-sample/nota-de-voz.wav' } },
        { ago: 8 * 60 - 10, dir: 'out', body: t.valen2 },
      ],
    },
    {
      key: 'comm',
      kind: 'group',
      name: t.comm,
      description: t.commDesc,
      announce: true,
      people: [P.lucia, P.diego, P.sofia, P.pablo, P.valen, P.joaco, P.elena, P.nico],
      messages: [
        { ago: 2 * 24 * 60, dir: 'out', body: t.comm1 },
        { ago: 20 * 60, dir: 'out', body: t.comm2 },
      ],
    },
    {
      key: 'prov',
      kind: 'group',
      name: t.prov,
      people: [P.marta, P.ana],
      messages: [
        { ago: 30 * 60, dir: 'in', from: 0, body: t.prov1, media: { type: 'application/pdf', name: t.quote, url: '/groups-sample/cotizacion.pdf' } },
        { ago: 29 * 60, dir: 'out', body: t.prov2 },
        { ago: 28 * 60, dir: 'in', from: 0, body: t.prov3 },
      ],
    },
    {
      key: 'ventas',
      kind: 'group',
      name: t.ventas,
      people: [P.elena, P.bruno],
      messages: [
        { ago: 3 * 24 * 60, dir: 'in', from: 0, body: t.ventas1 },
        { ago: 3 * 24 * 60 - 20, dir: 'in', from: 1, body: t.ventas2 },
      ],
    },
    {
      key: 'sofia',
      kind: 'dm',
      name: P.sofia.name,
      people: [P.sofia],
      labels: ['lSupport'],
      closed: true,
      messages: [
        { ago: 4 * 24 * 60, dir: 'in', body: t.sofia1 },
        { ago: 4 * 24 * 60 - 6, dir: 'out', body: t.sofia2 },
        { ago: 4 * 24 * 60 - 30, dir: 'in', body: t.sofia3 },
        { ago: 4 * 24 * 60 - 32, dir: 'out', body: t.sofia4 },
      ],
    },
  ];
}

export interface SampleConfig {
  sample: true;
  /** Etiquetas que creó la carga (las que ya existían no se tocan al borrar). */
  labelIds: string[];
}

export async function sampleNumberRow(ws: string): Promise<NumberRow | null> {
  return ((await getDb().prepare("SELECT * FROM groups_numbers WHERE user_id = ? AND provider = 'sample' ORDER BY created_at LIMIT 1").get(ws)) as NumberRow) ?? null;
}

const iso = (minutesAgo: number, now: number) => new Date(now - minutesAgo * 60_000).toISOString();

function previewText(m: SampleMsg): string {
  if (m.poll) return pollPreview({ question: m.poll.question, options: m.poll.options, multi: false }).slice(0, 140);
  const text = m.body.replace(/\s+/g, ' ').trim();
  return (text || m.media?.name || '').slice(0, 140);
}

/** Carga los datos de ejemplo (una sola vez: si ya están, devuelve el número). */
export async function loadSampleData(ws: string, actor: string, rawLocale: string): Promise<NumberDto> {
  const existing = await sampleNumberRow(ws);
  if (existing) return toNumberDto(existing);
  const count = (await getDb().prepare('SELECT COUNT(*) AS c FROM groups_numbers WHERE user_id = ?').get(ws)) as { c: number };
  if (Number(count.c) >= 50) throw new GroupsError('too_many_numbers');
  const locale: Locale = rawLocale === 'en' || rawLocale === 'pt' ? rawLocale : 'es';
  const t = T[locale];
  const db = getDb();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const numberId = randomUUID();

  // Etiquetas: se reusan las que ya tenga el workspace con el mismo nombre.
  const labelIds: Record<string, string> = {};
  const created: string[] = [];
  const colors: Record<string, string> = { lSupport: 'blue', lSales: 'green', lOnboarding: 'purple', lVip: 'orange' };
  for (const key of Object.keys(colors)) {
    const id = randomUUID();
    const r = await db
      .prepare('INSERT OR IGNORE INTO groups_labels (id, user_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, ws, t[key], colors[key], nowIso);
    if (r.changes > 0) {
      labelIds[key] = id;
      created.push(id);
    } else {
      const row = (await db.prepare('SELECT id FROM groups_labels WHERE user_id = ? AND name = ?').get(ws, t[key])) as { id: string } | undefined;
      if (row) labelIds[key] = row.id;
    }
  }

  const cfg: SampleConfig = { sample: true, labelIds: created };
  await db
    .prepare(
      `INSERT INTO groups_numbers (id, user_id, name, provider, phone, status, config, webhook_secret, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'sample', ?, 'connected', ?, ?, ?, ?, ?)`,
    )
    .run(numberId, ws, t.number, SAMPLE_PHONE, seal(JSON.stringify(cfg)), randomBytes(24).toString('hex'), actor, nowIso, nowIso);

  const people = await listPeople(ws);
  const me = people.find((p) => p.id === actor);
  const mention = me?.name ? `@${me.name}` : '';

  const chatIds: Record<string, string> = {};
  const messageIds: Record<string, string[]> = {};
  for (const c of chats(t)) {
    const chatId = randomUUID();
    chatIds[c.key] = chatId;
    messageIds[c.key] = [];
    const providerChatId = c.kind === 'group' ? `sample-${randomBytes(8).toString('hex')}@g.us` : `${c.people[0].phone}@c.us`;
    const lastShown = [...c.messages].reverse().find((m) => m.dir !== 'note') ?? c.messages[c.messages.length - 1];
    const firstAwaiting = c.awaiting ? c.messages.find((m) => m.dir === 'in') : undefined;
    await db
      .prepare(
        `INSERT INTO groups_chats (id, user_id, number_id, provider_chat_id, kind, name, phone, description, member_count, assigned_to, status,
           unread_count, last_message_at, last_message_preview, awaiting_since, pinned_at, announce, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        chatId,
        ws,
        numberId,
        providerChatId,
        c.kind,
        c.name,
        c.kind === 'dm' ? c.people[0].phone : '',
        c.description ?? '',
        c.kind === 'group' ? c.people.length + 1 : 0,
        c.assigned ? actor : null,
        c.closed ? 'closed' : 'open',
        c.unread ?? 0,
        iso(lastShown.ago, now),
        previewText(lastShown),
        firstAwaiting ? iso(firstAwaiting.ago, now) : null,
        c.pinned ? nowIso : null,
        c.announce ? 1 : 0,
        iso(c.messages[0].ago + 60, now),
        nowIso,
      );
    if (c.kind === 'group') {
      await db
        .prepare('INSERT INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(chatId, SAMPLE_PHONE, t.number, 'superadmin', nowIso);
      for (const [i, p] of c.people.entries()) {
        await db
          .prepare('INSERT INTO groups_members (chat_id, phone, name, role, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(chatId, p.phone, p.name, i === 0 ? 'admin' : 'member', iso(-1 - i, now));
      }
    }
    for (const m of c.messages) {
      const id = randomUUID();
      messageIds[c.key].push(id);
      const sender = m.dir === 'in' ? (c.kind === 'dm' ? c.people[0] : c.people[m.from ?? 0]) : null;
      const body = m.dir === 'note' ? m.body.replace('{me}', mention).trim() : m.body;
      await db
        .prepare(
          `INSERT INTO groups_messages (id, user_id, chat_id, number_id, provider_message_id, direction, sender_phone, sender_name, author_id,
             body, media_url, media_type, media_name, status, created_at, poll)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          ws,
          chatId,
          numberId,
          m.dir === 'note' ? null : `sample-${randomUUID()}`,
          m.dir,
          sender?.phone ?? '',
          sender?.name ?? '',
          m.dir === 'in' ? null : actor,
          body,
          m.media?.image ? PANEL_IMG : (m.media?.url ?? ''),
          m.media?.type ?? '',
          m.media?.name ?? '',
          m.dir === 'in' ? 'received' : m.dir === 'out' ? 'read' : 'sent',
          iso(m.ago, now),
          m.poll ? JSON.stringify({ question: m.poll.question, options: m.poll.options, multi: false }) : '',
        );
      if (m.poll) {
        for (const [i, picks] of m.poll.votes.entries()) {
          const voter = c.people[i] ?? c.people[0];
          await db
            .prepare('INSERT OR REPLACE INTO groups_poll_votes (message_id, voter, voter_name, options, updated_at) VALUES (?, ?, ?, ?, ?)')
            .run(id, voter.phone, voter.name, JSON.stringify(picks.map((k) => m.poll!.options[k])), iso(m.ago - 10 - i, now));
        }
      }
    }
    for (const l of c.labels ?? []) {
      if (labelIds[l]) await db.prepare('INSERT OR IGNORE INTO groups_chat_labels (chat_id, label_id) VALUES (?, ?)').run(chatId, labelIds[l]);
    }
  }

  // Un ticket abierto desde el primer mensaje de Lucía (sin primera respuesta todavía).
  for (let attempt = 0; attempt < 5; attempt++) {
    const next = (await db.prepare('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM groups_tickets WHERE user_id = ?').get(ws)) as { n: number };
    try {
      await db
        .prepare(
          `INSERT INTO groups_tickets (id, user_id, number, chat_id, message_id, title, status, priority, assignee_id, source, due_at,
             first_response_due_at, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'open', 'high', ?, 'manual', ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          ws,
          Number(next.n),
          chatIds.lucia,
          messageIds.lucia[0],
          t.luciaTicket,
          actor,
          new Date(now + 8 * 3_600_000).toISOString(),
          new Date(now + 3_600_000).toISOString(),
          actor,
          iso(12, now),
          iso(12, now),
        );
      break;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err)) || attempt === 4) throw err;
    }
  }

  // Una tarea para mañana (es del CRM: se borra junto con los datos de ejemplo).
  try {
    const { createGroupTask } = await import('./groups-tasks');
    await createGroupTask(ws, actor, {
      chatId: chatIds.diego,
      messageId: messageIds.diego[0],
      title: t.diegoTask,
      dueAt: new Date(now + 24 * 3_600_000).toISOString(),
      locale,
    });
  } catch {
    // Sin CRM disponible la carga sigue sin la tarea.
  }

  // Un envío programado a dos grupos para pasado mañana.
  const { createBroadcast } = await import('./groups-broadcasts');
  await createBroadcast(ws, actor, {
    numberId,
    name: t.broadcastName,
    body: t.broadcast,
    chatIds: [chatIds.dist, chatIds.comm],
    scheduledAt: new Date(now + 2 * 24 * 3_600_000).toISOString(),
    kind: 'scheduled',
  });

  return toNumberDto((await getNumberRow(ws, numberId)) as NumberRow);
}

/** Borra todos los datos de ejemplo del workspace (y nada más). Devuelve si había. */
export async function clearSampleData(ws: string): Promise<boolean> {
  const db = getDb();
  const rows = (await db.prepare("SELECT * FROM groups_numbers WHERE user_id = ? AND provider = 'sample'").all(ws)) as NumberRow[];
  if (rows.length === 0) return false;
  for (const row of rows) {
    const chatIds = ((await db.prepare('SELECT id FROM groups_chats WHERE number_id = ? AND user_id = ?').all(row.id, ws)) as Array<{ id: string }>).map((r) => r.id);
    if (chatIds.length) {
      const marks = chatIds.map(() => '?').join(',');
      const tasks = (await db.prepare(`SELECT id FROM groups_tasks WHERE user_id = ? AND chat_id IN (${marks})`).all(ws, ...chatIds)) as Array<{ id: string }>;
      if (tasks.length) {
        const { deleteGroupTask } = await import('./groups-tasks');
        for (const task of tasks) await deleteGroupTask(ws, task.id).catch(() => false);
      }
      await db.prepare(`DELETE FROM groups_tickets WHERE user_id = ? AND chat_id IN (${marks})`).run(ws, ...chatIds);
      await db.prepare(`DELETE FROM groups_audit WHERE user_id = ? AND chat_id IN (${marks})`).run(ws, ...chatIds);
      await db.prepare(`DELETE FROM groups_notifications WHERE user_id = ? AND chat_id IN (${marks})`).run(ws, ...chatIds);
    }
    // Las etiquetas que creó la carga, salvo que ya estén en un chat real.
    const cfg = readConfig(row) as Partial<SampleConfig>;
    for (const labelId of Array.isArray(cfg.labelIds) ? cfg.labelIds : []) {
      const used = await db
        .prepare('SELECT 1 AS x FROM groups_chat_labels cl JOIN groups_chats c ON c.id = cl.chat_id WHERE cl.label_id = ? AND c.number_id != ? LIMIT 1')
        .get(labelId, row.id);
      if (!used) await db.prepare('DELETE FROM groups_labels WHERE id = ? AND user_id = ?').run(labelId, ws);
    }
    // Chats, mensajes, miembros, votos y envíos caen en cascada; se borran también a mano por si la base no tiene las foreign keys prendidas.
    if (chatIds.length) {
      const marks = chatIds.map(() => '?').join(',');
      await db.prepare(`DELETE FROM groups_poll_votes WHERE message_id IN (SELECT id FROM groups_messages WHERE chat_id IN (${marks}))`).run(...chatIds);
      await db.prepare(`DELETE FROM groups_broadcast_recipients WHERE chat_id IN (${marks})`).run(...chatIds);
      await db.prepare(`DELETE FROM groups_messages WHERE user_id = ? AND chat_id IN (${marks})`).run(ws, ...chatIds);
      await db.prepare(`DELETE FROM groups_members WHERE chat_id IN (${marks})`).run(...chatIds);
      await db.prepare(`DELETE FROM groups_chat_labels WHERE chat_id IN (${marks})`).run(...chatIds);
    }
    await db.prepare('DELETE FROM groups_broadcasts WHERE user_id = ? AND number_id = ?').run(ws, row.id);
    await db.prepare('DELETE FROM groups_recurring WHERE user_id = ? AND number_id = ?').run(ws, row.id);
    await db.prepare('DELETE FROM groups_chats WHERE user_id = ? AND number_id = ?').run(ws, row.id);
    await db.prepare("DELETE FROM groups_numbers WHERE id = ? AND user_id = ? AND provider = 'sample'").run(row.id, ws);
  }
  return true;
}
