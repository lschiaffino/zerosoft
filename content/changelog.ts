/**
 * Changelog público (/[locale]/changelog y feed Atom). Armado a partir del
 * historial real de git: solo lo que se publicó. Para agregar una entrada,
 * sumarla ARRIBA de todo (orden: más nueva primero) con el texto en los tres
 * idiomas. `id` es el ancla (#id) y el id del feed: no cambiarlo una vez publicado.
 */

export type ChangelogProduct = 'link' | 'crm' | 'cal' | 'track' | 'chat' | 'docs' | 'platform';

export interface Localized {
  en: string;
  es: string;
  pt: string;
}

export interface ChangelogItem extends Localized {
  product: ChangelogProduct;
}

export interface ChangelogEntry {
  id: string;
  date: string; // yyyy-mm-dd
  title: Localized;
  items: ChangelogItem[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: '2026-10-13-design',
    date: '2026-10-13',
    title: {
      en: 'A calmer website, and zeros that follow your cursor',
      es: 'Un sitio más sobrio, y ceros que siguen tu cursor',
      pt: 'Um site mais sóbrio, e zeros que seguem seu cursor',
    },
    items: [
      {
        product: 'platform',
        en: 'The zero made of zeros on the home page now reacts to the cursor everywhere, even over the headline, and also shows on phones.',
        es: 'El cero hecho de ceros del home ahora reacciona al cursor en todos lados, incluso sobre el título, y también se ve en el celular.',
        pt: 'O zero feito de zeros da home agora reage ao cursor em todo lugar, até sobre o título, e também aparece no celular.',
      },
      {
        product: 'platform',
        en: 'Fewer badges, square corners and plain lists: the suite is now split into "For teams" and "For you", with what is coming next marked as soon.',
        es: 'Menos etiquetas, esquinas rectas y listas simples: la suite ahora se divide en "Para equipos" y "Para vos", con lo que viene marcado como pronto.',
        pt: 'Menos etiquetas, cantos retos e listas simples: a suíte agora se divide em "Para equipes" e "Para você", com o que vem por aí marcado como em breve.',
      },
    ],
  },
  {
    id: '2026-10-13-site',
    date: '2026-10-13',
    title: {
      en: 'A new website, videos of the real app and public booking profiles',
      es: 'Sitio nuevo, videos de la app real y perfiles públicos de reservas',
      pt: 'Site novo, vídeos do app real e perfis públicos de reservas',
    },
    items: [
      {
        product: 'platform',
        en: 'Redesigned website: suite overview, what your current stack costs, self-hosting in one command, and a developer section with real API examples. The code is now public on GitHub.',
        es: 'Sitio rediseñado: la suite de un vistazo, cuánto cuesta tu stack actual, self-hosting en un comando y una sección para developers con ejemplos reales de la API. El código ahora es público en GitHub.',
        pt: 'Site redesenhado: a suíte num relance, quanto custa seu stack atual, self-hosting em um comando e uma seção para devs com exemplos reais da API. O código agora é público no GitHub.',
      },
      {
        product: 'platform',
        en: 'Seven short videos recorded from the real app, on /videos and on each product page. 36 new blog posts.',
        es: 'Siete videos cortos grabados de la app real, en /videos y en cada página de producto. 36 artículos nuevos en el blog.',
        pt: 'Sete vídeos curtos gravados do app real, em /videos e em cada página de produto. 36 novos artigos no blog.',
      },
      {
        product: 'cal',
        en: 'zerosoft.ai/book/<your-handle> now shows all your meeting types instead of a 404.',
        es: 'zerosoft.ai/book/<tu-handle> ahora muestra todos tus tipos de reunión en vez de un 404.',
        pt: 'zerosoft.ai/book/<seu-handle> agora mostra todos os seus tipos de reunião em vez de um 404.',
      },
      {
        product: 'link',
        en: 'API v1: edit and delete links (PATCH/DELETE /api/v1/links/{id}); rate-limited responses include Retry-After.',
        es: 'API v1: editar y borrar links (PATCH/DELETE /api/v1/links/{id}); las respuestas con límite de uso incluyen Retry-After.',
        pt: 'API v1: editar e excluir links (PATCH/DELETE /api/v1/links/{id}); respostas com limite de uso incluem Retry-After.',
      },
      {
        product: 'docs',
        en: 'Table cells no longer show "&amp;" instead of "&"; Docs code blocks wrap correctly. Chat no longer shows raw text keys in SLA timers and People.',
        es: 'Las celdas de tablas ya no muestran "&amp;" en vez de "&" y los bloques de código de Docs se ven bien. Chat ya no muestra claves de texto en los timers de SLA y en People.',
        pt: 'As células de tabelas não mostram mais "&amp;" no lugar de "&" e os blocos de código do Docs aparecem certos. O Chat não mostra mais chaves de texto nos timers de SLA e em People.',
      },
    ],
  },
  {
    id: '2026-10-12-crm-suite',
    date: '2026-10-12',
    title: {
      en: 'Cal and Chat feed the CRM, plus a complete CRM API',
      es: 'Cal y Chat alimentan el CRM, y la API del CRM completa',
      pt: 'Cal e Chat alimentam o CRM, e a API do CRM completa',
    },
    items: [
      {
        product: 'cal',
        en: 'Every booking creates (or updates) the guest as a CRM contact and logs the meeting on their timeline; rescheduling and cancelling update that same activity.',
        es: 'Cada reserva crea (o actualiza) al invitado como contacto del CRM y registra la reunión en su timeline; reprogramar y cancelar actualizan esa misma actividad.',
        pt: 'Cada reserva cria (ou atualiza) o convidado como contato do CRM e registra a reunião na timeline; reagendar e cancelar atualizam essa mesma atividade.',
      },
      {
        product: 'chat',
        en: 'From a conversation, create the visitor as a CRM contact and save the chat to their timeline in one click.',
        es: 'Desde una conversación, creá al visitante como contacto del CRM y guardá el chat en su timeline con un clic.',
        pt: 'A partir de uma conversa, crie o visitante como contato do CRM e salve o chat na timeline com um clique.',
      },
      {
        product: 'crm',
        en: 'New workflow trigger: "Meeting booked (Cal)". New webhooks: contact.created/updated and deal.created/updated/stage_changed/won/lost.',
        es: 'Nuevo trigger de workflows: "Reunión agendada (Cal)". Nuevos webhooks: contact.created/updated y deal.created/updated/stage_changed/won/lost.',
        pt: 'Novo gatilho de workflows: "Reunião agendada (Cal)". Novos webhooks: contact.created/updated e deal.created/updated/stage_changed/won/lost.',
      },
      {
        product: 'platform',
        en: 'API v1: delete contacts, companies and deals, move deals between stages, read and log activities, ISO 8601 dates with time zones. OpenAPI 3.1 spec at /api/v1/openapi.json.',
        es: 'API v1: borrar contactos, empresas y deals, mover deals de etapa, leer y registrar actividades, fechas ISO 8601 con zona horaria. Spec OpenAPI 3.1 en /api/v1/openapi.json.',
        pt: 'API v1: excluir contatos, empresas e deals, mover deals de etapa, ler e registrar atividades, datas ISO 8601 com fuso horário. Spec OpenAPI 3.1 em /api/v1/openapi.json.',
      },
      {
        product: 'platform',
        en: 'Fixed the CRM examples in the API docs (they used snake_case fields the API ignores). A public changelog and a feedback form are live too.',
        es: 'Corregimos los ejemplos del CRM en la doc de la API (usaban campos en snake_case que la API ignora). También salieron el changelog público y el formulario de feedback.',
        pt: 'Corrigimos os exemplos do CRM na doc da API (usavam campos em snake_case que a API ignora). Também saíram o changelog público e o formulário de feedback.',
      },
    ],
  },
  {
    id: '2026-10-12-color',
    date: '2026-10-12',
    title: {
      en: 'A color for every product, and a tidier app',
      es: 'Un color por producto y una app más prolija',
      pt: 'Uma cor para cada produto e um app mais organizado',
    },
    items: [
      {
        product: 'platform',
        en: 'Each product now has its own color — Link blue, CRM violet, Cal green, Track orange, Chat pink, Docs amber — used for navigation, main buttons and charts.',
        es: 'Cada producto tiene su color — Link azul, CRM violeta, Cal verde, Track naranja, Chat rosa, Docs ámbar — en la navegación, los botones principales y los gráficos.',
        pt: 'Cada produto agora tem sua cor — Link azul, CRM violeta, Cal verde, Track laranja, Chat rosa, Docs âmbar — na navegação, nos botões principais e nos gráficos.',
      },
      {
        product: 'platform',
        en: 'Status colors mean something: overdue tasks, priorities, booking states and workflow runs read at a glance.',
        es: 'Los colores de estado significan algo: tareas vencidas, prioridades, estados de reservas y ejecuciones de workflows se leen de un vistazo.',
        pt: 'As cores de status têm significado: tarefas atrasadas, prioridades, status de reservas e execuções de workflows se leem num relance.',
      },
      {
        product: 'crm',
        en: 'Deals board with cleaner cards ("no activity in N days", close date) and a "Move to…" shortcut on hover.',
        es: 'Board de deals con tarjetas más limpias ("sin actividad en N días", fecha de cierre) y atajo "Mover a…" al pasar el mouse.',
        pt: 'Board de deals com cards mais limpos ("sem atividade há N dias", data de fechamento) e atalho "Mover para…" ao passar o mouse.',
      },
      {
        product: 'crm',
        en: 'Deal stage shown as a progress bar with Won / Lost; saved contact views as tabs, with the less-used filters under "More filters".',
        es: 'La etapa del deal se ve como barra de progreso con Ganado / Perdido; vistas guardadas de contactos como pestañas y los filtros menos usados en "Más filtros".',
        pt: 'A etapa do deal aparece como barra de progresso com Ganho / Perdido; visões salvas de contatos como abas e os filtros menos usados em "Mais filtros".',
      },
      {
        product: 'crm',
        en: '"Today" and "overdue" tasks now use your browser\'s time zone instead of UTC.',
        es: 'Las tareas de "hoy" y "vencidas" usan la zona horaria de tu navegador en vez de UTC.',
        pt: 'As tarefas de "hoje" e "atrasadas" usam o fuso horário do seu navegador em vez de UTC.',
      },
      {
        product: 'platform',
        en: 'No more horizontal scrolling on mobile in Chat, Reports and Settings; the website header gets a proper hamburger menu on phones.',
        es: 'Sin scroll horizontal en mobile en Chat, Reportes y Configuración; el header del sitio tiene menú hamburguesa en el celular.',
        pt: 'Sem rolagem horizontal no celular em Chat, Relatórios e Configurações; o header do site ganhou menu hambúrguer no celular.',
      },
    ],
  },
  {
    id: '2026-10-12-crm',
    date: '2026-10-12',
    title: {
      en: 'CRM: safer workspaces and workflows',
      es: 'CRM: workspaces y workflows más seguros',
      pt: 'CRM: workspaces e workflows mais seguros',
    },
    items: [
      {
        product: 'crm',
        en: 'Records can only reference companies, contacts, deals and owners from your own workspace.',
        es: 'Los registros solo pueden referenciar empresas, contactos, deals y owners de tu propio workspace.',
        pt: 'Os registros só podem referenciar empresas, contatos, deals e owners do seu próprio workspace.',
      },
      {
        product: 'crm',
        en: 'Workflows can no longer trigger themselves in a loop, and "Run now" runs only the workflow you picked.',
        es: 'Los workflows ya no pueden dispararse a sí mismos en loop, y "Run now" corre solo el workflow elegido.',
        pt: 'Os workflows não podem mais se disparar em loop, e "Run now" executa só o workflow escolhido.',
      },
      {
        product: 'crm',
        en: '"Task due" automations fire when the task is actually due, not when it is created.',
        es: 'Las automatizaciones de "tarea vencida" se disparan cuando la tarea vence, no cuando se crea.',
        pt: 'As automações de "tarefa vencida" disparam quando a tarefa vence, não quando é criada.',
      },
      {
        product: 'crm',
        en: 'Workflows, export and bulk delete are limited to workspace admins.',
        es: 'Workflows, export y borrado masivo quedan solo para admins del workspace.',
        pt: 'Workflows, exportação e exclusão em massa ficam restritos aos admins do workspace.',
      },
      {
        product: 'crm',
        en: 'Imports skip bad cells instead of failing the whole file; dynamic lists show their real count; merging contacts keeps their emails.',
        es: 'El import saltea celdas inválidas en vez de fallar todo el archivo; las listas dinámicas muestran su conteo real; al fusionar contactos se conservan sus emails.',
        pt: 'A importação pula células inválidas em vez de falhar o arquivo inteiro; listas dinâmicas mostram a contagem real; ao mesclar contatos, os emails são mantidos.',
      },
      {
        product: 'crm',
        en: 'New API endpoint to list pipelines (GET /api/v1/crm/pipelines).',
        es: 'Nuevo endpoint de la API para listar pipelines (GET /api/v1/crm/pipelines).',
        pt: 'Novo endpoint da API para listar pipelines (GET /api/v1/crm/pipelines).',
      },
    ],
  },
  {
    id: '2026-10-12-link',
    date: '2026-10-12',
    title: {
      en: 'Link: custom domains, Bitly import and link-in-bio',
      es: 'Link: dominios propios, import de Bitly y link-in-bio',
      pt: 'Link: domínios próprios, importação do Bitly e link-in-bio',
    },
    items: [
      {
        product: 'link',
        en: 'Custom domains: short links on go.yourcompany.com/slug, with DNS instructions, verification and a configurable root redirect.',
        es: 'Dominios propios: links cortos en go.tuempresa.com/slug, con instrucciones DNS, verificación y redirect configurable para la raíz.',
        pt: 'Domínios próprios: links curtos em go.suaempresa.com/slug, com instruções de DNS, verificação e redirect configurável para a raiz.',
      },
      {
        product: 'link',
        en: 'Import from Bitly via API token or CSV — up to 2,000 links per run, keeping back-halves when they are free.',
        es: 'Importar desde Bitly con token de la API o CSV — hasta 2.000 links por vez, conservando los back-halves si están libres.',
        pt: 'Importar do Bitly via token da API ou CSV — até 2.000 links por vez, mantendo os back-halves quando estão livres.',
      },
      {
        product: 'link',
        en: 'Link-in-bio page at zerosoft.ai/@handle: pick and order your links; every click is counted.',
        es: 'Página link-in-bio en zerosoft.ai/@handle: elegís y ordenás tus links; cada click se cuenta.',
        pt: 'Página link-in-bio em zerosoft.ai/@handle: escolha e ordene seus links; cada clique é contado.',
      },
      {
        product: 'link',
        en: 'Analytics for 7, 30 and 90 days or all time, with the change versus the previous period.',
        es: 'Analytics de 7, 30 y 90 días o todo el historial, con la variación contra el período anterior.',
        pt: 'Analytics de 7, 30 e 90 dias ou todo o histórico, com a variação em relação ao período anterior.',
      },
      {
        product: 'link',
        en: 'Webhooks for link.created and link.clicked, plus full export of your links as CSV or JSON.',
        es: 'Webhooks link.created y link.clicked, y export completo de tus links en CSV o JSON.',
        pt: 'Webhooks link.created e link.clicked, e exportação completa dos seus links em CSV ou JSON.',
      },
    ],
  },
  {
    id: '2026-10-12-cal',
    date: '2026-10-12',
    title: {
      en: 'Cal: Google Calendar, rescheduling and embeds',
      es: 'Cal: Google Calendar, reprogramación y embed',
      pt: 'Cal: Google Calendar, reagendamento e embed',
    },
    items: [
      {
        product: 'cal',
        en: 'Connect Google Calendar: busy times block your slots, and each booking creates an event with a Google Meet link.',
        es: 'Conectá Google Calendar: lo ocupado bloquea tus horarios y cada reserva crea un evento con link de Google Meet.',
        pt: 'Conecte o Google Calendar: horários ocupados bloqueiam seus slots e cada reserva cria um evento com link do Google Meet.',
      },
      {
        product: 'cal',
        en: 'Guests can cancel or reschedule from a link in their email, no account needed. Invitations include an .ics file.',
        es: 'Los invitados pueden cancelar o reprogramar desde un link en su email, sin cuenta. Las invitaciones incluyen un .ics.',
        pt: 'Convidados podem cancelar ou reagendar por um link no email, sem conta. Os convites incluem um arquivo .ics.',
      },
      {
        product: 'cal',
        en: 'Personal booking links (/book/your-handle/30min) and a new Cal settings page: handle, time zone, buffers, minimum notice.',
        es: 'Links de reserva personales (/book/tu-handle/30min) y nueva página de configuración de Cal: handle, zona horaria, márgenes, aviso mínimo.',
        pt: 'Links de reserva pessoais (/book/seu-handle/30min) e nova página de configurações do Cal: handle, fuso horário, intervalos, aviso mínimo.',
      },
      {
        product: 'cal',
        en: 'No more double bookings: availability is checked per person across all your event types.',
        es: 'Sin dobles reservas: la disponibilidad se calcula por persona en todos tus event types.',
        pt: 'Sem reservas duplicadas: a disponibilidade é calculada por pessoa em todos os seus event types.',
      },
      {
        product: 'cal',
        en: 'Embed booking on your own site, inline or as a popup button.',
        es: 'Embebé la reserva en tu sitio, en línea o como botón popup.',
        pt: 'Incorpore a reserva no seu site, em linha ou como botão popup.',
      },
      {
        product: 'cal',
        en: 'Signed webhooks for bookings and a public API to list event types and create or cancel bookings.',
        es: 'Webhooks firmados para reservas y API pública para listar event types y crear o cancelar reservas.',
        pt: 'Webhooks assinados para reservas e API pública para listar event types e criar ou cancelar reservas.',
      },
      {
        product: 'cal',
        en: 'Booking emails go out in the language the guest booked in (English, Spanish or Portuguese), and the public booking page got a clean two-column layout.',
        es: 'Los emails de la reserva salen en el idioma en que reservó el invitado (inglés, español o portugués), y la página pública de reserva tiene un diseño limpio en dos columnas.',
        pt: 'Os emails da reserva saem no idioma em que o convidado reservou (inglês, espanhol ou português), e a página pública de reserva ganhou um layout limpo em duas colunas.',
      },
    ],
  },
  {
    id: '2026-10-12-open-source',
    date: '2026-10-12',
    title: {
      en: 'Open source, teams with roles, and a security pass',
      es: 'Open source, teams con roles y una pasada de seguridad',
      pt: 'Open source, times com papéis e uma revisão de segurança',
    },
    items: [
      {
        product: 'platform',
        en: 'zerosoft is open core: the code is AGPLv3 and you can self-host it for free with Docker.',
        es: 'zerosoft es open core: el código es AGPLv3 y lo podés self-hostear gratis con Docker.',
        pt: 'O zerosoft é open core: o código é AGPLv3 e você pode hospedar por conta própria de graça com Docker.',
      },
      {
        product: 'platform',
        en: 'Team roles: owner, admin and member. Deleting pipelines, event types, widgets and other settings requires owner or admin.',
        es: 'Roles en los teams: owner, admin y member. Borrar pipelines, event types, widgets y otra configuración requiere owner o admin.',
        pt: 'Papéis nos times: owner, admin e member. Excluir pipelines, event types, widgets e outras configurações exige owner ou admin.',
      },
      {
        product: 'platform',
        en: 'API keys are personal: members only see and revoke their own. Connected Google tokens are stored encrypted.',
        es: 'Las API keys son personales: cada member ve y revoca solo las suyas. Los tokens de Google conectados se guardan cifrados.',
        pt: 'As API keys são pessoais: cada member vê e revoga só as suas. Os tokens do Google conectados são armazenados criptografados.',
      },
      {
        product: 'platform',
        en: 'Rate limits on the public API and public endpoints (password-protected links, booking pages, chat widget).',
        es: 'Rate limits en la API pública y en los endpoints públicos (links con contraseña, páginas de reserva, widget de chat).',
        pt: 'Rate limits na API pública e nos endpoints públicos (links com senha, páginas de reserva, widget de chat).',
      },
      {
        product: 'track',
        en: 'Personal Track projects are now private to their owner.',
        es: 'Los proyectos personales de Track ahora son privados de su dueño.',
        pt: 'Os projetos pessoais do Track agora são privados do dono.',
      },
      {
        product: 'platform',
        en: 'Upgraded to Next.js 15 and React 19, which closes known critical vulnerabilities. Terms, Privacy and Security pages rewritten to match what the code does.',
        es: 'Actualización a Next.js 15 y React 19, que cierra vulnerabilidades críticas conocidas. Términos, Privacidad y Seguridad reescritos según lo que hace el código.',
        pt: 'Atualização para Next.js 15 e React 19, que fecha vulnerabilidades críticas conhecidas. Termos, Privacidade e Segurança reescritos de acordo com o que o código faz.',
      },
    ],
  },
  {
    id: '2026-07-21-docs-editor',
    date: '2026-07-21',
    title: {
      en: 'Docs: a real writing experience',
      es: 'Docs: una experiencia de escritura de verdad',
      pt: 'Docs: uma experiência de escrita de verdade',
    },
    items: [
      {
        product: 'docs',
        en: 'Inline formatting toolbar: bold, italic, underline, strikethrough, code and links.',
        es: 'Barra de formato en línea: negrita, itálica, subrayado, tachado, código y links.',
        pt: 'Barra de formatação em linha: negrito, itálico, sublinhado, tachado, código e links.',
      },
      {
        product: 'docs',
        en: 'Enter splits blocks, lists continue on their own, Backspace merges, and Markdown shortcuts work as you type.',
        es: 'Enter divide bloques, las listas continúan solas, Backspace une, y los atajos de Markdown funcionan mientras escribís.',
        pt: 'Enter divide blocos, listas continuam sozinhas, Backspace une, e os atalhos de Markdown funcionam enquanto você digita.',
      },
      {
        product: 'docs',
        en: 'Drag blocks to reorder them, insert between blocks, and a block menu to turn into, duplicate, move, comment or delete.',
        es: 'Arrastrá bloques para reordenarlos, insertá entre bloques, y menú de bloque para convertir, duplicar, mover, comentar o borrar.',
        pt: 'Arraste blocos para reordenar, insira entre blocos, e menu de bloco para converter, duplicar, mover, comentar ou excluir.',
      },
      {
        product: 'docs',
        en: 'Slash and @mention menus open right at the cursor.',
        es: 'Los menús de / y @menciones se abren justo en el cursor.',
        pt: 'Os menus de / e @menções abrem exatamente no cursor.',
      },
      {
        product: 'docs',
        en: 'Gallery view for databases and comments on individual blocks.',
        es: 'Vista galería para bases de datos y comentarios en bloques individuales.',
        pt: 'Visão de galeria para bancos de dados e comentários em blocos individuais.',
      },
      {
        product: 'docs',
        en: 'Pasted text is cleaned up, and the editor works better on mobile.',
        es: 'El texto pegado se limpia, y el editor anda mejor en mobile.',
        pt: 'O texto colado é limpo, e o editor funciona melhor no celular.',
      },
    ],
  },
  {
    id: '2026-07-20-routing-gantt',
    date: '2026-07-20',
    title: {
      en: 'Routing forms, a draggable Gantt and SLA policies',
      es: 'Routing forms, Gantt arrastrable y políticas de SLA',
      pt: 'Routing forms, Gantt arrastável e políticas de SLA',
    },
    items: [
      {
        product: 'cal',
        en: 'Routing forms: ask a few questions and send each visitor to the right booking page based on rules.',
        es: 'Routing forms: hacé unas preguntas y mandá a cada visitante a la página de reserva correcta según reglas.',
        pt: 'Routing forms: faça algumas perguntas e envie cada visitante para a página de reserva certa com base em regras.',
      },
      {
        product: 'cal',
        en: 'Booking reminders are sent automatically.',
        es: 'Los recordatorios de reserva se envían automáticamente.',
        pt: 'Os lembretes de reserva são enviados automaticamente.',
      },
      {
        product: 'track',
        en: 'Drag bars on the Gantt timeline to move or resize an issue\'s dates.',
        es: 'Arrastrá las barras del Gantt para mover o cambiar las fechas de un issue.',
        pt: 'Arraste as barras do Gantt para mover ou redimensionar as datas de uma issue.',
      },
      {
        product: 'chat',
        en: 'SLA policy editor per widget and priority.',
        es: 'Editor de políticas de SLA por widget y prioridad.',
        pt: 'Editor de políticas de SLA por widget e prioridade.',
      },
      {
        product: 'platform',
        en: 'Chat gets its own product page; the animated zeros on the site use less CPU and pause when off-screen.',
        es: 'Chat tiene su propia página de producto; los ceros animados del sitio usan menos CPU y se pausan fuera de pantalla.',
        pt: 'O Chat ganhou sua página de produto; os zeros animados do site usam menos CPU e pausam fora da tela.',
      },
    ],
  },
  {
    id: '2026-07-19-depth',
    date: '2026-07-19',
    title: {
      en: 'Dashboards, timelines, round-robin and help desk basics',
      es: 'Dashboards, timelines, round-robin y lo básico de help desk',
      pt: 'Dashboards, timelines, round-robin e o básico de help desk',
    },
    items: [
      {
        product: 'crm',
        en: 'Custom dashboards with a drag-and-drop grid and 10 widget types, saved per user.',
        es: 'Dashboards personalizados con grilla drag-and-drop y 10 tipos de widget, guardados por usuario.',
        pt: 'Dashboards personalizados com grade drag-and-drop e 10 tipos de widget, salvos por usuário.',
      },
      {
        product: 'crm',
        en: 'Workflows, an email composer, meeting booking links and an advanced property filter builder.',
        es: 'Workflows, editor de emails, links para agendar reuniones y un constructor de filtros por propiedad.',
        pt: 'Workflows, editor de emails, links para agendar reuniões e um construtor de filtros por propriedade.',
      },
      {
        product: 'track',
        en: 'Gantt timeline view with start dates, a today line and nested sub-issues.',
        es: 'Vista Gantt con fechas de inicio, línea de hoy y sub-issues anidados.',
        pt: 'Visão Gantt com datas de início, linha de hoje e sub-issues aninhadas.',
      },
      {
        product: 'cal',
        en: 'Team round-robin, booking page branding, confirmation and reminder emails, and single-use links.',
        es: 'Round-robin de equipo, branding en la página de reserva, emails de confirmación y recordatorio, y links de un solo uso.',
        pt: 'Round-robin de equipe, branding na página de reserva, emails de confirmação e lembrete, e links de uso único.',
      },
      {
        product: 'chat',
        en: 'Ticket states and priority, SLAs, office hours, automatic replies and CSAT surveys.',
        es: 'Estados y prioridad de tickets, SLAs, horario de atención, respuestas automáticas y encuestas CSAT.',
        pt: 'Status e prioridade de tickets, SLAs, horário de atendimento, respostas automáticas e pesquisas CSAT.',
      },
      {
        product: 'docs',
        en: 'Trash and restore, templates, comments, @mentions and database blocks.',
        es: 'Papelera y restauración, plantillas, comentarios, @menciones y bloques de base de datos.',
        pt: 'Lixeira e restauração, modelos, comentários, @menções e blocos de banco de dados.',
      },
      {
        product: 'platform',
        en: 'Every screen fully translated to English, Spanish and Portuguese.',
        es: 'Todas las pantallas traducidas al inglés, español y portugués.',
        pt: 'Todas as telas traduzidas para inglês, espanhol e português.',
      },
    ],
  },
  {
    id: '2026-07-19-new-products',
    date: '2026-07-19',
    title: {
      en: 'Four new products: Cal, Track, Chat and Docs',
      es: 'Cuatro productos nuevos: Cal, Track, Chat y Docs',
      pt: 'Quatro produtos novos: Cal, Track, Chat e Docs',
    },
    items: [
      {
        product: 'cal',
        en: 'Cal: event types, weekly availability, blocked slots, a public booking page and a bookings list.',
        es: 'Cal: event types, disponibilidad semanal, bloqueos, página pública de reserva y lista de reservas.',
        pt: 'Cal: event types, disponibilidade semanal, bloqueios, página pública de reserva e lista de reservas.',
      },
      {
        product: 'track',
        en: 'Track: projects, issues, cycles, comments and relations, with list, board and calendar views and saved filters.',
        es: 'Track: proyectos, issues, ciclos, comentarios y relaciones, con vistas de lista, board y calendario y filtros guardados.',
        pt: 'Track: projetos, issues, ciclos, comentários e relações, com visões de lista, board e calendário e filtros salvos.',
      },
      {
        product: 'track',
        en: 'Sub-tasks, attachments, an activity timeline, @mentions and a notifications inbox.',
        es: 'Subtareas, adjuntos, timeline de actividad, @menciones y bandeja de notificaciones.',
        pt: 'Subtarefas, anexos, timeline de atividade, @menções e caixa de notificações.',
      },
      {
        product: 'chat',
        en: 'Chat: an embeddable website widget and a team inbox to reply to conversations.',
        es: 'Chat: widget embebible para tu sitio y bandeja de equipo para responder conversaciones.',
        pt: 'Chat: widget incorporável para o seu site e caixa de entrada da equipe para responder conversas.',
      },
      {
        product: 'chat',
        en: 'People, assignment rules, canned responses, file messages, typing indicators and read receipts.',
        es: 'Personas, reglas de asignación, respuestas guardadas, mensajes con archivos, indicador de "escribiendo" y confirmación de lectura.',
        pt: 'Pessoas, regras de atribuição, respostas prontas, mensagens com arquivos, indicador de digitação e confirmação de leitura.',
      },
      {
        product: 'docs',
        en: 'Docs: a Notion-style wiki with nested pages, blocks, sharing, mentions, page icons and covers.',
        es: 'Docs: wiki estilo Notion con páginas anidadas, bloques, compartir, menciones, íconos y portadas.',
        pt: 'Docs: wiki estilo Notion com páginas aninhadas, blocos, compartilhamento, menções, ícones e capas.',
      },
      {
        product: 'platform',
        en: 'Global search with ⌘K across all products, and complete API docs.',
        es: 'Búsqueda global con ⌘K en todos los productos y documentación completa de la API.',
        pt: 'Busca global com ⌘K em todos os produtos e documentação completa da API.',
      },
    ],
  },
  {
    id: '2026-07-19-crm-teams',
    date: '2026-07-19',
    title: {
      en: 'CRM grows up, and shared workspaces',
      es: 'El CRM crece, y llegan los workspaces compartidos',
      pt: 'O CRM cresce, e chegam os workspaces compartilhados',
    },
    items: [
      {
        product: 'crm',
        en: 'Sortable tables with inline editing, editable columns and bulk actions.',
        es: 'Tablas ordenables con edición en línea, columnas editables y acciones masivas.',
        pt: 'Tabelas ordenáveis com edição em linha, colunas editáveis e ações em massa.',
      },
      {
        product: 'crm',
        en: 'Deal board with totals per stage and "rotting" deals; pinned notes, next task and change history on every record.',
        es: 'Board de deals con totales por etapa y deals "estancados"; notas fijadas, próxima tarea e historial de cambios en cada registro.',
        pt: 'Board de deals com totais por etapa e deals "parados"; notas fixadas, próxima tarefa e histórico de alterações em cada registro.',
      },
      {
        product: 'crm',
        en: 'Associations panel linking contacts, companies and deals; companies auto-linked by email domain.',
        es: 'Panel de asociaciones entre contactos, empresas y deals; empresas vinculadas automáticamente por el dominio del email.',
        pt: 'Painel de associações entre contatos, empresas e deals; empresas vinculadas automaticamente pelo domínio do email.',
      },
      {
        product: 'crm',
        en: 'Gmail integration: connect your inbox and see emails on the contact timeline.',
        es: 'Integración con Gmail: conectá tu bandeja y mirá los emails en el timeline del contacto.',
        pt: 'Integração com Gmail: conecte sua caixa e veja os emails na timeline do contato.',
      },
      {
        product: 'crm',
        en: 'Reports, tasks with details and attachments, and filters by owner.',
        es: 'Reportes, tareas con detalle y adjuntos, y filtros por owner.',
        pt: 'Relatórios, tarefas com detalhes e anexos, e filtros por owner.',
      },
      {
        product: 'platform',
        en: 'Teams: shared workspaces with invite links — create, invite, accept, switch and leave.',
        es: 'Teams: workspaces compartidos con links de invitación — crear, invitar, aceptar, cambiar y salir.',
        pt: 'Times: workspaces compartilhados com links de convite — criar, convidar, aceitar, trocar e sair.',
      },
      {
        product: 'link',
        en: 'Bulk link creation, a click log with CSV export, 301/302 redirects and custom social preview cards.',
        es: 'Creación masiva de links, log de clicks con export CSV, redirects 301/302 y tarjetas de preview social personalizadas.',
        pt: 'Criação de links em massa, log de cliques com exportação CSV, redirects 301/302 e cards de preview social personalizados.',
      },
    ],
  },
  {
    id: '2026-07-18-launch',
    date: '2026-07-18',
    title: {
      en: 'zerosoft is live: Link and CRM',
      es: 'zerosoft está online: Link y CRM',
      pt: 'zerosoft está no ar: Link e CRM',
    },
    items: [
      {
        product: 'platform',
        en: 'First public version of zerosoft.ai, in English, Spanish and Portuguese.',
        es: 'Primera versión pública de zerosoft.ai, en inglés, español y portugués.',
        pt: 'Primeira versão pública do zerosoft.ai, em inglês, espanhol e português.',
      },
      {
        product: 'link',
        en: 'Link: short links with custom aliases, QR codes, password protection, expiration and click analytics.',
        es: 'Link: links cortos con alias propio, códigos QR, contraseña, vencimiento y analytics de clicks.',
        pt: 'Link: links curtos com alias próprio, QR codes, senha, expiração e analytics de cliques.',
      },
      {
        product: 'crm',
        en: 'CRM: contacts, companies, deals on pipelines, lists, custom fields, CSV import/export and duplicate merging.',
        es: 'CRM: contactos, empresas, deals en pipelines, listas, campos personalizados, import/export CSV y fusión de duplicados.',
        pt: 'CRM: contatos, empresas, deals em pipelines, listas, campos personalizados, importação/exportação CSV e mesclagem de duplicados.',
      },
      {
        product: 'platform',
        en: 'Sign in with Google, and API keys for the public API.',
        es: 'Ingreso con Google y API keys para la API pública.',
        pt: 'Login com Google e API keys para a API pública.',
      },
    ],
  },
];

export const CHANGELOG_LOCALES = ['en', 'es', 'pt'] as const;
export type ChangelogLocale = (typeof CHANGELOG_LOCALES)[number];

export function pick(l: Localized, locale: string): string {
  return l[(CHANGELOG_LOCALES as readonly string[]).includes(locale) ? (locale as ChangelogLocale) : 'en'];
}
