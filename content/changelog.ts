/**
 * Changelog público (/[locale]/changelog y feed Atom). Armado a partir del
 * historial real de git: solo lo que se publicó. Para agregar una entrada,
 * sumarla ARRIBA de todo (orden: más nueva primero) con el texto en los tres
 * idiomas. `id` es el ancla (#id) y el id del feed: no cambiarlo una vez publicado.
 */

import type { ProductKey } from '@/lib/product-taxonomy';

/** Taxonomía compartida con feedback, roadmap y board (lib/product-taxonomy.ts). */
export type ChangelogProduct = ProductKey;

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
    id: '2026-10-28-workspace-teams',
    date: '2026-10-28',
    title: {
      en: 'Teams: invite people by email and work together in every app',
      es: 'Equipos: invitá gente por email y trabajen juntos en todas las apps',
      pt: 'Equipes: convide pessoas por email e trabalhem juntos em todos os apps',
    },
    items: [
      { product: 'platform', en: 'Name your workspace, add a logo and invite people by email from Settings › Members. Each invitation is a link that works once and expires in 14 days; if the email does not go out, you can copy the link. Pending invitations can be resent or revoked.', es: 'Ponele nombre y logo a tu workspace e invitá gente por email desde Ajustes › Miembros. Cada invitación es un link que sirve una sola vez y vence a los 14 días; si el email no sale, copiás el link. Las pendientes se reenvían o se revocan.', pt: 'Dê nome e logo ao seu workspace e convide pessoas por email em Configurações › Membros. Cada convite é um link que funciona uma vez e vence em 14 dias; se o email não sair, você copia o link. Os pendentes podem ser reenviados ou revogados.' },
      { product: 'platform', en: 'Whoever accepts sees the same CRM, Docs, Track, Talk, Cal, Chat and the rest of the apps. Roles are owner, admin, member and guest (guests only see what you share with them), and you choose which apps each person can use.', es: 'Quien acepta ve el mismo CRM, Docs, Track, Talk, Cal, Chat y el resto de las apps. Los roles son owner, admin, miembro e invitado (el invitado solo ve lo que le compartís), y elegís qué apps usa cada persona.', pt: 'Quem aceita vê o mesmo CRM, Docs, Track, Talk, Cal, Chat e o resto dos apps. Os papéis são owner, admin, membro e convidado (o convidado só vê o que você compartilha), e você escolhe quais apps cada pessoa usa.' },
      { product: 'platform', en: 'Removing someone cuts their access to every app right away: sessions, API keys, calendar slots, assigned conversations and open Talk connections.', es: 'Sacar a alguien le corta el acceso a todas las apps al instante: sesiones, API keys, horarios de Cal, conversaciones asignadas y conexiones abiertas de Talk.', pt: 'Remover alguém corta o acesso a todos os apps na hora: sessões, chaves de API, horários do Cal, conversas atribuídas e conexões abertas do Talk.' },
      { product: 'platform', en: 'Teams inside the workspace (Sales, Support) live in one place, Settings › Teams, and every app uses them: CRM visibility and round-robin, Chat team inboxes, Groups assignment, Cal host pools and @mentions in Talk.', es: 'Los equipos dentro del workspace (Ventas, Soporte) viven en un solo lugar, Ajustes › Equipos, y los usan todas las apps: visibilidad y round-robin del CRM, inbox por equipo de Chat, asignación de Groups, pools de hosts de Cal y @menciones en Talk.', pt: 'As equipes dentro do workspace (Vendas, Suporte) ficam em um só lugar, Configurações › Equipes, e todos os apps as usam: visibilidade e round-robin do CRM, caixas por equipe do Chat, atribuição do Groups, pools de hosts do Cal e @menções no Talk.' },
      { product: 'platform', en: 'A workspace switcher in the sidebar, a first-run setup (just you or a team, team name and size, your role, who to invite, the tool you come from and the app to open first) and a short welcome for people who join by invitation. Companies can let anyone with their email domain join without an invitation.', es: 'Un switcher de workspace en el sidebar, una configuración inicial (solo vos o un equipo, nombre y tamaño del equipo, tu rol, a quién invitar, la herramienta de la que venís y la app para abrir primero) y una bienvenida corta para quien entra por invitación. Una empresa puede dejar entrar sin invitación a quien tenga el email de su dominio.', pt: 'Um seletor de workspace na barra lateral, uma configuração inicial (só você ou uma equipe, nome e tamanho da equipe, seu papel, quem convidar, a ferramenta de onde você vem e o app para abrir primeiro) e uma boas-vindas curta para quem entra por convite. Uma empresa pode deixar entrar sem convite quem tiver o email do seu domínio.' },
    ],
  },
  {
    id: '2026-10-28-robots-parity',
    date: '2026-10-28',
    title: {
      en: 'Robots: build with AI, capture lists while recording, a table across runs and rows sent to your CRM, Sheets and Airtable',
      es: 'Robots: armado con IA, captura de listas al grabar, tabla entre corridas y filas enviadas al CRM, Sheets y Airtable',
      pt: 'Robots: montagem com IA, captura de listas ao gravar, tabela entre execuções e linhas enviadas ao CRM, Sheets e Airtable',
    },
    items: [
      {
        product: 'robots',
        en: 'Build with AI opens a page, finds the list and proposes the columns with a preview. Write with AI turns a description into steps, and the new Extract with AI step pulls rows described in words. The recorder now captures text, lists with their columns and the next page button, and saves alternative selectors that the robot tries when a page changes; when a step still fails, AI suggests a new selector from the captured page.',
        es: 'Armar con IA abre una página, encuentra la lista y propone las columnas con una vista previa. Escribir con IA convierte una descripción en pasos, y el nuevo paso Extraer con IA saca filas descritas con palabras. El grabador ahora captura texto, listas con sus columnas y el botón de página siguiente, y guarda selectores alternativos que el robot prueba cuando la página cambia; si un paso igual falla, la IA sugiere un selector nuevo desde la página capturada.',
        pt: 'Montar com IA abre uma página, encontra a lista e propõe as colunas com uma prévia. Escrever com IA transforma uma descrição em passos, e o novo passo Extrair com IA tira linhas descritas em palavras. O gravador agora captura texto, listas com suas colunas e o botão de próxima página, e salva seletores alternativos que o robô testa quando a página muda; se um passo ainda falhar, a IA sugere um seletor novo a partir da página capturada.',
      },
      {
        product: 'robots',
        en: 'The Data tab keeps a table of rows across runs, with new, changed and gone rows, search, CSV and AI columns. Change emails show the new and removed rows. The Integrations tab sends new rows to CRM contacts or companies, a Google Sheet or an Airtable table. Lists continue with Load more buttons and infinite scroll, schedules go down to every 5 minutes, bulk runs take a CSV of up to 1,000 rows, robots export and import as files, the gallery has 15 templates for common sites and tasks, and runs can use the language, time zone and (with a proxy provider) the IP of a country.',
        es: 'La pestaña Datos guarda una tabla de filas entre corridas, con filas nuevas, cambiadas y que ya no están, búsqueda, CSV y columnas con IA. Los emails de cambios muestran las filas nuevas y las quitadas. La pestaña Integraciones manda las filas nuevas a contactos o empresas del CRM, a una hoja de Google o a una tabla de Airtable. Las listas siguen con botones Cargar más y scroll infinito, los horarios bajan a cada 5 minutos, las corridas en lote toman un CSV de hasta 1.000 filas, los robots se exportan e importan como archivo, la galería tiene 15 plantillas para sitios y tareas comunes, y las corridas pueden usar el idioma, la zona horaria y (con un proveedor de proxies) la IP de un país.',
        pt: 'A aba Dados guarda uma tabela de linhas entre execuções, com linhas novas, alteradas e que não estão mais, busca, CSV e colunas com IA. Os emails de mudanças mostram as linhas novas e as removidas. A aba Integrações envia as linhas novas para contatos ou empresas do CRM, uma planilha do Google ou uma tabela do Airtable. As listas continuam com botões Carregar mais e scroll infinito, os agendamentos descem para cada 5 minutos, as execuções em lote aceitam um CSV de até 1.000 linhas, os robôs são exportados e importados como arquivo, a galeria tem 15 modelos para sites e tarefas comuns, e as execuções podem usar o idioma, o fuso horário e (com um provedor de proxies) o IP de um país.',
      },
    ],
  },
  {
    id: '2026-10-28-board-parity',
    date: '2026-10-28',
    title: {
      en: 'Board: live multiplayer with cursors, presenting frames, AI diagrams, folders, trash and an API',
      es: 'Board: multiplayer en vivo con cursores, presentar frames, diagramas con IA, carpetas, papelera y API',
      pt: 'Board: multiplayer ao vivo com cursores, apresentar frames, diagramas com IA, pastas, lixeira e API',
    },
    items: [
      {
        product: 'board',
        en: 'Everyone on a board sees the others’ cursors, selections and strokes as they happen. Click someone to follow their view, or bring everyone to yours.',
        es: 'Todos en una pizarra ven los cursores, la selección y los trazos de los demás mientras pasan. Tocá a alguien para seguir su vista, o traé a todos a la tuya.',
        pt: 'Todos num quadro veem os cursores, a seleção e os traços dos outros na hora. Clique em alguém para seguir a visão, ou traga todos para a sua.',
      },
      {
        product: 'board',
        en: 'Present frames as full-screen slides with the keyboard, have everyone follow along, and export the frames as a PDF.',
        es: 'Presentá los frames como slides a pantalla completa con el teclado, con todos siguiéndote, y exportalos como PDF.',
        pt: 'Apresente os frames como slides em tela cheia pelo teclado, com todos acompanhando, e exporte os frames como PDF.',
      },
      {
        product: 'board',
        en: 'AI turns a description into an editable diagram, groups stickies by theme with a summary, and turns a drawn wireframe into a web page.',
        es: 'La IA convierte una descripción en un diagrama editable, agrupa stickies por tema con un resumen y pasa un wireframe dibujado a una página web.',
        pt: 'A IA transforma uma descrição em diagrama editável, agrupa post-its por tema com um resumo e transforma um wireframe desenhado numa página web.',
      },
      {
        product: 'board',
        en: 'Folders, search inside boards (from the list and Cmd+K), a 30-day trash, importing .excalidraw files and five new templates: SWOT, mind map, priority matrix, customer journey and lean canvas.',
        es: 'Carpetas, búsqueda dentro de las pizarras (en la lista y con Cmd+K), papelera de 30 días, importar archivos .excalidraw y cinco plantillas nuevas: FODA, mapa mental, matriz de prioridades, customer journey y lean canvas.',
        pt: 'Pastas, busca dentro dos quadros (na lista e com Cmd+K), lixeira de 30 dias, importar arquivos .excalidraw e cinco modelos novos: SWOT, mapa mental, matriz de prioridades, jornada do cliente e lean canvas.',
      },
      {
        product: 'board',
        en: 'A REST API and an MCP server to list, read, create and draw on boards, plus an activity log for admins with CSV export.',
        es: 'API REST y servidor MCP para listar, leer, crear y dibujar en pizarras, y un registro de actividad para admins con export a CSV.',
        pt: 'API REST e servidor MCP para listar, ler, criar e desenhar em quadros, e um registro de atividade para admins com exportação em CSV.',
      },
    ],
  },
  {
    id: '2026-10-27-notes',
    date: '2026-10-27',
    title: {
      en: 'Notes: offline, locked notes, templates, stacks, saved searches and bulk actions',
      es: 'Notes: sin conexión, notas bloqueadas, plantillas, pilas, búsquedas guardadas y acciones en lote',
      pt: 'Notes: sem conexão, notas bloqueadas, modelos, pilhas, buscas salvas e ações em lote',
    },
    items: [
      { product: 'notes', en: 'Notes work without a connection: every note stays on your device, you can open, search, edit and create notes offline, and changes sync when you are back. An edit that collides with one made elsewhere is kept as a copy. The copy is erased when you sign out.', es: 'Notes funciona sin conexión: todas las notas quedan en tu dispositivo, las abrís, buscás, editás y creás offline, y los cambios se sincronizan al volver. Un cambio que choca con otro hecho en otro lado queda como copia. La copia se borra al cerrar sesión.', pt: 'O Notes funciona sem conexão: todas as notas ficam no seu dispositivo, você abre, busca, edita e cria notas offline, e as mudanças sincronizam ao voltar. Uma edição que conflita com outra feita em outro lugar fica como cópia. A cópia é apagada ao sair.' },
      { product: 'notes', en: 'Lock a note with a password. The text is encrypted in your browser before it is saved and the password never leaves your device.', es: 'Bloqueá una nota con contraseña. El texto se cifra en tu navegador antes de guardarse y la contraseña nunca sale de tu dispositivo.', pt: 'Bloqueie uma nota com senha. O texto é criptografado no seu navegador antes de ser salvo e a senha nunca sai do seu dispositivo.' },
      { product: 'notes', en: 'New from template with nine built-in templates or your own, notebook stacks, nested tags with rename and delete, and saved searches in the sidebar and in Cmd+K.', es: 'Nueva desde plantilla con nueve plantillas de fábrica o las tuyas, pilas de libretas, etiquetas anidadas que se renombran y borran, y búsquedas guardadas en el sidebar y en Cmd+K.', pt: 'Nova a partir de modelo com nove modelos prontos ou os seus, pilhas de cadernos, etiquetas aninhadas que se renomeiam e excluem, e buscas salvas na barra lateral e no Cmd+K.' },
      { product: 'notes', en: 'Select several notes to move, tag, pin, export or trash them. Export a note, a notebook or everything to Evernote ENEX with attachments, a note to HTML, or print it to PDF.', es: 'Seleccioná varias notas para moverlas, etiquetarlas, fijarlas, exportarlas o mandarlas a la papelera. Exportá una nota, una libreta o todo a ENEX de Evernote con adjuntos, una nota a HTML, o imprimila a PDF.', pt: 'Selecione várias notas para mover, etiquetar, fixar, exportar ou mandar para a lixeira. Exporte uma nota, um caderno ou tudo para ENEX do Evernote com anexos, uma nota para HTML, ou imprima em PDF.' },
      { product: 'notes', en: 'Record audio and scan documents with the camera right into a note, the Docs AI menu inside notes, focus mode, and search matches highlighted when you open a note.', es: 'Grabá audio y escaneá documentos con la cámara directo en la nota, el menú de IA de Docs dentro de las notas, modo foco y las coincidencias de la búsqueda resaltadas al abrir una nota.', pt: 'Grave áudio e digitalize documentos com a câmera direto na nota, o menu de IA do Docs dentro das notas, modo foco e as correspondências da busca destacadas ao abrir uma nota.' },
    ],
  },
  {
    id: '2026-10-27-flow-parity',
    date: '2026-10-27',
    title: {
      en: 'Flow: drafts, run history, forms, polling triggers and AI that builds flows',
      es: 'Flow: borradores, historial de corridas, formularios, triggers por polling e IA que arma flows',
      pt: 'Flow: rascunhos, histórico de execuções, formulários, gatilhos por polling e IA que monta flows',
    },
    items: [
      { product: 'flow', en: 'Each person edits their own draft, saved automatically, and it only runs once they publish. "Test run" tries your draft with your access, and each version shows who published it.', es: 'Cada persona edita su propio borrador, que se guarda solo, y corre recién cuando lo publica. "Probar" usa tu borrador con tu acceso y cada versión muestra quién la publicó.', pt: 'Cada pessoa edita o próprio rascunho, salvo sozinho, e ele só roda quando ela publica. "Testar" usa o seu rascunho com o seu acesso e cada versão mostra quem publicou.' },
      { product: 'flow', en: 'New Run history: every run of every flow with search, filters, a usage and failures dashboard, the live queue and CSV or JSON export.', es: 'Nuevo Historial: todas las corridas de todos los flows con búsqueda, filtros, tablero de uso y fallas, la cola en vivo y exportación a CSV o JSON.', pt: 'Novo Histórico: todas as execuções de todos os flows com busca, filtros, painel de uso e falhas, a fila ao vivo e exportação em CSV ou JSON.' },
      { product: 'flow', en: 'New triggers: a hosted form with its own link, and new items from RSS feeds, JSON URLs or Google Sheets rows. Google Sheets can also look up and update rows.', es: 'Triggers nuevos: un formulario hospedado con su propio link e ítems nuevos de feeds RSS, URLs JSON o filas de Google Sheets. Google Sheets además busca y actualiza filas.', pt: 'Novos gatilhos: um formulário hospedado com link próprio e itens novos de feeds RSS, URLs JSON ou linhas do Google Sheets. O Google Sheets também procura e atualiza linhas.' },
      { product: 'flow', en: 'AI: describe a flow and it drafts the steps, an extract and classify step with structured output, and "Explain with AI" on failed runs.', es: 'IA: contá un flow y arma los pasos, un paso para extraer y clasificar con salida estructurada, y "Explicar con IA" en las corridas fallidas.', pt: 'IA: descreva um flow e ela monta os passos, um passo para extrair e classificar com saída estruturada, e "Explicar com IA" nas execuções com falha.' },
      { product: 'flow', en: 'Folders, search and filters in the list, notes on the canvas, copy and paste steps between flows, JSON export and import, cURL import and pagination in HTTP, your own variables with {{vars.name}}, and per-flow limits that hold extra runs for review or run them one at a time.', es: 'Carpetas, búsqueda y filtros en la lista, notas en el canvas, copiar y pegar pasos entre flows, exportar e importar JSON, import de cURL y paginación en HTTP, variables propias con {{vars.nombre}} y límites por flow que retienen corridas para revisar o las corren de a una.', pt: 'Pastas, busca e filtros na lista, notas no canvas, copiar e colar passos entre flows, exportar e importar JSON, import de cURL e paginação no HTTP, variáveis próprias com {{vars.nome}} e limites por flow que retêm execuções para revisar ou rodam uma de cada vez.' },
    ],
  },
  {
    id: '2026-10-27-link-parity',
    date: '2026-10-27',
    title: {
      en: 'Link: leads and sales per link, live events, phishing protection and an MCP server',
      es: 'Link: leads y ventas por link, eventos en vivo, protección contra phishing y servidor MCP',
      pt: 'Link: leads e vendas por link, eventos ao vivo, proteção contra phishing e servidor MCP',
    },
    items: [
      {
        product: 'link',
        en: 'Conversions: turn on lead and sale tracking on a link, add a small script to your site and report sign-ups and payments through the API, the workspace Stripe connection or a Shopify webhook. Analytics now show leads, sales, revenue and the funnel from clicks to sales, with a CSV export.',
        es: 'Conversiones: activá la medición de leads y ventas en un link, sumá un script chico a tu sitio y avisá registros y pagos por la API, la conexión de Stripe del workspace o un webhook de Shopify. Las analytics ahora muestran leads, ventas, ingresos y el embudo de clicks a ventas, con export CSV.',
        pt: 'Conversões: ative a medição de leads e vendas em um link, adicione um script pequeno ao seu site e informe cadastros e pagamentos pela API, pela conexão do Stripe do workspace ou por um webhook do Shopify. As analytics agora mostram leads, vendas, receita e o funil de cliques a vendas, com exportação CSV.',
      },
      {
        product: 'link',
        en: 'A live Events view with clicks, QR scans, leads and sales as they happen, an activity log of who changed each link, and questions about your analytics answered by AI.',
        es: 'Una vista de Eventos en vivo con clicks, escaneos de QR, leads y ventas a medida que pasan, un registro de quién cambió cada link y preguntas sobre tus analytics respondidas con IA.',
        pt: 'Uma visão de Eventos ao vivo com cliques, leituras de QR, leads e vendas à medida que acontecem, um registro de quem mudou cada link e perguntas sobre suas analytics respondidas por IA.',
      },
      {
        product: 'link',
        en: 'Destinations are checked against Google Safe Browsing when you create or edit a link and again every week; links that turn malicious stop redirecting and show a warning.',
        es: 'Los destinos se revisan contra Google Safe Browsing al crear o editar un link y de nuevo cada semana; si un destino pasa a ser peligroso, el link deja de redirigir y muestra un aviso.',
        pt: 'Os destinos são verificados no Google Safe Browsing ao criar ou editar um link e de novo toda semana; se um destino passa a ser perigoso, o link para de redirecionar e mostra um aviso.',
      },
      {
        product: 'link',
        en: 'Also new: link cloaking on custom domains, deferred deep linking for apps, QR frames and shared templates, bio themes with a live preview and any URL as a button, keyboard shortcuts per row (e, q, d, a, x), Slack, Zapier, Make and Segment events, imports from Rebrandly and Short.io, and an MCP server for AI agents.',
        es: 'También: link cloaking en dominios propios, deep linking diferido para apps, marcos y plantillas compartidas para el QR, temas de la bio con vista previa en vivo y cualquier URL como botón, atajos por fila (e, q, d, a, x), eventos en Slack, Zapier, Make y Segment, importación desde Rebrandly y Short.io, y un servidor MCP para agentes de IA.',
        pt: 'Também: link cloaking em domínios próprios, deep linking diferido para apps, molduras e modelos compartilhados para o QR, temas da bio com prévia ao vivo e qualquer URL como botão, atalhos por linha (e, q, d, a, x), eventos no Slack, Zapier, Make e Segment, importação do Rebrandly e do Short.io, e um servidor MCP para agentes de IA.',
      },
    ],
  },
  {
    id: '2026-10-27-docs-d5',
    date: '2026-10-27',
    title: {
      en: 'Docs: import from Confluence, Evernote and Google Docs, PDF export, your own domain and offline',
      es: 'Docs: importar desde Confluence, Evernote y Google Docs, exportar a PDF, dominio propio y sin conexión',
      pt: 'Docs: importar do Confluence, Evernote e Google Docs, exportar em PDF, domínio próprio e offline',
    },
    items: [
      { product: 'docs', en: 'Import from Notion (Markdown or HTML), Confluence spaces, Google Docs, Word with its images, Evernote notebooks and loose Markdown or HTML files, with the page tree, links between pages and files, into the workspace or a teamspace.', es: 'Importá desde Notion (Markdown o HTML), espacios de Confluence, Google Docs, Word con sus imágenes, libretas de Evernote y archivos Markdown o HTML sueltos, con el árbol, los links entre páginas y los archivos, al workspace o a un teamspace.', pt: 'Importe do Notion (Markdown ou HTML), espaços do Confluence, Google Docs, Word com suas imagens, cadernos do Evernote e arquivos Markdown ou HTML soltos, com a árvore, os links entre páginas e os arquivos, no workspace ou em um teamspace.' },
      { product: 'docs', en: 'Export a page, a page with its subpages or the whole workspace as Markdown, HTML or a PDF made on the server. Each export only carries what the person can open.', es: 'Exportá una página, una página con sus subpáginas o el workspace entero en Markdown, HTML o un PDF hecho en el servidor. Cada export lleva solo lo que la persona puede abrir.', pt: 'Exporte uma página, uma página com suas subpáginas ou o workspace inteiro em Markdown, HTML ou um PDF feito no servidor. Cada export leva só o que a pessoa pode abrir.' },
      { product: 'docs', en: 'The published site gets a custom domain, its own sitemap and robots.txt, a search description per page, visit analytics without cookies and a Duplicate button for pages you share as templates.', es: 'El sitio publicado suma dominio propio, su sitemap y robots.txt, descripción para buscadores por página, analítica de visitas sin cookies y un botón Duplicar para las páginas que compartís como plantilla.', pt: 'O site publicado ganha domínio próprio, seu sitemap e robots.txt, descrição para buscadores por página, análise de visitas sem cookies e um botão Duplicar para as páginas que você compartilha como modelo.' },
      { product: 'docs', en: 'Each page shows its views and who viewed it. On the phone the page tree is a side drawer and a touch bar above the keyboard formats, and pages open and take edits without a connection.', es: 'Cada página muestra sus vistas y quién la vio. En el celular el árbol es un cajón lateral y una barra táctil arriba del teclado da formato, y las páginas abren y se editan sin conexión.', pt: 'Cada página mostra suas visualizações e quem viu. No celular a árvore é uma gaveta lateral e uma barra de toque acima do teclado formata, e as páginas abrem e aceitam edições sem conexão.' },
    ],
  },
  {
    id: '2026-10-27-cal-parity',
    date: '2026-10-27',
    title: {
      en: 'Cal: Outlook and several calendars, Zoom and Teams per booking, SMS and meeting polls',
      es: 'Cal: Outlook y varios calendarios, Zoom y Teams por reserva, SMS y encuestas de horario',
      pt: 'Cal: Outlook e várias agendas, Zoom e Teams por reserva, SMS e enquetes de horário',
    },
    items: [
      {
        product: 'cal',
        en: 'Connect Outlook / Microsoft 365 next to Google Calendar, pick which calendars block your availability and which one gets new bookings. Zoom (with the workspace Zoom app) and Teams (with Outlook) now create a meeting per booking and move or delete it when the booking changes.',
        es: 'Conectá Outlook / Microsoft 365 además de Google Calendar, elegí qué calendarios bloquean tu disponibilidad y en cuál entran las reservas nuevas. Zoom (con la app de Zoom del workspace) y Teams (con Outlook) ahora crean una reunión por reserva y la mueven o borran cuando la reserva cambia.',
        pt: 'Conecte o Outlook / Microsoft 365 além do Google Calendar, escolha quais agendas bloqueiam sua disponibilidade e em qual entram as novas reservas. Zoom (com o app do Zoom do workspace) e Teams (com o Outlook) agora criam uma reunião por reserva e a movem ou excluem quando a reserva muda.',
      },
      {
        product: 'cal',
        en: 'Workflows fire when a meeting is booked, cancelled, rescheduled, marked as a no-show or ends, and each step can be an email, an SMS from your Twilio account or a webhook. A {{reconfirm}} link lets invitees confirm they will attend.',
        es: 'Los workflows se disparan al reservar, cancelar, reprogramar, marcar no-show o terminar la reunión, y cada paso puede ser un email, un SMS desde tu cuenta de Twilio o un webhook. Un link {{reconfirm}} deja que el invitado confirme que va.',
        pt: 'Os workflows disparam ao reservar, cancelar, remarcar, marcar no-show ou terminar a reunião, e cada etapa pode ser um e-mail, um SMS da sua conta do Twilio ou um webhook. Um link {{reconfirm}} deixa o convidado confirmar que vai.',
      },
      {
        product: 'cal',
        en: 'Meeting polls: propose times, share a link, let people vote without an account and book the winner with everyone invited. Also new: book on behalf of an invitee, secret event types, a team page with a page per person, and routing rules that check the CRM and book with the contact owner.',
        es: 'Encuestas de horario: proponé horarios, compartí un link, que voten sin cuenta y reservá el ganador con todos invitados. También: agendar en nombre de un invitado, tipos de evento secretos, página del equipo con una página por persona y reglas de routing que consultan el CRM y reservan con el owner del contacto.',
        pt: 'Enquetes de horário: proponha horários, compartilhe um link, deixe votarem sem conta e reserve o vencedor com todos convidados. Também: agendar em nome de um convidado, tipos de evento secretos, página da equipe com uma página por pessoa e regras de roteamento que consultam o CRM e reservam com o dono do contato.',
      },
      {
        product: 'cal',
        en: 'CSV export of bookings and analytics, analytics by person, a funnel per routing form, an activity log, invitee data deletion, Google Analytics and Meta Pixel on your pages, hiding “Powered by zerosoft” and an MCP server for AI assistants.',
        es: 'Export CSV de reservas y analytics, analytics por persona, embudo por routing form, registro de actividad, borrado de datos de invitados, Google Analytics y Meta Pixel en tus páginas, ocultar “Powered by zerosoft” y un servidor MCP para asistentes de IA.',
        pt: 'Exportação CSV de reservas e analytics, analytics por pessoa, funil por formulário, registro de atividades, exclusão de dados de convidados, Google Analytics e Meta Pixel nas suas páginas, ocultar “Powered by zerosoft” e um servidor MCP para assistentes de IA.',
      },
    ],
  },
  {
    id: '2026-10-27-chat-intercom',
    date: '2026-10-27',
    title: {
      en: 'Chat: team inboxes, saved views, AI for agents, email and outbound messages',
      es: 'Chat: bandejas por equipo, vistas guardadas, AI para agentes, email y mensajes salientes',
      pt: 'Chat: caixas por time, visualizações salvas, IA para agentes, email e mensagens de saída',
    },
    items: [
      { product: 'chat', en: 'Teams with their own inbox in the sidebar, rules that send conversations to a team and spread them among its members, saved views (private or shared) with counts, Follow on any conversation, and a notice when a teammate is viewing or replying to the same conversation.', es: 'Equipos con su bandeja en el sidebar, reglas que mandan conversaciones a un equipo y las reparten entre sus miembros, vistas guardadas (propias o compartidas) con su cantidad, Seguir en cualquier conversación y un aviso cuando otra persona del equipo está mirando o respondiendo la misma conversación.', pt: 'Times com caixa própria no menu lateral, regras que mandam conversas para um time e distribuem entre os membros, visualizações salvas (próprias ou compartilhadas) com contagem, Seguir em qualquer conversa e um aviso quando outra pessoa do time está vendo ou respondendo a mesma conversa.' },
      { product: 'chat', en: 'In the composer: saved replies fill {{first_name}}, {{agent_name}} and conversation attributes, and the AI menu drafts a reply from your published Docs, summarizes the thread as a note, rephrases, shortens or translates to the visitor language. Ctrl or Cmd + Shift + Y resolves.', es: 'En el compositor: las respuestas guardadas completan {{first_name}}, {{agent_name}} y los atributos de la conversación, y el menú AI redacta con tus Docs publicados, resume el hilo como nota, reformula, acorta o traduce al idioma del visitante. Ctrl o Cmd + Shift + Y resuelve.', pt: 'No compositor: as respostas salvas preenchem {{first_name}}, {{agent_name}} e os atributos da conversa, e o menu IA redige com seus Docs publicados, resume a conversa como nota, reformula, encurta ou traduz para o idioma do visitante. Ctrl ou Cmd + Shift + Y resolve.' },
      { product: 'chat', en: 'Email channel: forward your support address to the widget and answer from the inbox; replies to our emails return to the conversation when the visitor email is verified. Create or link a Track issue from a conversation, and get push notifications on your phone or a sound in the inbox.', es: 'Canal email: reenviá tu dirección de soporte al widget y respondé desde la bandeja; las respuestas a nuestros emails vuelven a la conversación si el email del visitante está verificado. Creá o vinculá un issue de Track desde una conversación, y recibí push en el celular o un sonido en la bandeja.', pt: 'Canal email: encaminhe seu endereço de suporte para o widget e responda pela caixa; as respostas aos nossos emails voltam para a conversa se o email do visitante estiver verificado. Crie ou vincule uma issue do Track pela conversa, e receba push no celular ou um som na caixa.' },
      { product: 'chat', en: 'On your site: visitors see their past conversations (across devices with a verified identity), and outbound messages or 1 to 5 surveys show up by page, time on page and audience. Reports add bot resolution, tags, widgets, teams, channels, busiest hours and SLA compliance, plus a CSV or JSON export of conversations. Cmd+K finds conversations and people.', es: 'En tu sitio: los visitantes ven sus conversaciones anteriores (en todos sus dispositivos con identidad verificada), y los mensajes salientes o encuestas de 1 a 5 aparecen por página, tiempo en la página y audiencia. Reportes suma la resolución del bot, tags, widgets, equipos, canales, horas pico y cumplimiento de SLA, y un export de conversaciones en CSV o JSON. Cmd+K encuentra conversaciones y personas.', pt: 'No seu site: os visitantes veem suas conversas anteriores (em todos os dispositivos com identidade verificada), e mensagens de saída ou pesquisas de 1 a 5 aparecem por página, tempo na página e público. Relatórios ganha resolução do bot, tags, widgets, times, canais, horários de pico e cumprimento de SLA, além de exportar conversas em CSV ou JSON. Cmd+K encontra conversas e pessoas.' },
    ],
  },
  {
    id: '2026-10-27-agents',
    date: '2026-10-27',
    title: {
      en: 'Agents: versions, files and Q&A, MCP, simulations and AI quality scores',
      es: 'Agents: versiones, archivos y preguntas frecuentes, MCP, simulaciones y puntaje de calidad con IA',
      pt: 'Agents: versões, arquivos e perguntas frequentes, MCP, simulações e nota de qualidade com IA',
    },
    items: [
      { product: 'agents', en: 'Publish a version and keep editing as a draft: the playground and tests use the draft, your live channels keep the published version, and any version can go back live. The Versions tab shows who changed what.', es: 'Publicá una versión y seguí editando como borrador: el playground y los tests usan el borrador, los canales en vivo siguen con lo publicado y cualquier versión puede volver a estar en vivo. La pestaña Versiones muestra quién cambió qué.', pt: 'Publique uma versão e continue editando como rascunho: o playground e os testes usam o rascunho, os canais ao vivo seguem com o publicado e qualquer versão pode voltar ao vivo. A aba Versões mostra quem mudou o quê.' },
      { product: 'agents', en: 'Knowledge from PDF, Word, TXT, Markdown and CSV files, questions and answers with variants and CSV import, and sitemaps of up to 300 pages. Replies cite their sources with a link, and questions the agent could not answer become one click answers.', es: 'Conocimiento desde archivos PDF, Word, TXT, Markdown y CSV, preguntas y respuestas con variantes y carga por CSV, y sitemaps de hasta 300 páginas. Las respuestas citan sus fuentes con link, y las preguntas que el agente no supo responder se contestan con un clic.', pt: 'Conhecimento a partir de arquivos PDF, Word, TXT, Markdown e CSV, perguntas e respostas com variantes e importação por CSV, e sitemaps de até 300 páginas. As respostas citam as fontes com link, e as perguntas que o agente não soube responder viram respostas com um clique.' },
      { product: 'agents', en: 'Connect MCP servers as tools, with the token encrypted and approval from an admin before any tool that changes data. Instructions per channel, a check for rules that collide, spam words and blocked countries or visitors.', es: 'Conectá servidores MCP como herramientas, con el token cifrado y la aprobación de un admin antes de cualquier herramienta que cambie datos. Instrucciones por canal, revisión de reglas que chocan, palabras de spam y países o visitantes bloqueados.', pt: 'Conecte servidores MCP como ferramentas, com o token criptografado e a aprovação de um admin antes de qualquer ferramenta que mude dados. Instruções por canal, revisão de regras que se chocam, palavras de spam e países ou visitantes bloqueados.' },
      { product: 'agents', en: 'With a signed-in visitor, the agent reads their CRM contact, Cal bookings and Track requests and remembers them between conversations. Personal data can be hidden in saved transcripts.', es: 'Con un visitante identificado, el agente lee su contacto del CRM, sus reservas de Cal y sus pedidos en Track, y lo recuerda entre conversaciones. Los datos personales se pueden tapar en los transcripts guardados.', pt: 'Com um visitante identificado, o agente lê o contato do CRM, as reservas do Cal e os pedidos no Track, e lembra dele entre conversas. Os dados pessoais podem ser ocultados nas transcrições salvas.' },
      { product: 'agents', en: 'Simulated conversations with an AI customer, replays of your last real conversations against the draft, and an AI score for every conversation (satisfaction, sentiment, topic and your scorecard) with a review queue, handoff reasons, results per channel and CSV export.', es: 'Conversaciones simuladas con un cliente AI, repetición de tus últimas conversaciones reales contra el borrador y un puntaje con AI para cada conversación (satisfacción, sentimiento, tema y tu scorecard) con cola de revisión, motivos de derivación, resultados por canal y exportación a CSV.', pt: 'Conversas simuladas com um cliente de IA, repetição das suas últimas conversas reais contra o rascunho e uma nota com IA para cada conversa (satisfação, sentimento, tema e seu scorecard) com fila de revisão, motivos de transferência, resultados por canal e exportação para CSV.' },
    ],
  },
  {
    id: '2026-10-25-voice',
    date: '2026-10-25',
    title: {
      en: 'Voice: dictation in every app and meeting notes without a bot',
      es: 'Voice: dictado en todas las apps y notas de reunión sin bot',
      pt: 'Voice: ditado em todos os apps e notas de reunião sem bot',
    },
    items: [
      { product: 'voice', en: 'Hold Alt+Space in any zerosoft text field, speak and let go: the text lands where your cursor is, with punctuation, no filler words, your spoken corrections applied and lists formatted. A personal dictionary, snippets and a style per context (email, chat, note), plus a history to copy past dictations.', es: 'Mantené Alt+Space en cualquier campo de zerosoft, hablá y soltá: el texto queda donde está el cursor, con puntuación, sin muletillas, con tus correcciones aplicadas y las listas armadas. Diccionario personal, snippets, estilo según el contexto (email, chat, nota) e historial para copiar dictados anteriores.', pt: 'Segure Alt+Space em qualquer campo do zerosoft, fale e solte: o texto fica onde está o cursor, com pontuação, sem vícios de linguagem, com suas correções aplicadas e as listas montadas. Dicionário pessoal, snippets, estilo conforme o contexto (email, chat, nota) e histórico para copiar ditados anteriores.' },
      { product: 'voice', en: 'Meeting notes: record your microphone, or your microphone and a browser tab, with a live transcript split into Me and Them. Jot notes as you go and AI writes them up with a template (sales, 1:1, stand-up, interview, customer or your own), with a summary, decisions and next steps that become Track issues or CRM tasks.', es: 'Notas de reunión: grabá tu micrófono, o tu micrófono y una pestaña, con transcripción en vivo separada en Yo y Ellos. Anotá mientras tanto y la IA arma la nota con una plantilla (ventas, 1:1, daily, entrevista, cliente o una propia), con resumen, decisiones y próximos pasos que pasan a issues de Track o tareas del CRM.', pt: 'Notas de reunião: grave seu microfone, ou o microfone e uma aba, com transcrição ao vivo separada em Eu e Eles. Anote enquanto isso e a IA monta a nota com um modelo (vendas, 1:1, daily, entrevista, cliente ou um próprio), com resumo, decisões e próximos passos que viram issues do Track ou tarefas do CRM.' },
      { product: 'voice', en: 'Ask a meeting or all of them ("what did Ana say about pricing?"), search across transcripts, link a Cal booking so the notes land on the CRM contact timeline, and send the notes to Docs or Notes. API v1 endpoints with the voice:read and voice:write scopes, and the source of a desktop app for Mac and Windows.', es: 'Preguntale a una reunión o a todas ("¿qué dijo Ana del precio?"), buscá en las transcripciones, vinculá una reserva de Cal para que la nota quede en el timeline del contacto del CRM y mandá la nota a Docs o Notes. Endpoints de la API v1 con los scopes voice:read y voice:write, y el código de una app de escritorio para Mac y Windows.', pt: 'Pergunte a uma reunião ou a todas ("o que a Ana disse sobre o preço?"), busque nas transcrições, vincule uma reserva do Cal para a nota ficar na linha do tempo do contato do CRM e envie a nota para Docs ou Notes. Endpoints da API v1 com os escopos voice:read e voice:write, e o código de um app desktop para Mac e Windows.' },
    ],
  },
  {
    id: '2026-10-25-docs-platform',
    date: '2026-10-25',
    title: {
      en: 'Docs: AI in the editor, questions across your pages, meeting notes, synced databases and an API',
      es: 'Docs: IA en el editor, preguntas sobre tus páginas, notas de reunión, bases sincronizadas y una API',
      pt: 'Docs: IA no editor, perguntas sobre suas páginas, notas de reunião, bancos sincronizados e uma API',
    },
    items: [
      { product: 'docs', en: 'Press Space on an empty line, pick Ask AI on a selection or type /ai to continue writing, summarize, improve, fix spelling, shorten, lengthen, simplify, change the tone, translate or explain. The result shows as a preview you replace, insert below, try again or discard.', es: 'Apretá Espacio en una línea vacía, elegí Preguntarle a la IA sobre una selección o escribí /ai para seguir escribiendo, resumir, mejorar, corregir la ortografía, acortar, alargar, simplificar, cambiar el tono, traducir o explicar. El resultado se ve como vista previa que reemplazás, insertás debajo, volvés a pedir o descartás.', pt: 'Pressione Espaço em uma linha vazia, escolha Perguntar à IA sobre uma seleção ou digite /ai para continuar escrevendo, resumir, melhorar, corrigir a ortografia, encurtar, alongar, simplificar, mudar o tom, traduzir ou explicar. O resultado aparece como prévia que você substitui, insere abaixo, pede de novo ou descarta.' },
      { product: 'docs', en: 'Ask AI in the band, the sidebar or ⌘K answers questions with the pages you can open and links each source.', es: 'Preguntarle a la IA, en la banda, el sidebar o ⌘K, responde preguntas con las páginas que podés abrir y enlaza cada fuente.', pt: 'Perguntar à IA, na faixa, na barra lateral ou no ⌘K, responde perguntas com as páginas que você pode abrir e linka cada fonte.' },
      { product: 'docs', en: 'The /meeting block transcribes your microphone and the tab of a call in the browser, or takes a pasted transcript, and writes the summary, decisions and action items. Action items go to Track as issues or to the CRM as tasks.', es: 'El bloque /reunión transcribe tu micrófono y la pestaña de una llamada en el navegador, o toma una transcripción pegada, y escribe el resumen, las decisiones y las tareas. Las tareas van a Track como issues o al CRM como tareas.', pt: 'O bloco /reunião transcreve seu microfone e a aba de uma chamada no navegador, ou recebe uma transcrição colada, e escreve o resumo, as decisões e as tarefas. As tarefas vão para o Track como issues ou para o CRM como tarefas.' },
      { product: 'docs', en: 'Synced databases bring GitHub issues or pull requests, Jira issues, Salesforce records or CRM deals, contacts and companies into a read-only database that refreshes on its own.', es: 'Las bases sincronizadas traen issues o pull requests de GitHub, issues de Jira, registros de Salesforce o deals, contactos y empresas del CRM a una base de solo lectura que se actualiza sola.', pt: 'Os bancos sincronizados trazem issues ou pull requests do GitHub, issues do Jira, registros do Salesforce ou negócios, contatos e empresas do CRM para um banco somente leitura que se atualiza sozinho.' },
      { product: 'docs', en: 'A public API for pages, blocks, databases, rows, search and comments with docs:read and docs:write keys, webhooks for page and database events, and an MCP server for Claude, Cursor and other AI tools.', es: 'Una API pública para páginas, bloques, bases, filas, búsqueda y comentarios con keys docs:read y docs:write, webhooks para los eventos de páginas y bases, y un servidor MCP para Claude, Cursor y otras herramientas de IA.', pt: 'Uma API pública para páginas, blocos, bancos, linhas, busca e comentários com keys docs:read e docs:write, webhooks para os eventos de páginas e bancos, e um servidor MCP para Claude, Cursor e outras ferramentas de IA.' },
      { product: 'flow', en: 'Flows start when a page is edited, trashed or commented, or when a database row is added or a property changes, and new steps create a page from a template, add to or rename one, and add or update rows.', es: 'Los flows arrancan cuando se edita, se manda a la papelera o se comenta una página, o cuando se agrega una fila o cambia una propiedad de una base, y los pasos nuevos crean una página desde una plantilla, le agregan contenido o la renombran, y agregan o actualizan filas.', pt: 'Os flows começam quando uma página é editada, vai para a lixeira ou recebe um comentário, ou quando uma linha é adicionada ou uma propriedade muda em um banco, e os passos novos criam uma página a partir de um modelo, adicionam conteúdo ou a renomeiam, e adicionam ou atualizam linhas.' },
      { product: 'agents', en: 'Agents can read, write and create pages and database rows inside the Docs pages you pick, with approval if you want it.', es: 'Los agentes pueden leer, escribir y crear páginas y filas dentro de las páginas de Docs que elijas, con aprobación si la querés.', pt: 'Os agentes podem ler, escrever e criar páginas e linhas dentro das páginas do Docs que você escolher, com aprovação se quiser.' },
    ],
  },
  {
    id: '2026-10-25-rec',
    date: '2026-10-25',
    title: {
      en: 'Rec: record your screen and camera, share with a link',
      es: 'Rec: grabá tu pantalla y tu cámara, compartí con un link',
      pt: 'Rec: grave sua tela e sua câmera, compartilhe com um link',
    },
    items: [
      { product: 'rec', en: 'Record screen and camera, screen only or camera only from the browser, with a camera bubble you drag and resize, microphone picker, countdown and pause. The video uploads in parts while you record and the link is copied when you stop.', es: 'Grabás pantalla y cámara, solo pantalla o solo cámara desde el navegador, con una burbuja de cámara que se arrastra y se agranda, selector de micrófono, cuenta regresiva y pausa. El video se sube por partes mientras grabás y el link queda copiado al cortar.', pt: 'Grave tela e câmera, só a tela ou só a câmera pelo navegador, com uma bolha de câmera que se arrasta e aumenta, seletor de microfone, contagem regressiva e pausa. O vídeo é enviado em partes enquanto você grava e o link fica copiado ao parar.' },
      { product: 'rec', en: 'Each video has its page at /v/<id>: player with speed, captions and chapters, timestamped comments and reactions, a call to action, password, expiry, workspace-only access and an embed code.', es: 'Cada video tiene su página en /v/<id>: reproductor con velocidad, subtítulos y capítulos, comentarios y reacciones con el segundo, llamada a la acción, contraseña, vencimiento, acceso solo del workspace y código para insertar.', pt: 'Cada vídeo tem sua página em /v/<id>: player com velocidade, legendas e capítulos, comentários e reações no segundo, chamada para ação, senha, expiração, acesso só do workspace e código para incorporar.' },
      { product: 'rec', en: 'Views, unique viewers, percent watched and who watched (signed in), with CSV export and a notification on the first view and each comment. Transcript, title, summary and chapters with AI when a transcription provider is configured. Trim, thumbnail, folders and a space shared with the workspace.', es: 'Vistas, espectadores únicos, porcentaje visto y quién lo vio (con sesión), con export a CSV y aviso en la primera vista y en cada comentario. Transcripción, título, resumen y capítulos con IA cuando hay un proveedor de transcripción configurado. Recorte, miniatura, carpetas y un espacio compartido con el workspace.', pt: 'Visualizações, espectadores únicos, porcentagem assistida e quem assistiu (com sessão), com exportação CSV e aviso na primeira visualização e em cada comentário. Transcrição, título, resumo e capítulos com IA quando há um provedor de transcrição configurado. Corte, miniatura, pastas e um espaço compartilhado com o workspace.' },
      { product: 'crm', en: 'The 1:1 videos of the CRM use the Rec recorder: screen with the camera bubble, microphone picker, countdown and pause, and the duration written into the file so viewers can skip ahead.', es: 'Los videos 1:1 del CRM usan el grabador de Rec: pantalla con la burbuja de cámara, selector de micrófono, cuenta regresiva y pausa, y la duración escrita en el archivo para que se pueda adelantar.', pt: 'Os vídeos 1:1 do CRM usam o gravador do Rec: tela com a bolha da câmera, seletor de microfone, contagem regressiva e pausa, e a duração escrita no arquivo para dar para avançar.' },
    ],
  },
  {
    id: '2026-10-25-talk',
    date: '2026-10-25',
    title: {
      en: 'Talk: team messaging with channels, DMs and threads',
      es: 'Talk: mensajería de equipo con canales, DMs e hilos',
      pt: 'Talk: mensagens de equipe com canais, DMs e fios',
    },
    items: [
      { product: 'talk', en: 'Talk opens at /app/talk with public and private channels (create, join, leave, topic, description, members, archive and delete), direct messages and group DMs, threads with "also send to the channel", reactions, editing and deleting, pinned messages and a directory of channels.', es: 'Talk abre en /app/talk con canales públicos y privados (crear, unirse, salir, tema, descripción, miembros, archivar y borrar), mensajes directos y grupales, hilos con "también enviar al canal", reacciones, editar y borrar, mensajes fijados y un directorio de canales.', pt: 'O Talk abre em /app/talk com canais públicos e privados (criar, entrar, sair, tema, descrição, membros, arquivar e apagar), mensagens diretas e em grupo, fios com "também enviar ao canal", reações, editar e apagar, mensagens fixadas e um diretório de canais.' },
      { product: 'talk', en: 'The editor formats like Slack (bold, italic, strikethrough, code, lists, quotes, links, :emoji:), suggests @people, @channel, @here, teams and #channels, attaches files and images, keeps drafts, schedules messages and understands /remind me in 1h.', es: 'El editor formatea como Slack (negrita, itálica, tachado, código, listas, citas, links, :emoji:), sugiere @personas, @canal, @aquí, equipos y #canales, adjunta archivos e imágenes, guarda borradores, programa mensajes y entiende /recordar en 1h.', pt: 'O editor formata como o Slack (negrito, itálico, tachado, código, listas, citações, links, :emoji:), sugere @pessoas, @canal, @aqui, equipes e #canais, anexa arquivos e imagens, guarda rascunhos, agenda mensagens e entende /lembrar em 1h.' },
      { product: 'talk', en: 'Messages arrive in real time, with typing and presence. Unreads and mentions per channel, Threads, Mentions, Later (saved and reminders) and Files views, search with in:, from:, has:, is: and dates, notifications in the bell and by email, and status with expiry.', es: 'Los mensajes llegan en tiempo real, con quién está escribiendo y presencia. Sin leer y menciones por canal, vistas de Hilos, Menciones, Más tarde (guardados y recordatorios) y Archivos, búsqueda con in:, from:, has:, is: y fechas, avisos en la campana y por email, y estado con vencimiento.', pt: 'As mensagens chegam em tempo real, com quem está digitando e presença. Não lidas e menções por canal, visões de Fios, Menções, Mais tarde (salvas e lembretes) e Arquivos, busca com in:, from:, has:, is: e datas, avisos no sino e por e-mail, e status com validade.' },
      { product: 'talk', en: 'Links to Track issues, CRM deals and Docs pages show a card with their state to whoever can open them, a message becomes a Track issue in three clicks, Flow gets a "message in a channel" trigger and a "send message" action, and there are incoming webhooks and an API (talk:read, talk:write).', es: 'Los links a issues de Track, deals del CRM y páginas de Docs muestran una tarjeta con su estado a quien los puede abrir, un mensaje pasa a issue de Track en tres clics, Flow suma el disparador "mensaje en un canal" y la acción "enviar mensaje", y hay webhooks entrantes y API (talk:read, talk:write).', pt: 'Links para issues do Track, negócios do CRM e páginas do Docs mostram um cartão com o status para quem pode abri-los, uma mensagem vira issue do Track em três cliques, o Flow ganha o gatilho "mensagem em um canal" e a ação "enviar mensagem", e há webhooks de entrada e API (talk:read, talk:write).' },
    ],
  },
  {
    id: '2026-10-25-track-keyboard-round-3',
    date: '2026-10-25',
    title: {
      en: 'Track: the keyboard cursor follows the issue, milestones from the issue and estimates per team',
      es: 'Track: el cursor del teclado sigue al issue, milestones desde el issue y estimaciones por equipo',
      pt: 'Track: o cursor do teclado segue o issue, milestones a partir do issue e estimativas por equipe',
    },
    items: [
      { product: 'track', en: 'After S, P or ⌘Z the keyboard cursor stays on the same issue even when it moves to another group, and goes to the next one after a delete. Esc on an issue goes back to the list it came from.', es: 'Después de S, P o ⌘Z el cursor del teclado queda en el mismo issue aunque cambie de grupo, y pasa al siguiente si se borra. Esc en un issue vuelve a la lista de la que vino.', pt: 'Depois de S, P ou ⌘Z o cursor do teclado fica no mesmo issue mesmo quando muda de grupo, e passa para o próximo se for apagado. Esc num issue volta para a lista de onde veio.' },
      { product: 'track', en: '⌘⇧O opens the composer with the parent set, or Set parent when several issues are selected; ⌘⇧↵ creates and keeps the same properties; the composer attaches files and can send to triage; a comment becomes a sub-issue you can edit first.', es: '⌘⇧O abre el composer con el padre puesto, o Elegir padre si hay varios seleccionados; ⌘⇧↵ crea y mantiene las mismas propiedades; el composer adjunta archivos y puede mandar a triage; un comentario se vuelve un sub-issue que se edita antes de crear.', pt: '⌘⇧O abre o composer com o pai definido, ou Escolher pai quando há vários selecionados; ⌘⇧↵ cria e mantém as mesmas propriedades; o composer anexa arquivos e pode enviar para o triage; um comentário vira um sub-issue editável antes de criar.' },
      { product: 'track', en: 'Project milestones are set from the issue, ⇧C puts the current cycle first, ⌘K finds views, cycles, milestones and labels, and each team picks its estimate scale (Fibonacci, linear, exponential or t-shirt sizes).', es: 'Los milestones del proyecto se eligen desde el issue, ⇧C pone primero el cycle actual, ⌘K encuentra vistas, cycles, milestones y labels, y cada equipo elige su escala de estimación (Fibonacci, lineal, exponencial o talles).', pt: 'Os milestones do projeto são escolhidos no issue, ⇧C coloca primeiro o cycle atual, ⌘K encontra visualizações, cycles, milestones e labels, e cada equipe escolhe sua escala de estimativa (Fibonacci, linear, exponencial ou tamanhos).' },
      { product: 'track', en: 'Sub-issues nest under their parent in lists, board cards follow Display, statuses use the Linear colors, projects take labels and new projects are set with chips.', es: 'Los sub-issues se anidan bajo el padre en las listas, las tarjetas del tablero siguen a Display, los estados usan los colores de Linear, los proyectos tienen labels y los proyectos nuevos se arman con chips.', pt: 'Os sub-issues se aninham sob o pai nas listas, os cartões do quadro seguem o Display, os status usam as cores do Linear, os projetos têm labels e os projetos novos são criados com chips.' },
    ],
  },
  {
    id: '2026-10-25-track-keyboard-menus',
    date: '2026-10-25',
    title: {
      en: 'Track: menus you type into, a cleaner issue page and a composer with chips',
      es: 'Track: menús que se manejan tipeando, una página del issue más limpia y un composer con chips',
      pt: 'Track: menus que se usam digitando, uma página do issue mais limpa e um composer com chips',
    },
    items: [
      { product: 'track', en: 'Every property menu (status, priority, assignee, labels, project, cycle, estimate, dates, parent) filters as you type, works with arrows and Enter, shows the same icons as the list and creates what you type when it does not exist: L with a new name creates the label and ⇧P creates a project. Priority picks with 0 to 4 and has No priority, status picks with 1 to 9.', es: 'Cada menú de propiedad (estado, prioridad, asignado, labels, proyecto, cycle, estimación, fechas, padre) filtra mientras tipeás, se maneja con flechas y Enter, muestra los mismos íconos que la lista y crea lo que tipeaste si no existe: L con un nombre nuevo crea el label y ⇧P crea un proyecto. Prioridad se elige con 0 a 4 y tiene Sin prioridad; estado, con 1 a 9.', pt: 'Cada menu de propriedade (status, prioridade, responsável, labels, projeto, cycle, estimativa, datas, pai) filtra enquanto você digita, funciona com setas e Enter, mostra os mesmos ícones da lista e cria o que você digitou se não existir: L com um nome novo cria o label e ⇧P cria um projeto. Prioridade se escolhe com 0 a 4 e tem Sem prioridade; status, com 1 a 9.' },
      { product: 'track', en: 'The issue page has a narrow properties column where each value opens its menu right below it, a header with previous and next (J and K), copy link, reminder and subscribe icons, and sections that only show up when they have something (links, customer requests, summary), added from the menu under the description.', es: 'La página del issue tiene una columna angosta de propiedades donde cada valor abre su menú justo debajo, un header con anterior y siguiente (J y K), copiar link, recordatorio y suscripción como íconos, y secciones que aparecen solo si tienen algo (links, pedidos de clientes, resumen), que se agregan desde el menú bajo la descripción.', pt: 'A página do issue tem uma coluna estreita de propriedades onde cada valor abre o menu logo abaixo, um header com anterior e próximo (J e K), copiar link, lembrete e inscrição como ícones, e seções que só aparecem quando têm algo (links, pedidos de clientes, resumo), adicionadas pelo menu sob a descrição.' },
      { product: 'track', en: 'Sub-issues show the progress of their parent, rows read status, ID, title and assignee with a menu per row, and the section has options to show properties, hide completed and change the order. Undoing Remove parent brings the breadcrumb back right away.', es: 'Los sub-issues muestran el progreso del padre, las filas van estado, ID, título y asignado con un menú por fila, y la sección tiene opciones para mostrar propiedades, ocultar completados y cambiar el orden. Deshacer Quitar padre trae el breadcrumb al instante.', pt: 'Os sub-issues mostram o progresso do pai, as linhas vão status, ID, título e responsável com um menu por linha, e a seção tem opções para mostrar propriedades, ocultar concluídos e mudar a ordem. Desfazer Remover pai traz o breadcrumb na hora.' },
      { product: 'track', en: 'New issue composer with compact chips for status, priority (No priority by default), assignee, labels, project, cycle, estimate and due date, plus parent, start date and template. Esc keeps the draft and the next C brings it back.', es: 'Composer de issues con chips compactos para estado, prioridad (Sin prioridad por defecto), asignado, labels, proyecto, cycle, estimación y vencimiento, más padre, fecha de inicio y plantilla. Esc guarda el borrador y la próxima C lo trae.', pt: 'Composer de issues com chips compactos para status, prioridade (Sem prioridade por padrão), responsável, labels, projeto, cycle, estimativa e prazo, além de pai, data de início e modelo. Esc guarda o rascunho e o próximo C o traz de volta.' },
      { product: 'track', en: 'Issue links use the identifier (/track/issue/MOB-12/title), the old ID of an issue moved to another team still opens it and is found with ⌘K, team keys are three letters (MOB) and unique per workspace, ⌘⌫ deletes the row under the cursor and a single property change no longer shows a toast (⌘Z still undoes it).', es: 'Los links de issues usan el identificador (/track/issue/MOB-12/titulo), el ID viejo de un issue movido de equipo lo sigue abriendo y se encuentra con ⌘K, las claves de equipo son de tres letras (MOB) y únicas por workspace, ⌘⌫ borra la fila bajo el cursor y un cambio de una propiedad ya no muestra aviso (⌘Z lo sigue deshaciendo).', pt: 'Os links de issues usam o identificador (/track/issue/MOB-12/titulo), o ID antigo de um issue movido de equipe continua abrindo e é encontrado com ⌘K, as chaves de equipe têm três letras (MOB) e são únicas por workspace, ⌘⌫ apaga a linha sob o cursor e uma mudança de uma propriedade não mostra mais aviso (⌘Z continua desfazendo).' },
      { product: 'track', en: 'Lists group by status with collapsible headers, Display gathers layout, grouping, order and visible properties, the filter menu works with the keyboard, triage shows the list and the open issue side by side, and project pages edit their properties, description and updates in place. The editor adds collapsible sections (>>>), callouts and descriptions of up to 200,000 characters.', es: 'Las listas agrupan por estado con encabezados plegables, Display junta vista, agrupación, orden y propiedades visibles, el menú de filtros se maneja con teclado, triage muestra la lista y el issue abierto lado a lado, y las páginas de proyectos editan propiedades, descripción y updates en el lugar. El editor suma secciones plegables (>>>), callouts y descripciones de hasta 200.000 caracteres.', pt: 'As listas agrupam por status com cabeçalhos recolhíveis, Display reúne visualização, agrupamento, ordem e propriedades visíveis, o menu de filtros funciona pelo teclado, o triage mostra a lista e o issue aberto lado a lado, e as páginas de projetos editam propriedades, descrição e updates no lugar. O editor ganha seções recolhíveis (>>>), callouts e descrições de até 200.000 caracteres.' },
    ],
  },
  {
    id: '2026-10-25-track-polish',
    date: '2026-10-25',
    title: {
      en: 'Track speaks Linear: teams, projects and a visual editor',
      es: 'Track habla como Linear: equipos, proyectos y un editor visual',
      pt: 'Track fala como o Linear: equipes, projetos e um editor visual',
    },
    items: [
      { product: 'track', en: 'Names like Linear: what was a project is now a team (key, statuses and cycles, at /track/team/WEB) and plans are now projects. Old links keep working, and the API and MCP accept teamId and /teams.', es: 'Nombres como en Linear: lo que era un proyecto ahora es un equipo (clave, estados y cycles, en /track/team/WEB) y los planes ahora son proyectos. Los links viejos siguen andando, y la API y el MCP aceptan teamId y /teams.', pt: 'Nomes como no Linear: o que era um projeto agora é uma equipe (chave, status e cycles, em /track/team/WEB) e os planos agora são projetos. Os links antigos continuam funcionando, e a API e o MCP aceitam teamId e /teams.' },
      { product: 'track', en: 'Descriptions and comments are edited in place, without a preview tab: headings, lists, checklists, quotes and code turn into blocks as you type, / inserts blocks, @ and # mention people and issues, and pasted images show up right away.', es: 'Las descripciones y los comentarios se editan en el lugar, sin pestaña de vista previa: títulos, listas, tareas, citas y código se arman mientras escribís, / inserta bloques, @ y # mencionan personas e issues, y las imágenes pegadas se ven al instante.', pt: 'As descrições e os comentários são editados no lugar, sem aba de prévia: títulos, listas, tarefas, citações e código se formam enquanto você digita, / insere blocos, @ e # mencionam pessoas e issues, e as imagens coladas aparecem na hora.' },
      { product: 'track', en: 'Set the project of an issue from its page or the quick view with ⇧P, move it to another team with ⌘⇧M (new identifier, sub-issues included), archive it from ⌘K and restore it from the banner, and redo with ⌘⇧Z.', es: 'Elegí el proyecto de un issue desde su página o la vista rápida con ⇧P, movelo a otro equipo con ⌘⇧M (identificador nuevo, con sus sub-issues), archivalo desde ⌘K y restauralo desde el aviso, y rehacé con ⌘⇧Z.', pt: 'Escolha o projeto de um issue na página dele ou na visualização rápida com ⇧P, mova-o para outra equipe com ⌘⇧M (identificador novo, com os sub-issues), arquive pelo ⌘K e restaure pelo aviso, e refaça com ⌘⇧Z.' },
      { product: 'track', en: 'Denser lists like Linear (priority, ID, status, title, labels, date and assignee on one line), a sidebar with Inbox, My issues and your teams with their Issues, Cycles, Projects and Views, and new teams archive closed issues after 6 months.', es: 'Listas más densas como en Linear (prioridad, ID, estado, título, labels, fecha y asignado en una línea), un sidebar con Bandeja, Mis issues y tus equipos con sus Issues, Cycles, Proyectos y Vistas, y los equipos nuevos archivan lo cerrado a los 6 meses.', pt: 'Listas mais densas como no Linear (prioridade, ID, status, título, labels, data e responsável numa linha), uma barra lateral com Caixa de entrada, Meus issues e suas equipes com Issues, Cycles, Projetos e Visualizações, e as equipes novas arquivam o que foi fechado após 6 meses.' },
    ],
  },
  {
    id: '2026-10-25-track-linear',
    date: '2026-10-25',
    title: {
      en: 'Track: keyboard-first like Linear, sub-issues, filters with rules and live updates',
      es: 'Track: todo con el teclado como en Linear, sub-issues, filtros con reglas y cambios en vivo',
      pt: 'Track: tudo pelo teclado como no Linear, sub-issues, filtros com regras e mudanças ao vivo',
    },
    items: [
      { product: 'track', en: 'Single-key shortcuts on the hovered row, the selection or the open issue: S status, P priority, A assignee, I assign to me, L labels, ⇧E estimate, ⇧D due date, ⇧C cycle, ⇧1 to ⇧4 priority, ⌘. copy ID, ⌘⇧. copy branch. ⌘K lists the same actions for what you are looking at, plus set or remove the parent and create a sub-issue.', es: 'Atajos de una tecla sobre la fila bajo el mouse, la selección o el issue abierto: S estado, P prioridad, A asignado, I asignarme, L labels, ⇧E estimación, ⇧D vencimiento, ⇧C cycle, ⇧1 a ⇧4 prioridad, ⌘. copiar ID, ⌘⇧. copiar rama. ⌘K muestra las mismas acciones sobre lo que estás mirando, más elegir o quitar el padre y crear un sub-issue.', pt: 'Atalhos de uma tecla na linha sob o mouse, na seleção ou no issue aberto: S status, P prioridade, A responsável, I atribuir a mim, L labels, ⇧E estimativa, ⇧D prazo, ⇧C cycle, ⇧1 a ⇧4 prioridade, ⌘. copiar ID, ⌘⇧. copiar branch. ⌘K mostra as mesmas ações sobre o que você está vendo, além de escolher ou remover o pai e criar um sub-issue.' },
      { product: 'track', en: '⌘Z undoes the last change (properties, bulk edits, deletes) and every change shows an Undo toast. A deleted issue comes back if you undo within a few seconds.', es: '⌘Z deshace el último cambio (propiedades, ediciones en lote, borrados) y cada cambio muestra un aviso con Deshacer. Un issue borrado vuelve si deshacés en los primeros segundos.', pt: '⌘Z desfaz a última mudança (propriedades, edições em lote, exclusões) e cada mudança mostra um aviso com Desfazer. Um issue excluído volta se você desfizer nos primeiros segundos.' },
      { product: 'track', en: 'Issue page redesigned: compact properties panel with icons, breadcrumb with the parent and a Sub-issues section with progress, inline creation (Enter for the next one, paste a list for several), status, priority and assignee editable in place, drag to reorder and add an existing issue.', es: 'Página del issue nueva: panel de propiedades compacto con íconos, breadcrumb con el padre y una sección de Sub-issues con progreso, alta en línea (Enter para el siguiente, pegar una lista para varios), estado, prioridad y asignado editables en el lugar, arrastrar para ordenar y agregar un issue existente.', pt: 'Página do issue nova: painel de propriedades compacto com ícones, breadcrumb com o pai e uma seção de Sub-issues com progresso, criação em linha (Enter para o próximo, colar uma lista para vários), status, prioridade e responsável editáveis no lugar, arrastar para ordenar e adicionar um issue existente.' },
      { product: 'track', en: 'Filters with rules: press F, pick any property (status, priority, assignee, creator, labels, cycle, milestone, estimate, dates, relations, sub-issues) with is, is not, empty or before and after, and match all or any. Filters live in the URL, and lists show sub-issues under their parent or hide them.', es: 'Filtros con reglas: apretá F, elegí cualquier propiedad (estado, prioridad, asignado, creador, labels, cycle, milestone, estimación, fechas, relaciones, sub-issues) con es, no es, vacío o antes y después, y que se cumplan todos o alguno. Los filtros viajan en la URL y las listas muestran los sub-issues bajo su padre u ocultos.', pt: 'Filtros com regras: aperte F, escolha qualquer propriedade (status, prioridade, responsável, criador, labels, cycle, milestone, estimativa, datas, relações, sub-issues) com é, não é, vazio ou antes e depois, e cumprir todos ou algum. Os filtros ficam na URL e as listas mostram os sub-issues sob o pai ou ocultos.' },
      { product: 'track', en: 'Saved views can be shared with the team, marked as favorites (they show in the sidebar), updated with the current filters and opened from a link.', es: 'Las vistas guardadas se pueden compartir con el equipo, marcar como favoritas (aparecen en el sidebar), actualizar con los filtros actuales y abrir desde un link.', pt: 'As visualizações salvas podem ser compartilhadas com a equipe, marcadas como favoritas (aparecem na barra lateral), atualizadas com os filtros atuais e abertas por um link.' },
      { product: 'track', en: 'Editor: lists and checklists continue with Enter, Tab nests, / inserts headings, checklists, code blocks, quotes and tables, @ mentions people and issues, # links an issue, pasted images upload as attachments, checklists can be ticked while reading, code is highlighted and issue IDs show their status.', es: 'Editor: listas y tareas siguen con Enter, Tab anida, / inserta títulos, tareas, bloques de código, citas y tablas, @ menciona personas e issues, # enlaza un issue, las imágenes pegadas se suben como adjunto, las tareas se tildan leyendo, el código se resalta y los IDs de issue muestran su estado.', pt: 'Editor: listas e tarefas continuam com Enter, Tab aninha, / insere títulos, tarefas, blocos de código, citações e tabelas, @ menciona pessoas e issues, # vincula um issue, imagens coladas viram anexos, tarefas são marcadas durante a leitura, o código é destacado e os IDs de issue mostram o status.' },
      { product: 'track', en: 'Comments have emoji reactions, replies in threads, and threads you can resolve and reopen.', es: 'Los comentarios tienen reacciones con emoji, respuestas en hilo e hilos que se resuelven y se reabren.', pt: 'Os comentários têm reações com emoji, respostas em thread e threads que podem ser resolvidas e reabertas.' },
      { product: 'track', en: 'Lists, board and the issue page pick up changes from teammates every few seconds without reloading, and the issue shows who else has it open.', es: 'Lista, tablero y la página del issue toman los cambios del equipo cada pocos segundos sin recargar, y el issue muestra quién más lo tiene abierto.', pt: 'Lista, quadro e a página do issue recebem as mudanças da equipe a cada poucos segundos sem recarregar, e o issue mostra quem mais está com ele aberto.' },
    ],
  },
  {
    id: '2026-10-25-track-planning',
    date: '2026-10-25',
    title: {
      en: 'Track: plans, initiatives, roadmap, cycle metrics, insights and dashboards',
      es: 'Track: planes, iniciativas, roadmap, métricas de cycles, insights y dashboards',
      pt: 'Track: planos, iniciativas, roadmap, métricas de cycles, insights e dashboards',
    },
    items: [
      { product: 'track', en: 'Plans, like Linear projects: lead, members, teams, status, priority, start and target dates, a description, milestones and progress from their issues. Each plan has Overview, Issues and Updates, and the list groups by status or lead with filters in the URL.', es: 'Planes, como los projects de Linear: lead, miembros, equipos, estado, prioridad, inicio y fecha objetivo, descripción, milestones y progreso según sus issues. Cada plan tiene Resumen, Issues y Updates, y la lista agrupa por estado o lead con filtros en la URL.', pt: 'Planos, como os projects do Linear: lead, membros, equipes, status, prioridade, início e data-alvo, descrição, milestones e progresso pelos issues. Cada plano tem Visão geral, Issues e Updates, e a lista agrupa por status ou lead com filtros na URL.' },
      { product: 'track', en: 'Plan updates with health (on track, at risk, off track), progress since the last one, comments and a history of date, lead and status changes. The lead gets a weekly or biweekly reminder in the Inbox, and members and followers get each update.', es: 'Updates de planes con salud (en camino, en riesgo, desviado), el progreso desde el anterior, comentarios e historial de cambios de fechas, lead y estado. El lead recibe un recordatorio semanal o cada dos semanas en el Inbox, y miembros y seguidores reciben cada update.', pt: 'Updates de planos com saúde (no caminho, em risco, fora do caminho), progresso desde o anterior, comentários e histórico de mudanças de datas, lead e status. O lead recebe um lembrete semanal ou quinzenal na Inbox, e membros e seguidores recebem cada update.' },
      { product: 'track', en: 'Initiatives group plans and sub-initiatives under one goal, with owner, status, target date, combined progress and the health of their active plans.', es: 'Las iniciativas agrupan planes y sub-iniciativas detrás de un objetivo, con responsable, estado, fecha objetivo, progreso sumado y la salud de sus planes en curso.', pt: 'As iniciativas agrupam planos e sub-iniciativas sob um objetivo, com responsável, status, data-alvo, progresso somado e a saúde dos planos em andamento.' },
      { product: 'track', en: 'Roadmap: plans or initiatives on a timeline by weeks, months or quarters, with milestones, a today line and grouping by initiative, status or lead. Drag a bar or its edges to change dates.', es: 'Roadmap: planes o iniciativas en una línea de tiempo por semanas, meses o trimestres, con milestones, la línea de hoy y agrupado por iniciativa, estado o lead. Arrastrá una barra o sus bordes para cambiar las fechas.', pt: 'Roadmap: planos ou iniciativas numa linha do tempo por semanas, meses ou trimestres, com milestones, a linha de hoje e agrupamento por iniciativa, status ou lead. Arraste uma barra ou as bordas para mudar as datas.' },
      { product: 'track', en: 'Cycle metrics: a burn-up of scope, started and completed, issues added after the start, what rolled over, velocity of the last three cycles and capacity. Cycles that end now close on their own and move unfinished issues to the next one.', es: 'Métricas de cycles: burn-up de alcance, empezados y terminados, lo agregado después del inicio, lo que pasó al siguiente, velocidad de los últimos tres cycles y capacidad. Los cycles que terminan ahora se cierran solos y pasan lo pendiente al siguiente.', pt: 'Métricas de cycles: burn-up de escopo, iniciados e concluídos, o que entrou depois do início, o que passou para o próximo, velocidade dos últimos três cycles e capacidade. Os cycles que terminam agora fecham sozinhos e passam o pendente para o próximo.' },
      { product: 'track', en: 'Insights: issue count, effort, cycle time, lead time and issue age, sliced and segmented by status, assignee, label, plan, team, cycle or week, plus a burn-up. Click a bar to see its issues, export to CSV or copy the link.', es: 'Insights: cantidad de issues, esfuerzo, cycle time, lead time y antigüedad, por estado, asignado, label, plan, equipo, cycle o semana, con segmentos y un burn-up. Hacé clic en una barra para ver sus issues, exportá a CSV o copiá el link.', pt: 'Insights: quantidade de issues, esforço, cycle time, lead time e idade, por status, responsável, label, plano, equipe, cycle ou semana, com segmentos e um burn-up. Clique numa barra para ver os issues, exporte para CSV ou copie o link.' },
      { product: 'track', en: 'Dashboards of saved insights as charts, tables or numbers, with dashboard filters, for the workspace or just for you. Add any insight with Add to dashboard.', es: 'Dashboards con insights guardados como gráfico, tabla o número, con filtros del dashboard, para el workspace o solo para vos. Cualquier insight se suma con Agregar a dashboard.', pt: 'Dashboards com insights salvos como gráfico, tabela ou número, com filtros do dashboard, para o workspace ou só para você. Qualquer insight entra com Adicionar ao dashboard.' },
      { product: 'track', en: 'Auto-close and auto-archive per project: stale backlog issues move to canceled after 1 to 12 months, and old done issues leave the lists. Archived issues are restored from Settings, Automations.', es: 'Auto-cierre y auto-archivo por proyecto: los issues de backlog sin cambios pasan a cancelado después de 1 a 12 meses, y los terminados viejos salen de las listas. Los archivados se restauran desde Ajustes, Automatizaciones.', pt: 'Fechamento e arquivamento automáticos por projeto: issues de backlog parados vão para cancelado depois de 1 a 12 meses, e os concluídos antigos saem das listas. Os arquivados são restaurados em Ajustes, Automações.' },
    ],
  },
  {
    id: '2026-10-25-track-triage',
    date: '2026-10-25',
    title: {
      en: 'Track: customer requests, triage rules, SLAs, AI triage and agents that work issues',
      es: 'Track: pedidos de clientes, reglas de triage, SLAs, triage con IA y agentes que trabajan issues',
      pt: 'Track: pedidos de clientes, regras de triage, SLAs, triage com IA e agentes que trabalham em issues',
    },
    items: [
      { product: 'track', en: 'Link customer requests to issues from the issue, from a CRM company or contact, or through the API (email, forms, Flow), with the quote and an important flag. Track › Customers lists who asked for what, and lists sort by customer count or won-deal revenue.', es: 'Los pedidos de clientes se enlazan a issues desde el issue, desde una empresa o un contacto del CRM o por la API (email, formularios, Flow), con la cita y la marca de importante. Track › Clientes muestra quién pidió qué, y las listas ordenan por cantidad de clientes o ingresos de deals ganados.', pt: 'Os pedidos de clientes são ligados a issues pelo issue, por uma empresa ou um contato do CRM ou pela API (e-mail, formulários, Flow), com a citação e a marca de importante. Track › Clientes mostra quem pediu o quê, e as listas ordenam por quantidade de clientes ou receita de deals ganhos.' },
      { product: 'track', en: 'Triage works from the keyboard (1 accept, 2 decline, 3 duplicate, H snooze), with an optional comment. Rules set priority, assignee, labels or accept issues as they arrive, and a daily or weekly rotation notifies or assigns the person on duty.', es: 'El triage se maneja con teclado (1 aceptar, 2 rechazar, 3 duplicado, H posponer), con comentario opcional. Las reglas fijan prioridad, asignado, labels o aceptan los issues al llegar, y una rotación diaria o semanal avisa o asigna a quien está de turno.', pt: 'O triage funciona pelo teclado (1 aceitar, 2 recusar, 3 duplicado, H adiar), com comentário opcional. As regras definem prioridade, responsável, labels ou aceitam os issues ao chegar, e um rodízio diário ou semanal avisa ou atribui a quem está de plantão.' },
      { product: 'track', en: 'SLAs by priority per project, with a countdown in the issue and the lists and notices when an issue is at risk or breached.', es: 'SLAs por prioridad en cada proyecto, con cuenta regresiva en el issue y las listas, y avisos cuando un issue está en riesgo o vence.', pt: 'SLAs por prioridade em cada projeto, com contagem regressiva no issue e nas listas, e avisos quando um issue está em risco ou vence.' },
      { product: 'track', en: 'AI suggests assignee, labels, priority and duplicates for issues in triage, summarizes an issue and its discussion, drafts project updates and turns pasted text into an issue.', es: 'La IA sugiere asignado, labels, prioridad y duplicados para los issues en triage, resume un issue y su discusión, arma borradores de update del proyecto y convierte un texto pegado en un issue.', pt: 'A IA sugere responsável, labels, prioridade e duplicados para os issues no triage, resume um issue e a discussão, monta rascunhos de update do projeto e transforma um texto colado em issue.' },
      { product: 'track', en: 'Delegate an issue to an agent from the Agents app or to an external agent: its work shows up as a session in the issue, and external agents answer through a signed webhook and the API.', es: 'Un issue se puede delegar a un agente de la app Agents o a un agente externo: su trabajo aparece como una sesión en el issue, y los externos responden por un webhook firmado y la API.', pt: 'Um issue pode ser delegado a um agente do app Agents ou a um agente externo: o trabalho aparece como uma sessão no issue, e os externos respondem por um webhook assinado e pela API.' },
    ],
  },
  {
    id: '2026-10-25-track-integrations',
    date: '2026-10-25',
    title: {
      en: 'Track connects to Slack, GitHub, Sentry and AI agents, with an API, private projects and an audit log',
      es: 'Track se conecta con Slack, GitHub, Sentry y agentes de IA, con API, proyectos privados y audit log',
      pt: 'O Track se conecta com Slack, GitHub, Sentry e agentes de IA, com API, projetos privados e audit log',
    },
    items: [
      { product: 'track', en: 'Public API for issues, comments, projects, cycles, labels and people, signed webhooks for issue, comment and project events with a delivery log, and an MCP server so Claude, Cursor or any MCP client can search, create and update issues.', es: 'API pública de issues, comentarios, proyectos, cycles, labels y personas, webhooks firmados de issues, comentarios y proyectos con log de entregas, y un servidor MCP para que Claude, Cursor o cualquier cliente MCP busque, cree y edite issues.', pt: 'API pública de issues, comentários, projetos, cycles, labels e pessoas, webhooks assinados de issues, comentários e projetos com log de entregas, e um servidor MCP para que Claude, Cursor ou qualquer cliente MCP busque, crie e edite issues.' },
      { product: 'track', en: 'Slack: create issues from a message or with /track, keep the thread in sync with the comments, post project updates to channels and preview issue links.', es: 'Slack: creá issues desde un mensaje o con /track, mantené el hilo sincronizado con los comentarios, publicá novedades de proyectos en canales y mirá la vista previa de los links de issues.', pt: 'Slack: crie issues a partir de uma mensagem ou com /track, mantenha a thread sincronizada com os comentários, publique novidades de projetos em canais e veja a prévia dos links de issues.' },
      { product: 'track', en: 'GitHub App, statuses per project for draft, open, review and merge, checks and reviews on the issue, words that link without closing, and GitHub Issues synced into a project.', es: 'GitHub App, status por proyecto para draft, abierto, review y merge, checks y reviews en el issue, palabras que vinculan sin cerrar y GitHub Issues sincronizados a un proyecto.', pt: 'GitHub App, status por projeto para draft, aberto, review e merge, checks e reviews no issue, palavras que vinculam sem fechar e GitHub Issues sincronizados em um projeto.' },
      { product: 'track', en: 'Sentry errors become issues and get resolved when the issue is done, Zendesk and Intercom tickets get a note when it closes, and Figma links show a live preview.', es: 'Los errores de Sentry se vuelven issues y se resuelven cuando el issue se completa, los tickets de Zendesk e Intercom reciben una nota al cerrarse y los links de Figma muestran vista previa en vivo.', pt: 'Os erros do Sentry viram issues e são resolvidos quando o issue é concluído, os tickets do Zendesk e Intercom recebem uma nota ao fechar e os links do Figma mostram prévia ao vivo.' },
      { product: 'track', en: 'Private projects, guests limited to the projects you pick, importers for Jira Cloud, Asana and Shortcut, and an audit log with filters and CSV export.', es: 'Proyectos privados, invitados limitados a los proyectos que elijas, importadores de Jira Cloud, Asana y Shortcut, y un audit log con filtros y export a CSV.', pt: 'Projetos privados, convidados limitados aos projetos que você escolher, importadores do Jira Cloud, Asana e Shortcut, e um audit log com filtros e export para CSV.' },
    ],
  },
  {
    id: '2026-10-25-docs-collab',
    date: '2026-10-25',
    title: {
      en: 'Docs: edit together, comment on text, suggest edits and manage access',
      es: 'Docs: editar juntos, comentar el texto, sugerir cambios y manejar los accesos',
      pt: 'Docs: editar juntos, comentar o texto, sugerir mudanças e controlar os acessos',
    },
    items: [
      { product: 'docs', en: 'Edit a page with other people at the same time: you see who is there and where their cursor is, and their changes merge into yours every second and a half, block by block and phrase by phrase. The old "load or overwrite" prompt is gone.', es: 'Editá una página con otras personas a la vez: ves quién está y dónde tiene el cursor, y sus cambios se fusionan con los tuyos cada segundo y medio, por bloque y por frase. Ya no aparece el "cargar o sobrescribir".', pt: 'Edite uma página com outras pessoas ao mesmo tempo: você vê quem está lá e onde está o cursor, e as mudanças delas se mesclam com as suas a cada segundo e meio, por bloco e por frase. O "carregar ou sobrescrever" sumiu.' },
      { product: 'docs', en: 'Select text and press Comment (or ⌘⇧M) to discuss that phrase. The comments panel has Open and Resolved tabs and updates live.', es: 'Seleccioná texto y tocá Comentar (o ⌘⇧M) para hablar de esa frase. El panel de comentarios tiene pestañas Abiertos y Resueltos y se actualiza en vivo.', pt: 'Selecione texto e toque Comentar (ou ⌘⇧M) para discutir essa frase. O painel de comentários tem abas Abertos e Resolvidos e se atualiza ao vivo.' },
      { product: 'docs', en: 'Suggest edits: what you type shows underlined and what you delete struck through, until someone with edit access accepts or rejects it, one by one or all at once.', es: 'Sugerir cambios: lo que escribís aparece subrayado y lo que borrás tachado, hasta que alguien con edición lo acepta o lo rechaza, de a uno o todo junto.', pt: 'Sugerir mudanças: o que você digita aparece sublinhado e o que apaga riscado, até alguém com edição aceitar ou rejeitar, um por um ou tudo de uma vez.' },
      { product: 'docs', en: 'Page history shows what changed in each version, block by block, and compares any version with the current page.', es: 'El historial muestra qué cambió en cada versión, bloque por bloque, y compara cualquier versión con la página actual.', pt: 'O histórico mostra o que mudou em cada versão, bloco a bloco, e compara qualquer versão com a página atual.' },
      { product: 'docs', en: 'Share with four roles: Can view, Can comment, Can edit and Full access. Invite anyone by email: without an account they get a link that opens only that page and its subpages.', es: 'Compartí con cuatro roles: Puede ver, Puede comentar, Puede editar y Acceso total. Invitá a cualquiera por email: sin cuenta recibe un link que abre solo esa página y sus subpáginas.', pt: 'Compartilhe com quatro funções: Pode ver, Pode comentar, Pode editar e Acesso total. Convide qualquer pessoa por email: sem conta, ela recebe um link que abre só essa página e as subpáginas.' },
      { product: 'docs', en: 'Lock a page so nobody edits it by accident, and choose what workspace members can do: view, comment, edit or full access, for all of Docs or page by page.', es: 'Bloqueá una página para que nadie la edite sin querer, y elegí qué pueden hacer los miembros del workspace: ver, comentar, editar o acceso total, en todo Docs o página por página.', pt: 'Bloqueie uma página para ninguém editar sem querer, e escolha o que os membros do workspace podem fazer: ver, comentar, editar ou acesso total, em todo o Docs ou página por página.' },
      { product: 'docs', en: 'Teamspaces: open, closed or private spaces with their own members and pages, each with a section in the sidebar.', es: 'Teamspaces: espacios abiertos, cerrados o privados con sus propios miembros y páginas, cada uno con su sección en el sidebar.', pt: 'Teamspaces: espaços abertos, fechados ou privados com membros e páginas próprios, cada um com sua seção na barra lateral.' },
      { product: 'docs', en: 'Admins get an audit log with filters and CSV export, and security switches for export, publishing and guests.', es: 'Los admins tienen un registro de auditoría con filtros y export a CSV, y switches de seguridad para exportar, publicar e invitados.', pt: 'Os admins têm um registro de auditoria com filtros e export em CSV, e chaves de segurança para exportar, publicar e convidados.' },
      { product: 'docs', en: 'Verify a page for a number of days or with no expiry: the owner gets a notice when it expires, and the Docs home lists the wiki.', es: 'Verificá una página por unos días o sin vencimiento: el dueño recibe un aviso cuando vence, y el inicio de Docs lista la wiki.', pt: 'Verifique uma página por alguns dias ou sem vencimento: o dono recebe um aviso quando vence, e o início do Docs lista a wiki.' },
    ],
  },
  {
    id: '2026-10-25-voice-rec-talk',
    date: '2026-10-25',
    title: {
      en: 'Voice, Rec and Talk join the suite, in the works',
      es: 'Voice, Rec y Talk se suman a la suite, en construcción',
      pt: 'Voice, Rec e Talk entram na suíte, em construção',
    },
    items: [
      { product: 'voice', en: 'Voice, the app we are building to take on Wispr Flow and Granola (dictation and meeting notes), has a page with the plan and its parity at 0 %, and /app/voice says it is being built. You can propose ideas for it on the board.', es: 'Voice, la app que estamos construyendo frente a Wispr Flow y Granola (dictado y notas de reunión), tiene su página con el plan y la paridad en 0 %, y /app/voice avisa que está en construcción. Se le pueden proponer ideas en el board.', pt: 'O Voice, o app que estamos construindo frente ao Wispr Flow e ao Granola (ditado e notas de reunião), tem sua página com o plano e a paridade em 0 %, e /app/voice avisa que está em construção. Dá para propor ideias para ele no board.' },
      { product: 'rec', en: 'Rec, our Loom alternative for screen and camera recording, has its page and /app/rec, both marked as in the works.', es: 'Rec, nuestra alternativa a Loom para grabar pantalla y cámara, tiene su página y /app/rec, las dos marcadas en construcción.', pt: 'O Rec, nossa alternativa ao Loom para gravar tela e câmera, tem sua página e /app/rec, as duas marcadas em construção.' },
      { product: 'talk', en: 'Talk, our Slack alternative for team messaging, has its page and /app/talk, both marked as in the works.', es: 'Talk, nuestra alternativa a Slack para la mensajería del equipo, tiene su página y /app/talk, las dos marcadas en construcción.', pt: 'O Talk, nossa alternativa ao Slack para as mensagens do time, tem sua página e /app/talk, as duas marcadas em construção.' },
    ],
  },
  {
    id: '2026-10-25-platform-home',
    date: '2026-10-25',
    title: {
      en: 'A home for the whole platform, and menus by category',
      es: 'Un inicio para toda la plataforma, y menús por categoría',
      pt: 'Um início para toda a plataforma, e menus por categoria',
    },
    items: [
      { product: 'platform', en: 'Dashboard opens a home of its own instead of Link: what is due today (CRM tasks, your Track issues in progress, today’s Cal bookings, unread Chat and Groups), what you touched last in every app, your apps and shortcuts to invite your team and import your data.', es: 'Dashboard abre un inicio propio en vez de Link: lo que vence hoy (tareas del CRM, tus issues de Track en curso, las reservas de Cal de hoy, lo sin leer de Chat y Groups), lo último que tocaste en cada app, tus apps y atajos para invitar a tu equipo e importar tus datos.', pt: 'Dashboard abre um início próprio em vez do Link: o que vence hoje (tarefas do CRM, suas issues do Track em andamento, as reservas do Cal de hoje, o não lido do Chat e do Groups), o que você mexeu por último em cada app, seus apps e atalhos para convidar sua equipe e importar seus dados.' },
      { product: 'platform', en: 'The app switcher shows featured apps first and the rest grouped by category (sell, support, automate, build, daily work), works with the arrow keys and opens ⌘K. ⌘K also finds every app by name, by the tool it replaces or by category.', es: 'El switcher de apps muestra primero las destacadas y el resto agrupado por categoría (vender, atender, automatizar, construir, trabajo diario), se maneja con flechas y abre ⌘K. ⌘K también encuentra cada app por nombre, por la herramienta que reemplaza o por categoría.', pt: 'O seletor de apps mostra primeiro os destaques e o resto agrupado por categoria (vender, atender, automatizar, construir, trabalho diário), funciona com as setas e abre o ⌘K. O ⌘K também encontra cada app pelo nome, pela ferramenta que substitui ou pela categoria.' },
      { product: 'link', en: 'The Link overview moved to Link › Overview (/app/links/overview), and the switcher opens Link on your links.', es: 'El resumen de Link pasó a Link › Resumen (/app/links/overview), y el switcher abre Link en tus links.', pt: 'A visão geral do Link passou para Link › Visão geral (/app/links/overview), e o seletor abre o Link nos seus links.' },
      { product: 'site', en: 'The products menu and the suite on the site are grouped by category, with a note on using every app with a team or on your own.', es: 'El menú de productos y la suite del sitio se agrupan por categoría, con una nota sobre usar cada app en equipo o por tu cuenta.', pt: 'O menu de produtos e a suíte do site são agrupados por categoria, com uma nota sobre usar cada app em equipe ou sozinho.' },
    ],
  },
  {
    id: '2026-10-25-platform-settings',
    date: '2026-10-25',
    title: {
      en: 'Platform settings in one place, and settings for every app',
      es: 'Los ajustes de la plataforma en un solo lugar, y ajustes para cada app',
      pt: 'Os ajustes da plataforma num só lugar, e ajustes para cada app',
    },
    items: [
      { product: 'platform', en: 'Settings has a side menu with two groups: account and workspace (profile, workspace, members, teams, plan and usage, API and webhooks, connections, import, security, notifications) and products, with one entry per app. ⌘K finds every section, and on a phone the menu becomes a selector.', es: 'Ajustes tiene un menú lateral con dos grupos: cuenta y workspace (perfil, workspace, miembros, equipos, plan y uso, API y webhooks, conexiones, importar, seguridad, avisos) y productos, con una entrada por app. ⌘K encuentra cada sección, y en el celular el menú pasa a un selector.', pt: 'Ajustes tem um menu lateral com dois grupos: conta e workspace (perfil, workspace, membros, equipes, plano e uso, API e webhooks, conexões, importar, segurança, avisos) e produtos, com uma entrada por app. O ⌘K encontra cada seção, e no celular o menu vira um seletor.' },
      { product: 'platform', en: 'API keys and webhooks moved to API and webhooks, AI usage to Plan and usage and Flow credentials to Connections. Old links to the workspace page land on the new section.', es: 'Las API keys y los webhooks pasaron a API y webhooks, el uso de IA a Plan y uso y las credenciales de Flow a Conexiones. Los links viejos a la página del workspace caen en la sección nueva.', pt: 'As API keys e os webhooks foram para API e webhooks, o uso de IA para Plano e uso e as credenciais do Flow para Conexões. Os links antigos para a página do workspace caem na seção nova.' },
      { product: 'link', en: 'Link has its own settings page with custom domains, Bitly import and link export.', es: 'Link tiene su página de ajustes con dominios propios, importar desde Bitly y exportar links.', pt: 'O Link tem sua página de ajustes com domínios próprios, importação do Bitly e exportação de links.' },
    ],
  },
  {
    id: '2026-10-25-docs-editor',
    date: '2026-10-25',
    title: {
      en: 'Docs: columns, embeds, synced blocks, reminders, favorites and a template gallery',
      es: 'Docs: columnas, embeds, bloques sincronizados, recordatorios, favoritos y galería de plantillas',
      pt: 'Docs: colunas, embeds, blocos sincronizados, lembretes, favoritos e galeria de modelos',
    },
    items: [
      { product: 'docs', en: 'Video, audio and PDF blocks next to images and files. Images can be resized, aligned and captioned. With Vercel Blob the browser uploads straight to storage, up to 5 GB per file; a self-hosted server keeps files on its own disk, up to 50 MB.', es: 'Bloques de video, audio y PDF junto a las imágenes y archivos. Las imágenes se pueden estirar, alinear y llevar leyenda. Con Vercel Blob el navegador sube directo al storage, hasta 5 GB por archivo; un servidor propio guarda en su disco, hasta 50 MB.', pt: 'Blocos de vídeo, áudio e PDF junto com imagens e arquivos. As imagens podem ser redimensionadas, alinhadas e ter legenda. Com Vercel Blob o navegador envia direto para o storage, até 5 GB por arquivo; um servidor próprio guarda no disco, até 50 MB.' },
      { product: 'docs', en: 'Drag a block to the side of another to make columns, from 2 to 5, with handles to resize them. On a phone they stack.', es: 'Arrastrá un bloque al costado de otro para armar columnas, de 2 a 5, con separadores para cambiar el ancho. En el teléfono se apilan.', pt: 'Arraste um bloco para o lado de outro para criar colunas, de 2 a 5, com divisores para mudar a largura. No celular elas se empilham.' },
      { product: 'docs', en: 'Pasting a link offers a mention, a web bookmark with title, description and image, or an embed for YouTube, Vimeo, Loom, Figma, Google Maps, Docs and Drive, CodePen, X, GitHub Gist, Spotify, Miro and more.', es: 'Al pegar un link podés elegir una mención, un bookmark con título, descripción e imagen, o un embed de YouTube, Vimeo, Loom, Figma, Google Maps, Docs y Drive, CodePen, X, GitHub Gist, Spotify, Miro y más.', pt: 'Ao colar um link você escolhe uma menção, um bookmark com título, descrição e imagem, ou um embed de YouTube, Vimeo, Loom, Figma, Google Maps, Docs e Drive, CodePen, X, GitHub Gist, Spotify, Miro e mais.' },
      { product: 'docs', en: 'New blocks: synced blocks that show the same content on several pages, block and inline equations with KaTeX, table of contents, buttons that insert blocks or open a link, and breadcrumbs.', es: 'Bloques nuevos: bloques sincronizados que muestran el mismo contenido en varias páginas, ecuaciones en bloque y en línea con KaTeX, índice, botones que insertan bloques o abren un link, y breadcrumbs.', pt: 'Blocos novos: blocos sincronizados que mostram o mesmo conteúdo em várias páginas, equações em bloco e em linha com KaTeX, sumário, botões que inserem blocos ou abrem um link, e breadcrumbs.' },
      { product: 'docs', en: 'Type @today, @tomorrow or a date to mention it, or @remind tomorrow 9am to get a reminder in the app and by email at that time.', es: 'Escribí @hoy, @mañana o una fecha para mencionarla, o @recordar mañana 9am para que te llegue un recordatorio en la app y por email a esa hora.', pt: 'Digite @hoje, @amanhã ou uma data para mencioná-la, ou @lembrar amanhã 9am para receber um lembrete no app e por email nesse horário.' },
      { product: 'docs', en: 'Page icons can be an uploaded image, and covers come from a gallery of colors and photos, an upload or a link, with reposition. They show in the sidebar, search and published pages.', es: 'El ícono de una página puede ser una imagen subida, y la portada sale de una galería de colores y fotos, una subida o un link, y se puede reposicionar. Se ven en el sidebar, la búsqueda y las páginas publicadas.', pt: 'O ícone de uma página pode ser uma imagem enviada, e a capa vem de uma galeria de cores e fotos, de um envio ou de um link, com reposicionamento. Aparecem na barra lateral, na busca e nas páginas publicadas.' },
      { product: 'docs', en: 'Star a page to add it to Favorites at the top of the sidebar, and reorder them by dragging or with Alt and the arrow keys.', es: 'Marcá una página con la estrella para sumarla a Favoritos arriba del sidebar, y ordenalos arrastrando o con Alt y las flechas.', pt: 'Marque uma página com a estrela para adicioná-la aos Favoritos no topo da barra lateral, e reordene arrastando ou com Alt e as setas.' },
      { product: 'docs', en: 'A template gallery with sixteen templates by section and a preview, a template button on empty pages, and database row templates: save a row as a template and create new rows from it.', es: 'Una galería con dieciséis plantillas por sección y vista previa, un botón de plantillas en las páginas vacías, y plantillas de fila en las bases: guardá una fila como plantilla y creá filas nuevas desde ella.', pt: 'Uma galeria com dezesseis modelos por seção e prévia, um botão de modelos nas páginas vazias, e modelos de linha nos bancos: salve uma linha como modelo e crie linhas novas a partir dele.' },
    ],
  },
  {
    id: '2026-10-25-docs-databases',
    date: '2026-10-25',
    title: {
      en: 'Docs: databases with formulas, relations, new views, automations, AI autofill and CSV',
      es: 'Docs: bases con fórmulas, relaciones, vistas nuevas, automatizaciones, autocompletado con IA y CSV',
      pt: 'Docs: bancos com fórmulas, relações, novas visualizações, automações, preenchimento com IA e CSV',
    },
    items: [
      { product: 'docs', en: 'New property types: formula (Notion syntax with prop("Name"), if, text, number and date functions), relation, rollup, files, created by, last edited by, unique ID with prefix, button and place.', es: 'Tipos de propiedad nuevos: fórmula (sintaxis de Notion con prop("Nombre"), if y funciones de texto, número y fecha), relación, rollup, archivos, creado por, editado por, ID único con prefijo, botón y lugar.', pt: 'Novos tipos de propriedade: fórmula (sintaxe do Notion com prop("Nome"), if e funções de texto, número e data), relação, rollup, arquivos, criado por, editado por, ID único com prefixo, botão e local.' },
      { product: 'docs', en: 'Relations link rows to the same database or one on another page, one-way or two-way. Rollups count, sum, average or show the related values.', es: 'Las relaciones unen filas con la misma base o con una de otra página, en una o dos vías. Los rollups cuentan, suman, promedian o muestran los valores relacionados.', pt: 'Relações ligam linhas ao mesmo banco ou a um de outra página, em uma ou duas vias. Rollups contam, somam, fazem média ou mostram os valores relacionados.' },
      { product: 'docs', en: 'New views: list, calendar (drag rows to another day) and timeline (drag and resize bars). Boards can be split into sub-groups, and /linked shows a database from another page with its own views.', es: 'Vistas nuevas: lista, calendario (arrastrá filas a otro día) y timeline (mové y estirá barras). Los boards se pueden partir en subgrupos y /linked muestra una base de otra página con sus propias vistas.', pt: 'Novas visualizações: lista, calendário (arraste linhas para outro dia) e linha do tempo (mova e estique barras). Boards podem ser divididos em subgrupos e /linked mostra um banco de outra página com suas próprias visualizações.' },
      { product: 'docs', en: 'Database automations: when a row is added or a property changes, edit a property, add a row to another database, notify people or send a webhook. Button properties run the same actions with one click.', es: 'Automatizaciones de base: cuando se agrega una fila o cambia una propiedad, editar una propiedad, agregar una fila en otra base, avisar a personas o mandar un webhook. La propiedad botón corre las mismas acciones con un click.', pt: 'Automações de banco: quando uma linha é adicionada ou uma propriedade muda, editar uma propriedade, adicionar uma linha em outro banco, avisar pessoas ou enviar um webhook. A propriedade botão roda as mesmas ações com um clique.' },
      { product: 'docs', en: 'AI autofill for text, select and multi-select properties: summary, key information, translation, best option or your own instruction, on demand or whenever the row changes.', es: 'Autocompletar con IA en propiedades de texto, select y multi-select: resumen, dato clave, traducción, mejor opción o una instrucción propia, a pedido o cada vez que cambia la fila.', pt: 'Preenchimento com IA em propriedades de texto, select e multisseleção: resumo, informação-chave, tradução, melhor opção ou uma instrução própria, sob demanda ou sempre que a linha muda.' },
      { product: 'docs', en: 'Import a CSV into any database, choosing where each column goes, and export the current view or every row as CSV. Clicking a row title in a table now opens the row.', es: 'Importá un CSV a cualquier base eligiendo adónde va cada columna, y exportá en CSV la vista o todas las filas. Hacer click en el título de una fila de la tabla ahora abre la fila.', pt: 'Importe um CSV para qualquer banco escolhendo para onde vai cada coluna, e exporte em CSV a visualização ou todas as linhas. Clicar no título de uma linha da tabela agora abre a linha.' },
    ],
  },
  {
    id: '2026-10-24-groups-inbox',
    date: '2026-10-24',
    title: {
      en: 'Groups: message actions, round-robin, translation and AI drafts in the inbox',
      es: 'Groups: acciones sobre mensajes, round-robin, traducción y borradores AI en la bandeja',
      pt: 'Groups: ações nas mensagens, round-robin, tradução e rascunhos IA na caixa',
    },
    items: [
      { product: 'groups', en: 'Edit and delete for everyone the messages you sent, forward them to other chats and pin up to three at the top of the chat. Edits and deletions made on the phone show up too.', es: 'Editá y borrá para todos los mensajes que mandaste, reenvialos a otros chats y fijá hasta tres arriba del chat. Las ediciones y borrados hechos desde el teléfono también se ven.', pt: 'Edite e apague para todos as mensagens que você enviou, encaminhe para outros chats e fixe até três no topo do chat. Edições e exclusões feitas no telefone também aparecem.' },
      { product: 'groups', en: 'Assign chats to a person and a team, with the history in the thread and a notification for the assignee. Round-robin rules by number, label or chat type rotate new chats among the people marked as available.', es: 'Asigná chats a una persona y a un equipo, con el historial en el hilo y un aviso para quien lo recibe. Las reglas round-robin por número, etiqueta o tipo de chat rotan los chats nuevos entre quienes están disponibles.', pt: 'Atribua chats a uma pessoa e a uma equipe, com o histórico no fio e um aviso para quem recebe. As regras round-robin por número, etiqueta ou tipo de chat revezam os chats novos entre quem está disponível.' },
      { product: 'groups', en: 'Internal notes take @mentions with autocomplete and notify the person. Notes can be edited and deleted.', es: 'Las notas internas aceptan @menciones con autocompletado y le avisan a la persona. Las notas se editan y se borran.', pt: 'As notas internas aceitam @menções com autocompletar e avisam a pessoa. As notas podem ser editadas e apagadas.' },
      { product: 'groups', en: 'Mark chats as unread, pin them to the top and close, reopen or assign many at once from the list.', es: 'Marcá chats como no leídos, fijalos arriba y cerrá, reabrí o asigná varios a la vez desde la lista.', pt: 'Marque chats como não lidos, fixe no topo e feche, reabra ou atribua vários de uma vez pela lista.' },
      { product: 'groups', en: 'Translate incoming messages into your language, translate your reply into the customer\'s before sending, and ask AI for a draft built from the chat, your quick replies and your knowledge base.', es: 'Traducí los mensajes entrantes a tu idioma, traducí tu respuesta al idioma del cliente antes de mandarla y pedile a la AI un borrador armado con el chat, tus respuestas rápidas y tu base de conocimiento.', pt: 'Traduza as mensagens recebidas para o seu idioma, traduza sua resposta para o idioma do cliente antes de enviar e peça à IA um rascunho feito com o chat, suas respostas rápidas e sua base de conhecimento.' },
      { product: 'groups', en: 'Voice calls show up in the chat as incoming, outgoing or missed, with the duration on Cloud API numbers.', es: 'Las llamadas de voz aparecen en el chat como entrantes, salientes o perdidas, con la duración en números de la Cloud API.', pt: 'As chamadas de voz aparecem no chat como recebidas, feitas ou perdidas, com a duração em números da Cloud API.' },
    ],
  },
  {
    id: '2026-10-24-groups-org',
    date: '2026-10-24',
    title: {
      en: 'Groups: group templates, saved lists, ticket fields, tasks from a chat and AI flagging',
      es: 'Groups: plantillas de grupo, listas guardadas, campos de ticket, tareas desde el chat y marcado con AI',
      pt: 'Groups: modelos de grupo, listas salvas, campos de ticket, tarefas pelo chat e marcação com IA',
    },
    items: [
      { product: 'groups', en: 'Group templates keep the members and admins that are always there, a name with variables, labels, settings and a welcome message. Create one group or many from a CSV with one column per variable.', es: 'Las plantillas de grupo guardan los miembros y admins que siempre están, un nombre con variables, etiquetas, ajustes y un mensaje de bienvenida. Creá un grupo o varios desde un CSV con una columna por variable.', pt: 'Os modelos de grupo guardam os membros e admins que sempre estão, um nome com variáveis, etiquetas, configurações e uma mensagem de boas-vindas. Crie um grupo ou vários de um CSV com uma coluna por variável.' },
      { product: 'groups', en: 'Group settings from Groups: photo, only admins send messages, only admins edit the info and disappearing messages (Evolution API), one group or several at once. Join a group with its invite link and leave it keeping the history.', es: 'Ajustes del grupo desde Groups: foto, solo admins mandan mensajes, solo admins editan la info y mensajes temporales (Evolution API), en un grupo o en varios a la vez. Entrá a un grupo con su link de invitación y salí conservando el historial.', pt: 'Configurações do grupo pelo Groups: foto, só admins enviam mensagens, só admins editam as informações e mensagens temporárias (Evolution API), em um grupo ou em vários de uma vez. Entre em um grupo com o link de convite e saia mantendo o histórico.' },
      { product: 'groups', en: 'Saved chat lists: save the inbox filters (label, type, assignee, property) as a shared or personal list. Lists show in the sidebar and ⌘K, and work as a broadcast audience.', es: 'Listas guardadas de chats: guardá los filtros de la bandeja (etiqueta, tipo, asignado, propiedad) como una lista compartida o personal. Aparecen en el sidebar y en ⌘K, y sirven como audiencia de un envío masivo.', pt: 'Listas salvas de chats: salve os filtros da caixa (etiqueta, tipo, responsável, propriedade) como uma lista compartilhada ou pessoal. Aparecem na barra lateral e no ⌘K, e servem como público de um envio em massa.' },
      { product: 'groups', en: 'Custom properties add multi-select, checkbox, link, file and dependent dropdowns up to 3 levels, with filters and columns in the groups list. Tickets get their own custom fields, required to close if you want, with filters and CSV export.', es: 'Las propiedades propias suman multiselección, casilla, link, archivo y desplegables dependientes de hasta 3 niveles, con filtros y columnas en la lista de grupos. Los tickets tienen sus propios campos, obligatorios para cerrar si querés, con filtros y export CSV.', pt: 'As propriedades próprias ganham seleção múltipla, caixa, link, arquivo e listas dependentes de até 3 níveis, com filtros e colunas na lista de grupos. Os tickets têm seus próprios campos, obrigatórios para fechar se você quiser, com filtros e exportação CSV.' },
      { product: 'groups', en: 'Tasks and reminders from any message: pick when and for whom, get a notification and an email on time, and find them in Groups › Tasks and CRM › Tasks.', es: 'Tareas y recordatorios desde cualquier mensaje: elegí cuándo y para quién, recibí un aviso y un email a la hora, y encontralas en Groups › Tareas y en CRM › Tareas.', pt: 'Tarefas e lembretes a partir de qualquer mensagem: escolha quando e para quem, receba um aviso e um email no horário, e encontre em Groups › Tarefas e CRM › Tarefas.' },
      { product: 'groups', en: 'Unanswered can count only real questions: AI tells them from comments like thanks or ok, with rules you write. A ticket from the message also clears it, and SLA breaches can email the assignee, the admins or other addresses.', es: 'Sin responder puede contar solo preguntas reales: la AI las separa de comentarios como gracias u ok, con reglas que escribís vos. Crear un ticket desde el mensaje también lo desmarca, y un SLA vencido puede mandar email a la persona asignada, a los admins o a otras direcciones.', pt: 'Sem resposta pode contar só perguntas reais: a IA separa de comentários como obrigado ou ok, com regras que você escreve. Criar um ticket a partir da mensagem também desmarca, e um SLA vencido pode mandar email para o responsável, os admins ou outros endereços.' },
      { product: 'groups', en: 'Connecting a number by QR refreshes the code by itself, follows the session status and offers a new QR to reconnect when the phone unlinks.', es: 'Conectar un número por QR actualiza el código solo, sigue el estado de la sesión y ofrece un QR nuevo para reconectar cuando el teléfono se desvincula.', pt: 'Conectar um número por QR atualiza o código sozinho, acompanha o status da sessão e oferece um QR novo para reconectar quando o telefone se desvincula.' },
    ],
  },
  {
    id: '2026-10-25-groups-platform',
    date: '2026-10-25',
    title: {
      en: 'Groups: recurring messages, polls, integrations, MCP and access by label',
      es: 'Groups: mensajes recurrentes, encuestas, integraciones, MCP y acceso por etiqueta',
      pt: 'Groups: mensagens recorrentes, enquetes, integrações, MCP e acesso por etiqueta',
    },
    items: [
      { product: 'groups', en: 'Recurring messages to chats and groups: daily, weekly by day, monthly or cron, with time zone, end date, pause and the next runs in view. Each run keeps the broadcast pace.', es: 'Mensajes recurrentes a chats y grupos: diario, semanal por días, mensual o cron, con zona horaria, fecha de fin, pausa y las próximas corridas a la vista. Cada corrida respeta el ritmo de los envíos.', pt: 'Mensagens recorrentes para chats e grupos: diário, semanal por dias, mensal ou cron, com fuso, data de fim, pausa e as próximas execuções à vista. Cada execução respeita o ritmo dos envios.' },
      { product: 'groups', en: 'WhatsApp polls from a chat, a broadcast or a recurring message, with live results as votes arrive (WAHA and Evolution numbers).', es: 'Encuestas de WhatsApp desde un chat, un envío o un recurrente, con resultados en vivo a medida que llegan los votos (números WAHA y Evolution).', pt: 'Enquetes de WhatsApp a partir de um chat, um envio ou uma recorrente, com resultados ao vivo conforme chegam os votos (números WAHA e Evolution).' },
      { product: 'groups', en: 'Integrations: Slack alerts, Freshdesk and Zoho Desk tickets with status synced both ways, outgoing webhooks for 13 events with a delivery log and resend, a wider REST API and an MCP server for AI assistants.', es: 'Integraciones: avisos en Slack, tickets en Freshdesk y Zoho Desk con el estado sincronizado en los dos sentidos, webhooks salientes de 13 eventos con log de entregas y reenvío, una API REST más completa y un servidor MCP para asistentes de IA.', pt: 'Integrações: avisos no Slack, tickets no Freshdesk e no Zoho Desk com status sincronizado nos dois sentidos, webhooks de saída de 13 eventos com log de entregas e reenvio, uma API REST mais completa e um servidor MCP para assistentes de IA.' },
      { product: 'groups', en: 'Access and privacy: members can see only the chats with their labels, phone numbers can be hidden per role, and every chat has an activity log of who assigned, closed, labeled or exported it.', es: 'Acceso y privacidad: los miembros pueden ver solo los chats con sus etiquetas, los teléfonos se pueden ocultar por rol y cada chat tiene un log de quién lo asignó, cerró, etiquetó o exportó.', pt: 'Acesso e privacidade: os membros podem ver só os chats com suas etiquetas, os telefones podem ser ocultados por papel e cada chat tem um log de quem atribuiu, fechou, etiquetou ou exportou.' },
      { product: 'groups', en: 'Reports filter by any date range, label, group and number. Groups installs as an app on phone and desktop with notifications for chats assigned to you.', es: 'Los reportes se filtran por cualquier rango de fechas, etiqueta, grupo y número. Groups se instala como app en el teléfono y la computadora, con avisos de los chats que tenés asignados.', pt: 'Os relatórios filtram por qualquer período, etiqueta, grupo e número. O Groups se instala como app no celular e no computador, com avisos dos chats atribuídos a você.' },
    ],
  },
  {
    id: '2026-10-24-crm-ai',
    date: '2026-10-24',
    title: {
      en: 'CRM: AI summaries, deal scores, an assistant and data agents',
      es: 'CRM: resúmenes con IA, score de deals, un asistente y agentes de datos',
      pt: 'CRM: resumos com IA, score de negócios, um assistente e agentes de dados',
    },
    items: [
      { product: 'crm', en: 'Contacts, companies and deals have an AI summary card built from their properties, timeline, emails and deals. It stays saved, says when there is new activity and regenerates on demand.', es: 'Contactos, empresas y deals tienen una tarjeta de resumen con IA armada con sus propiedades, timeline, emails y deals. Queda guardada, avisa cuando hay actividad nueva y se regenera a pedido.', pt: 'Contatos, empresas e negócios têm um cartão de resumo com IA feito com propriedades, timeline, emails e negócios. Fica salvo, avisa quando há atividade nova e é gerado de novo sob demanda.' },
      { product: 'crm', en: 'Deals get an AI score from 0 to 100 with its reasons and a deal plan whose steps turn into tasks. The score shows on board cards, and the board can score every open deal at once.', es: 'Los deals tienen un score con IA de 0 a 100 con sus razones y un plan del deal cuyos pasos se vuelven tareas. El score se ve en las tarjetas del board, y el board calcula todos los deals abiertos de una vez.', pt: 'Os negócios têm um score com IA de 0 a 100 com os motivos e um plano cujos passos viram tarefas. O score aparece nos cartões do board, e o board calcula todos os negócios abertos de uma vez.' },
      { product: 'crm', en: 'The CRM assistant (Ask AI, or from ⌘K) searches records and answers about deals, pipeline and tasks. When you ask for a change it prepares it, and it only happens when you confirm.', es: 'El asistente del CRM (Preguntar a la IA, o desde ⌘K) busca registros y responde sobre deals, pipeline y tareas. Si pedís un cambio lo prepara, y se hace recién cuando confirmás.', pt: 'O assistente do CRM (Perguntar à IA, ou pelo ⌘K) busca registros e responde sobre negócios, pipeline e tarefas. Se você pede uma mudança, ele prepara, e ela só acontece quando você confirma.' },
      { product: 'crm', en: 'Calls and meetings on the timeline can be summarized with AI from their notes or an attached transcript, with next steps you turn into tasks in one click.', es: 'Las llamadas y reuniones del timeline se resumen con IA a partir de sus notas o de una transcripción adjunta, con próximos pasos que pasás a tareas con un click.', pt: 'Chamadas e reuniões da timeline podem ser resumidas com IA a partir das notas ou de uma transcrição anexada, com próximos passos que viram tarefas com um clique.' },
      { product: 'crm', en: 'New AI agents page: fill in missing company data from each website, complete contacts from their email and domain, and draft a first email for every contact in a list. You review each change and email before it is saved or sent.', es: 'Nueva página de agentes de IA: completá datos de empresas desde su sitio, completá contactos desde su email y dominio y redactá un primer email para cada contacto de una lista. Revisás cada cambio y cada email antes de guardarlo o enviarlo.', pt: 'Nova página de agentes de IA: complete dados de empresas a partir do site, complete contatos pelo email e domínio e escreva um primeiro email para cada contato de uma lista. Você revisa cada mudança e cada email antes de salvar ou enviar.' },
      { product: 'crm', en: 'Workflows have an AI step that runs a prompt on the record and writes the answer to a note or a field, or refreshes the summary or the deal score.', es: 'Los workflows tienen un paso de IA que corre un prompt sobre el registro y escribe la respuesta en una nota o un campo, o actualiza el resumen o el score del deal.', pt: 'Os workflows têm um passo de IA que roda um prompt sobre o registro e escreve a resposta numa nota ou num campo, ou atualiza o resumo ou o score do negócio.' },
    ],
  },
  {
    id: '2026-10-24-crm-data-model',
    date: '2026-10-24',
    title: {
      en: 'CRM: custom objects, a separate lead object, field permissions and richer lists',
      es: 'CRM: objetos propios, un objeto Lead aparte, permisos por campo y listas más completas',
      pt: 'CRM: objetos personalizados, um objeto Lead separado, permissões por campo e listas mais completas',
    },
    items: [
      { product: 'crm', en: 'Admins can define custom objects (vehicles, properties, subscriptions) with their own properties. Records get a table with filters, a record page with notes and tasks, associations with contacts, companies and deals, CSV import, ⌘K search, the CRM sidebar and the API.', es: 'Los admins pueden definir objetos propios (vehículos, propiedades, suscripciones) con sus propiedades. Los registros tienen tabla con filtros, ficha con notas y tareas, asociaciones con contactos, empresas y deals, import CSV, búsqueda con ⌘K, el sidebar del CRM y la API.', pt: 'Admins podem definir objetos personalizados (veículos, imóveis, assinaturas) com suas propriedades. Os registros têm tabela com filtros, ficha com notas e tarefas, associações com contatos, empresas e negócios, importação CSV, busca com ⌘K, a barra lateral do CRM e a API.' },
      { product: 'crm', en: 'Leads are now their own object: owner, a lead pipeline with stages you can edit, contact and company, a table and a board, disqualify with a reason and convert to a deal in one step. Lifecycle stage and lead status on contacts keep working.', es: 'Los leads ahora son un objeto propio: owner, un pipeline de leads con etapas editables, contacto y empresa, tabla y tablero, descalificar con motivo y convertir en deal en un paso. El lifecycle y el lead status del contacto siguen funcionando.', pt: 'Leads agora são um objeto próprio: responsável, um pipeline de leads com etapas editáveis, contato e empresa, tabela e quadro, desqualificar com motivo e converter em negócio em um passo. O lifecycle e o lead status do contato continuam funcionando.' },
      { product: 'crm', en: 'Field permissions: make a custom field read-only or hidden for members or for a sales team. It applies to record pages, tables, filters, bulk edits and the API.', es: 'Permisos por campo: un campo propio puede ser de solo lectura u oculto para los members o para un equipo de ventas. Aplica en fichas, tablas, filtros, edición en masa y la API.', pt: 'Permissões por campo: um campo personalizado pode ser somente leitura ou oculto para members ou para um time de vendas. Vale nas fichas, tabelas, filtros, edição em massa e na API.' },
      { product: 'crm', en: 'Dynamic lists filter by custom fields and by activity (last contacted, open deals, emails opened or replied, form submissions, list membership), matching all or any filter, and their filters can be edited later.', es: 'Las listas dinámicas filtran por campos propios y por actividad (último contacto, deals abiertos, emails abiertos o respondidos, formularios, pertenencia a listas), con todos los filtros o cualquiera, y sus filtros se pueden editar después.', pt: 'As listas dinâmicas filtram por campos personalizados e por atividade (último contato, negócios abertos, emails abertos ou respondidos, formulários, participação em listas), com todos os filtros ou qualquer um, e os filtros podem ser editados depois.' },
      { product: 'crm', en: 'Company details from the domain now include description, industry, size, location, founding year and social profiles from the website, with an optional data provider. It runs when a company is created and from the company page.', es: 'Los datos de la empresa desde el dominio ahora traen descripción, rubro, tamaño, ubicación, año de fundación y redes desde el sitio, con un proveedor de datos opcional. Corre al crear la empresa y desde su ficha.', pt: 'Os dados da empresa a partir do domínio agora trazem descrição, setor, tamanho, localização, ano de fundação e redes a partir do site, com um provedor de dados opcional. Roda ao criar a empresa e a partir da ficha.' },
    ],
  },
  {
    id: '2026-10-24-crm-sales-exec',
    date: '2026-10-24',
    title: {
      en: 'CRM: a daily work queue, playbooks, several lead scores, stage approvals and deal splits',
      es: 'CRM: cola de trabajo diaria, playbooks, varios lead scores, aprobaciones de etapa y splits de deals',
      pt: 'CRM: fila de trabalho diária, playbooks, vários lead scores, aprovações de etapa e divisão de negócios',
    },
    items: [
      { product: 'crm', en: 'Start the work queue from Tasks (or press Q) to go through overdue and today tasks one at a time, sequence steps included, with the contact, company and deal beside each task. Complete, skip, snooze or open the record from the keyboard.', es: 'Empezá la cola de trabajo desde Tareas (o con Q) para recorrer de a una las tareas vencidas y de hoy, pasos de secuencia incluidos, con el contacto, la empresa y el deal al lado. Completá, salteá, posponé o abrí el registro desde el teclado.', pt: 'Comece a fila de trabalho em Tarefas (ou com Q) para percorrer uma por vez as tarefas atrasadas e de hoje, passos de sequência incluídos, com o contato, a empresa e o negócio ao lado. Conclua, pule, adie ou abra o registro pelo teclado.' },
      { product: 'crm', en: 'Playbooks: call scripts with questions whose answers update the record. Open them from a contact, company or deal, or while logging a call, and they are saved to the timeline.', es: 'Playbooks: guiones de llamada con preguntas cuyas respuestas actualizan el registro. Se abren desde un contacto, una empresa o un deal, o al registrar una llamada, y quedan en el timeline.', pt: 'Playbooks: roteiros de chamada com perguntas cujas respostas atualizam o registro. Abrem a partir de um contato, uma empresa ou um negócio, ou ao registrar uma chamada, e ficam na linha do tempo.' },
      { product: 'crm', en: 'Lead scoring with up to 10 scores, tiers like Hot or Warm, and decay for old activity. Tiers show next to the score and work as filters and workflow triggers.', es: 'Lead scoring con hasta 10 scores, tramos como Caliente o Tibio y decaimiento de la actividad vieja. Los tramos se ven junto al score y sirven como filtro y disparador de workflows.', pt: 'Lead scoring com até 10 scores, faixas como Quente ou Morno e decaimento da atividade antiga. As faixas aparecem junto ao score e servem como filtro e gatilho de workflows.' },
      { product: 'crm', en: 'Stage approvals: ask for approval before a deal enters a stage, always or from an amount or discount. Approvers get a notification and approve or reject from the deal or the approvals list.', es: 'Aprobaciones de etapa: pedí aprobación antes de que un deal entre a una etapa, siempre o desde un monto o descuento. Quienes aprueban reciben un aviso y aprueban o rechazan desde el deal o la lista de aprobaciones.', pt: 'Aprovações de etapa: peça aprovação antes de um negócio entrar em uma etapa, sempre ou a partir de um valor ou desconto. Quem aprova recebe um aviso e aprova ou rejeita no negócio ou na lista de aprovações.' },
      { product: 'crm', en: 'Deal splits share a deal between owners by percentage, and owner reports, quotas and the forecast by owner count each share.', es: 'Los splits reparten un deal entre dueños por porcentaje, y los reportes por persona, las cuotas y el forecast por owner cuentan la parte de cada uno.', pt: 'A divisão reparte um negócio entre donos por porcentagem, e os relatórios por pessoa, as cotas e a previsão por dono contam a parte de cada um.' },
      { product: 'crm', en: 'Move deals on the board from the keyboard: arrows move between cards and Shift + arrow changes the stage.', es: 'Mové deals en el board con el teclado: las flechas recorren las tarjetas y Shift + flecha cambia la etapa.', pt: 'Mova negócios no quadro pelo teclado: as setas percorrem os cartões e Shift + seta muda a etapa.' },
    ],
  },
  {
    id: '2026-10-24-crm-reports',
    date: '2026-10-24',
    title: {
      en: 'CRM: custom report builder, sales forecast and deal journey',
      es: 'CRM: constructor de reportes, forecast de ventas y recorrido de deals',
      pt: 'CRM: construtor de relatórios, previsão de vendas e jornada dos negócios',
    },
    items: [
      { product: 'crm', en: 'Build your own reports from contacts, companies, deals, activities or tasks, with fields from associated objects and your custom fields, filters, up to two groupings (dates by day, week, month, quarter or year) and count, sum, average, minimum or maximum. Show them as a table, bars, lines, pie or a single number, save, rename, export to CSV and add them to a dashboard.', es: 'Armá tus propios reportes desde contactos, empresas, deals, actividades o tareas, con campos de los objetos asociados y tus campos propios, filtros, hasta dos agrupaciones (fechas por día, semana, mes, trimestre o año) y conteo, suma, promedio, mínimo o máximo. Mostralos como tabla, barras, líneas, torta o un número, guardalos, renombralos, exportalos a CSV y sumalos a un dashboard.', pt: 'Monte seus próprios relatórios a partir de contatos, empresas, negócios, atividades ou tarefas, com campos dos objetos associados e seus campos próprios, filtros, até dois agrupamentos (datas por dia, semana, mês, trimestre ou ano) e contagem, soma, média, mínimo ou máximo. Mostre como tabela, barras, linhas, pizza ou um número, salve, renomeie, exporte para CSV e adicione a um dashboard.' },
      { product: 'crm', en: 'A Forecast page per month or quarter, by owner or sales team: goal, closed won, commit, best case, pipeline and weighted amount. Each deal gets a forecast category from its stage probability that you can change, and each rep submits their number for the period, with the history of every submission.', es: 'Una página de Forecast por mes o trimestre, por responsable o equipo de ventas: meta, ganado, commit, best case, pipeline y monto ponderado. Cada deal tiene una categoría de forecast que sale de la probabilidad de su etapa y se puede cambiar, y cada vendedor envía su número del período, con el historial de cada envío.', pt: 'Uma página de Previsão por mês ou trimestre, por responsável ou equipe de vendas: meta, ganho, commit, best case, pipeline e valor ponderado. Cada negócio tem uma categoria de previsão que vem da probabilidade da etapa e pode ser mudada, e cada vendedor envia seu número do período, com o histórico de cada envio.' },
      { product: 'crm', en: 'Deal journey in Reports: how many deals reach each stage, the conversion to the next one, the average time spent in it and where deals are lost, from the full stage history that every deal now keeps.', es: 'Recorrido de deals en Reportes: cuántos deals llegan a cada etapa, la conversión a la siguiente, el tiempo promedio en cada una y dónde se pierden, a partir del historial completo de etapas que ahora guarda cada deal.', pt: 'Jornada dos negócios em Relatórios: quantos negócios chegam a cada etapa, a conversão para a próxima, o tempo médio em cada uma e onde se perdem, a partir do histórico completo de etapas que cada negócio agora guarda.' },
    ],
  },
  {
    id: '2026-10-24-crm-integrations',
    date: '2026-10-24',
    title: {
      en: 'CRM: apps, signed and paid quotes, smarter forms, tracked documents and 1:1 videos',
      es: 'CRM: apps, cotizaciones firmadas y cobradas, formularios más completos, documentos con seguimiento y videos 1:1',
      pt: 'CRM: apps, cotações assinadas e pagas, formulários mais completos, documentos rastreados e vídeos 1:1',
    },
    items: [
      { product: 'crm', en: 'Integrations now has apps: Slack posts the events you pick to a channel, Zoom creates a meeting link from any timeline meeting, Stripe brings customers and payments to the timeline and marks deals won, and Zapier or Make receive CRM events through a signed webhook.', es: 'Integraciones ahora tiene apps: Slack publica en un canal los eventos que elijas, Zoom crea el link de cualquier reunión del timeline, Stripe trae clientes y pagos al timeline y marca deals ganados, y Zapier o Make reciben los eventos del CRM por un webhook firmado.', pt: 'Integrações agora tem apps: o Slack publica num canal os eventos que você escolher, o Zoom cria o link de qualquer reunião da timeline, o Stripe traz clientes e pagamentos para a timeline e marca negócios ganhos, e Zapier ou Make recebem os eventos do CRM por um webhook assinado.' },
      { product: 'crm', en: 'Quotes are signed with a typed name and a drawn signature, with a downloadable audit certificate, and can collect payment with Stripe Checkout, which marks the quote paid and the deal won.', es: 'Las cotizaciones se firman con nombre tipeado y firma dibujada, con certificado de auditoría descargable, y pueden cobrarse con Stripe Checkout, que marca la cotización pagada y el deal ganado.', pt: 'As cotações são assinadas com nome digitado e assinatura desenhada, com certificado de auditoria para baixar, e podem ser cobradas com Stripe Checkout, que marca a cotação paga e o negócio ganho.' },
      { product: 'crm', en: 'Forms can have steps, fields that show only for some answers, an owner chosen by answer, a deal created with each submission and a CAPTCHA.', es: 'Los formularios pueden tener pasos, campos que aparecen según la respuesta, dueño elegido por respuesta, un deal creado con cada envío y CAPTCHA.', pt: 'Os formulários podem ter etapas, campos que aparecem conforme a resposta, responsável escolhido pela resposta, um negócio criado a cada envio e CAPTCHA.' },
      { product: 'crm', en: 'New Documents and Videos: share PDFs with a link per contact and see time per page, or record your camera or screen and see each play on the contact timeline.', es: 'Nuevos Documentos y Videos: compartí PDFs con un link por contacto y mirá el tiempo por página, o grabá tu cámara o pantalla y mirá cada reproducción en el timeline del contacto.', pt: 'Novos Documentos e Vídeos: compartilhe PDFs com um link por contato e veja o tempo por página, ou grave a câmera ou a tela e veja cada reprodução na timeline do contato.' },
      { product: 'crm', en: 'Webhooks add company, task, property change, delete, quote and form events, a filter by property, a delivery log with resend and pause.', es: 'Los webhooks suman eventos de empresa, tareas, cambio de propiedad, borrado, cotizaciones y formularios, filtro por propiedad, log de entregas con reenvío y pausa.', pt: 'Os webhooks ganham eventos de empresa, tarefas, alteração de propriedade, exclusão, cotações e formulários, filtro por propriedade, log de entregas com reenvio e pausa.' },
    ],
  },
  {
    id: '2026-10-24-crm-channels',
    date: '2026-10-24',
    title: {
      en: 'CRM: Outlook sync, browser calling, a Gmail extension and a CRM that works on the phone',
      es: 'CRM: sync de Outlook, llamadas desde el navegador, extensión de Gmail y un CRM que anda en el teléfono',
      pt: 'CRM: sincronização com Outlook, chamadas pelo navegador, extensão do Gmail e um CRM que funciona no celular',
    },
    items: [
      { product: 'crm', en: 'Connect Outlook or Microsoft 365: email with your contacts and calendar meetings land on the timeline, and emails and sequences go out from your Outlook with open and click tracking.', es: 'Conectá Outlook o Microsoft 365: los emails con tus contactos y las reuniones del calendario llegan al timeline, y los emails y secuencias salen desde tu Outlook con tracking de aperturas y clics.', pt: 'Conecte o Outlook ou o Microsoft 365: os emails com seus contatos e as reuniões do calendário chegam à linha do tempo, e os emails e sequências saem do seu Outlook com rastreamento de aberturas e cliques.' },
      { product: 'crm', en: 'Call contacts from the browser with your Twilio account. Each call is logged with duration and outcome, can be recorded with a notice to the other person, and gets a transcript and an AI summary. Calls to the workspace number ring in the browser.', es: 'Llamá a tus contactos desde el navegador con tu cuenta de Twilio. Cada llamada queda registrada con duración y resultado, se puede grabar con aviso a la otra persona y suma transcripción y resumen con IA. Las llamadas al número del workspace suenan en el navegador.', pt: 'Ligue para seus contatos pelo navegador com sua conta da Twilio. Cada chamada fica registrada com duração e resultado, pode ser gravada com aviso à outra pessoa e ganha transcrição e resumo com IA. As chamadas para o número do workspace tocam no navegador.' },
      { product: 'crm', en: 'A Chrome extension for Gmail shows the sender\'s contact, deals and tasks next to each email, creates contacts and tasks, logs emails, inserts CRM templates and tracks opens from compose. Download it from Settings › Integrations.', es: 'Una extensión de Chrome para Gmail muestra contacto, deals y tareas del remitente al lado de cada email, crea contactos y tareas, registra emails, inserta templates del CRM y trackea aperturas desde la redacción. Se descarga desde Configuración › Integraciones.', pt: 'Uma extensão do Chrome para Gmail mostra contato, negócios e tarefas do remetente ao lado de cada email, cria contatos e tarefas, registra emails, insere templates do CRM e rastreia aberturas na redação. Baixe em Configurações › Integrações.' },
      { product: 'crm', en: 'On the phone, lists turn into cards with large call and WhatsApp buttons and the deal board shows one stage per screen with a Move to menu. The CRM installs on the home screen, opens views you already visited without signal and syncs changes when the connection is back.', es: 'En el teléfono las listas pasan a tarjetas con botones grandes de llamar y WhatsApp, y el board de deals muestra una etapa por pantalla con menú Mover a. El CRM se instala en la pantalla de inicio, abre sin señal las vistas que ya visitaste y sincroniza los cambios al volver la red.', pt: 'No celular as listas viram cartões com botões grandes de ligar e WhatsApp, e o quadro de negócios mostra uma etapa por tela com menu Mover para. O CRM se instala na tela inicial, abre sem sinal as telas que você já visitou e sincroniza as alterações quando a conexão volta.' },
    ],
  },
  {
    id: '2026-10-23-groups',
    date: '2026-10-23',
    title: {
      en: 'Groups: a shared inbox for WhatsApp chats and customer groups',
      es: 'Groups: una bandeja compartida para chats y grupos de WhatsApp',
      pt: 'Groups: uma caixa compartilhada para chats e grupos de WhatsApp',
    },
    items: [
      { product: 'groups', en: 'Connect several numbers with the official WhatsApp Cloud API or a self-hosted WAHA or Evolution API gateway by QR. Credentials are stored encrypted and webhooks are verified and deduplicated.', es: 'Conectá varios números con la WhatsApp Cloud API oficial o con un gateway WAHA o Evolution API propio por QR. Las credenciales se guardan cifradas y los webhooks se verifican y no se duplican.', pt: 'Conecte vários números com a WhatsApp Cloud API oficial ou com um gateway WAHA ou Evolution API próprio por QR. As credenciais ficam criptografadas e os webhooks são verificados e não se duplicam.' },
      { product: 'groups', en: 'One inbox for 1:1 chats and groups: replies with media and quotes, reactions, internal notes, assignment, labels, quick replies, filters for unread, unanswered and overdue, message search and keyboard shortcuts.', es: 'Una bandeja para chats 1:1 y grupos: respuestas con media y citas, reacciones, notas internas, asignación, etiquetas, respuestas rápidas, filtros de sin leer, sin responder y vencidos, búsqueda en mensajes y atajos de teclado.', pt: 'Uma caixa para chats 1:1 e grupos: respostas com mídia e citações, reações, notas internas, atribuição, etiquetas, respostas rápidas, filtros de não lidas, sem resposta e vencidas, busca nas mensagens e atalhos de teclado.' },
      { product: 'groups', en: 'Create groups one by one or from a CSV, add and remove members in many groups, promote admins, reset invite links and keep your own properties per group.', es: 'Creá grupos de a uno o desde un CSV, agregá y quitá miembros en muchos grupos, promové admins, regenerá links de invitación y guardá propiedades propias por grupo.', pt: 'Crie grupos um a um ou a partir de um CSV, adicione e remova membros em muitos grupos, promova admins, redefina links de convite e guarde propriedades próprias por grupo.' },
      { product: 'groups', en: 'Tickets from messages by hand, by emoji reaction or by keyword, with priority, assignee and SLA due times; broadcasts and scheduled messages with variables, a pace per minute and status per recipient; analytics and CSV export.', es: 'Tickets desde mensajes a mano, por reacción con emoji o por palabra clave, con prioridad, asignado y vencimientos de SLA; envíos masivos y mensajes programados con variables, ritmo por minuto y estado por destinatario; métricas y export CSV.', pt: 'Tickets a partir de mensagens à mão, por reação com emoji ou por palavra-chave, com prioridade, responsável e vencimentos de SLA; envios em massa e mensagens agendadas com variáveis, ritmo por minuto e status por destinatário; métricas e exportação CSV.' },
      { product: 'crm', en: 'Company and contact records show their linked WhatsApp chats and groups, with the latest messages and open tickets.', es: 'Las fichas de empresa y contacto muestran sus chats y grupos de WhatsApp vinculados, con los últimos mensajes y los tickets abiertos.', pt: 'As fichas de empresa e contato mostram seus chats e grupos de WhatsApp vinculados, com as últimas mensagens e os tickets abertos.' },
      { product: 'flow', en: 'New triggers for WhatsApp message received and ticket created or updated, and a step that sends a WhatsApp message. The same events go to outgoing webhooks.', es: 'Disparadores nuevos para mensaje de WhatsApp recibido y ticket creado o actualizado, y un paso que manda un WhatsApp. Los mismos eventos salen por webhooks.', pt: 'Novos gatilhos para mensagem de WhatsApp recebida e ticket criado ou atualizado, e um passo que envia um WhatsApp. Os mesmos eventos saem por webhooks.' },
      { product: 'agents', en: 'Assign an agent to a WhatsApp chat or group and it answers new messages with its knowledge and tools, handing off to the team when needed.', es: 'Asigná un agente a un chat o grupo de WhatsApp y responde los mensajes nuevos con su conocimiento y herramientas, y deriva al equipo cuando hace falta.', pt: 'Atribua um agente a um chat ou grupo de WhatsApp e ele responde as mensagens novas com seu conhecimento e ferramentas, e passa para a equipe quando precisa.' },
    ],
  },
  {
    id: '2026-10-22-imports',
    date: '2026-10-22',
    title: {
      en: 'Bring your data from HubSpot, Pipedrive, Linear, Jira, GitHub, Calendly and Notion, plus Notion-style databases in Docs',
      es: 'Traé tus datos de HubSpot, Pipedrive, Linear, Jira, GitHub, Calendly y Notion, y bases de datos estilo Notion en Docs',
      pt: 'Traga seus dados do HubSpot, Pipedrive, Linear, Jira, GitHub, Calendly e Notion, e bancos de dados estilo Notion no Docs',
    },
    items: [
      { product: 'crm', en: 'Import a whole HubSpot or Pipedrive account with a token: owners, custom fields, pipelines, companies, contacts, deals, associations, notes, calls, meetings, tasks and emails. A preview shows counts and owner matching first, large accounts import in steps, and running it again updates instead of duplicating. New CSV presets for HubSpot, Salesforce, Zoho, Pipedrive, Attio and Close exports.', es: 'Importá una cuenta entera de HubSpot o Pipedrive con un token: responsables, campos propios, pipelines, empresas, contactos, deals, asociaciones, notas, llamadas, reuniones, tareas y emails. Primero una vista previa con conteos y el emparejamiento de responsables; las cuentas grandes entran por partes, y volver a correrlo actualiza en vez de duplicar. Presets de CSV nuevos para exports de HubSpot, Salesforce, Zoho, Pipedrive, Attio y Close.', pt: 'Importe uma conta inteira do HubSpot ou Pipedrive com um token: responsáveis, campos próprios, pipelines, empresas, contatos, negócios, associações, notas, ligações, reuniões, tarefas e emails. Primeiro uma prévia com contagens e a correspondência de responsáveis; contas grandes entram em partes, e rodar de novo atualiza em vez de duplicar. Novos presets de CSV para exports do HubSpot, Salesforce, Zoho, Pipedrive, Attio e Close.' },
      { product: 'track', en: 'Import issues from Linear, Jira, GitHub Issues or any CSV, with statuses, assignees, labels, sub-issues and comments, and export issues to CSV.', es: 'Importá issues de Linear, Jira, GitHub Issues o cualquier CSV, con estados, asignados, etiquetas, sub-issues y comentarios, y exportá issues a CSV.', pt: 'Importe issues do Linear, Jira, GitHub Issues ou qualquer CSV, com status, responsáveis, etiquetas, sub-issues e comentários, e exporte issues para CSV.' },
      { product: 'cal', en: 'Import schedules, event types and upcoming bookings from Calendly. Imported bookings send no emails.', es: 'Importá horarios, tipos de evento y reservas próximas desde Calendly. Las reservas importadas no mandan emails.', pt: 'Importe horários, tipos de evento e reservas futuras do Calendly. As reservas importadas não enviam emails.' },
      { product: 'docs', en: 'Import a Notion export with its page tree, icons, links, files, callouts and databases.', es: 'Importá un export de Notion con su árbol de páginas, íconos, links, archivos, recuadros y bases de datos.', pt: 'Importe um export do Notion com sua árvore de páginas, ícones, links, arquivos, destaques e bancos de dados.' },
      { product: 'docs', en: 'Databases with 13 property types (status, person, checkbox, URL and more), rows that open as pages, named table, board and gallery views, filters, multi-key sort, grouping and full keyboard control.', es: 'Bases de datos con 13 tipos de propiedad (estado, persona, checkbox, URL y más), filas que abren como página, vistas con nombre en tabla, board y galería, filtros, orden por varias claves, agrupar y manejo completo con teclado.', pt: 'Bancos de dados com 13 tipos de propriedade (status, pessoa, checkbox, URL e mais), linhas que abrem como página, visualizações nomeadas em tabela, board e galeria, filtros, ordenação por várias chaves, agrupamento e controle total pelo teclado.' },
    ],
  },
  {
    id: '2026-10-21-backlog',
    date: '2026-10-21',
    title: {
      en: 'Nested blocks and undo in Docs, workshops in Board, milestones in Track and a sidebar list in every app that needs one',
      es: 'Bloques anidados y deshacer en Docs, talleres en Board, hitos en Track y listado en el sidebar de cada app que lo necesita',
      pt: 'Blocos aninhados e desfazer no Docs, oficinas no Board, marcos no Track e lista na barra lateral de cada app que precisa',
    },
    items: [
      { product: 'docs', en: 'Nest blocks with Tab, toggle lists and headings, callouts, select several blocks to move, duplicate or delete them, real undo and redo, paste Markdown or HTML as blocks, import .md and .docx, comment threads with @mentions, and workspace templates.', es: 'Bloques anidados con Tab, listas y títulos desplegables, recuadros, seleccionar varios bloques para mover, duplicar o borrar, deshacer y rehacer de verdad, pegar Markdown o HTML como bloques, importar .md y .docx, hilos de comentarios con @menciones y plantillas del workspace.', pt: 'Blocos aninhados com Tab, listas e títulos recolhíveis, destaques, selecionar vários blocos para mover, duplicar ou apagar, desfazer e refazer de verdade, colar Markdown ou HTML como blocos, importar .md e .docx, conversas de comentários com @menções e templates do workspace.' },
      { product: 'track', en: 'Email notifications (right away or a daily digest, off by default), automatic cycles that roll over unfinished issues, issue templates, recurring issues, milestones, snooze and remind me, and projects listed in the sidebar.', es: 'Avisos por email (al momento o resumen diario, apagados por defecto), ciclos automáticos que pasan lo pendiente al siguiente, plantillas de issue, issues que se repiten, hitos, posponer y recordarme, y los proyectos en el sidebar.', pt: 'Avisos por email (na hora ou resumo diário, desligados por padrão), ciclos automáticos que levam o pendente para o próximo, templates de issue, issues recorrentes, marcos, adiar e lembrar, e os projetos na barra lateral.' },
      { product: 'flow', en: 'Wait until a date or a resume call, test one step with pinned sample data, workspace data tables, approval by email or Slack, and new triggers for Notes, Board, Agents, CRM tasks, Chat and Cal.', es: 'Esperar hasta una fecha o una llamada de reanudación, probar un paso con datos de ejemplo fijados, tablas de datos del workspace, aprobación por email o Slack, y disparadores nuevos de Notes, Board, Agents, tareas del CRM, Chat y Cal.', pt: 'Esperar até uma data ou uma chamada de retomada, testar um passo com dados de exemplo fixados, tabelas de dados do workspace, aprovação por email ou Slack, e novos gatilhos de Notes, Board, Agents, tarefas do CRM, Chat e Cal.' },
      { product: 'robots', en: 'Extract repeating cards as rows, follow pagination, detect changes between runs, log in behind 2FA, run robots from the API in bulk, and let Agents use robots as tools.', es: 'Extraer tarjetas repetidas como filas, seguir la paginación, detectar cambios entre corridas, entrar con 2FA, correr robots por API y en lote, y que Agents use robots como herramientas.', pt: 'Extrair cartões repetidos como linhas, seguir a paginação, detectar mudanças entre execuções, entrar com 2FA, rodar robôs pela API e em lote, e deixar o Agents usar robôs como ferramentas.' },
      { product: 'board', en: 'Sticky notes with colors and tags, stickies that become Track issues, a workshop timer and dot voting, boards embedded in Docs, per-board access with guest edit links, and boards listed in the sidebar.', es: 'Stickies con colores y etiquetas, stickies que se vuelven issues de Track, temporizador y votación para talleres, pizarras dentro de Docs, acceso por pizarra con links de edición para invitados, y las pizarras en el sidebar.', pt: 'Notas adesivas com cores e tags, notas que viram issues do Track, cronômetro e votação para oficinas, quadros dentro do Docs, acesso por quadro com links de edição para convidados, e os quadros na barra lateral.' },
      { product: 'notes', en: 'Send a note or its to-dos to Track, share notes and notebooks with teammates, and see database headers on shared notes.', es: 'Mandar una nota o sus pendientes a Track, compartir notas y libretas con el equipo, y ver los encabezados de las tablas en notas compartidas.', pt: 'Enviar uma nota ou suas tarefas para o Track, compartilhar notas e cadernos com a equipe, e ver os cabeçalhos das tabelas em notas compartilhadas.' },
      { product: 'cal', en: 'Locations the invitee chooses (Zoom, Teams, Meet, phone, in person), collective event types, routing forms that end in a URL or a message with logged submissions, and group events with seats.', es: 'Ubicaciones que elige el invitado (Zoom, Teams, Meet, teléfono, en persona), eventos colectivos, formularios de derivación que terminan en una URL o un mensaje y guardan cada respuesta, y eventos grupales con cupos.', pt: 'Locais que o convidado escolhe (Zoom, Teams, Meet, telefone, presencial), eventos coletivos, formulários de roteamento que terminam numa URL ou mensagem e guardam cada resposta, e eventos em grupo com vagas.' },
      { product: 'link', en: 'Analytics filters and time zone, a shareable read-only stats page, domain, slug and title per row in bulk create with a preview, and folders with view or edit access.', es: 'Filtros y zona horaria en estadísticas, una página pública de estadísticas de solo lectura, dominio, slug y título por fila en la creación en lote con vista previa, y carpetas con acceso de lectura o edición.', pt: 'Filtros e fuso horário nas estatísticas, uma página pública de estatísticas somente leitura, domínio, slug e título por linha na criação em lote com prévia, e pastas com acesso de leitura ou edição.' },
      { product: 'crm', en: 'Owner and custom field columns that sort, duplicate company merge, required properties per stage, call and WhatsApp logging with outcomes, company logos, and search by full name.', es: 'Columnas de responsable y campos propios que se ordenan, unión de empresas duplicadas, propiedades obligatorias por etapa, registro de llamadas y WhatsApp con resultado, logos de empresas y búsqueda por nombre completo.', pt: 'Colunas de responsável e campos personalizados que ordenam, união de empresas duplicadas, propriedades obrigatórias por etapa, registro de ligações e WhatsApp com resultado, logos de empresas e busca por nome completo.' },
      { product: 'chat', en: 'A public REST API and webhooks for messages, assignment and resolve.', es: 'API REST pública y webhooks para mensajes, asignación y cierre.', pt: 'API REST pública e webhooks para mensagens, atribuição e encerramento.' },
      { product: 'agents', en: 'Owners can require a teammate to approve chosen write actions before they run.', es: 'Quien administra puede pedir que un compañero apruebe ciertas acciones antes de que se ejecuten.', pt: 'Quem administra pode exigir que alguém da equipe aprove certas ações antes de rodarem.' },
    ],
  },
  {
    id: '2026-10-20-backlog-2',
    date: '2026-10-20',
    title: {
      en: 'Version history in Notes and Board, alerts in Flow and Robots, analytics in Cal and Agents',
      es: 'Historial en Notes y Board, avisos en Flow y Robots, estadísticas en Cal y Agents',
      pt: 'Histórico no Notes e no Board, avisos no Flow e no Robots, estatísticas no Cal e no Agents',
    },
    items: [
      { product: 'flow', en: 'New steps update CRM records, create tasks and update Track issues. Templates format dates and text. Webhooks accept GET, require a key or basic auth and can reply with your own data. Failed runs email the owner and can be replayed, and old runs are pruned after 30 days by default.', es: 'Pasos nuevos para editar registros del CRM, crear tareas y actualizar issues de Track. Las plantillas dan formato a fechas y textos. Los webhooks aceptan GET, piden clave o usuario y contraseña y pueden responder con tus datos. Una corrida que falla avisa por email al dueño y se puede reintentar, y las corridas viejas se borran a los 30 días por defecto.', pt: 'Novos passos para editar registros do CRM, criar tarefas e atualizar issues do Track. Os templates formatam datas e textos. Os webhooks aceitam GET, pedem chave ou usuário e senha e podem responder com seus dados. Uma execução que falha avisa o dono por email e pode ser repetida, e as execuções antigas são apagadas após 30 dias por padrão.' },
      { product: 'link', en: 'utm_term and utm_content with saved UTM templates, link.updated and link.deleted webhooks that can be limited to links, tags or domains, a fuller v1 create API, who created each link, city, region and referrer per click, internal comments and duplicate.', es: 'utm_term y utm_content con plantillas de UTM guardadas, webhooks link.updated y link.deleted que se pueden limitar a links, etiquetas o dominios, una API v1 de creación más completa, quién creó cada link, ciudad, región y origen de cada clic, comentarios internos y duplicar.', pt: 'utm_term e utm_content com templates de UTM salvos, webhooks link.updated e link.deleted que podem ser limitados a links, tags ou domínios, uma API v1 de criação mais completa, quem criou cada link, cidade, região e origem de cada clique, comentários internos e duplicar.' },
      { product: 'robots', en: 'Failed automatic runs email the creator and schedules pause after three failures in a row. A failing step saves a screenshot, the URL and the HTML around it. Steps and loop items can continue on error, Flow has a robot picker, run tables download as CSV and old runs are pruned.', es: 'Una corrida automática que falla avisa por email a quien creó el robot, y el schedule se pausa después de tres fallas seguidas. Un paso que falla guarda captura, URL y el HTML de alrededor. Los pasos y elementos de un loop pueden seguir si fallan, Flow tiene un selector de robot, las tablas se bajan en CSV y las corridas viejas se borran.', pt: 'Uma execução automática que falha avisa por email quem criou o robô, e o agendamento pausa depois de três falhas seguidas. Um passo que falha salva captura, URL e o HTML ao redor. Passos e itens de um loop podem continuar se falharem, o Flow tem um seletor de robô, as tabelas baixam em CSV e as execuções antigas são apagadas.' },
      { product: 'notes', en: 'Link notes with [[ and see backlinks, restore earlier versions, set reminders, search with tag:, notebook:, intitle:, created: and todo:, import Evernote and Markdown files, export to Markdown, and add images and files.', es: 'Links entre notas con [[ y backlinks, versiones anteriores para restaurar, recordatorios, búsqueda con tag:, notebook:, intitle:, created: y todo:, importación desde Evernote y Markdown, exportación a Markdown, e imágenes y archivos.', pt: 'Links entre notas com [[ e backlinks, versões anteriores para restaurar, lembretes, busca com tag:, notebook:, intitle:, created: e todo:, importação do Evernote e de Markdown, exportação para Markdown, e imagens e arquivos.' },
      { product: 'board', en: 'Pasted images are stored as files, history keeps an hourly version you can restore as a copy, five starter templates, comments pinned to the canvas with @mentions, and a shape library that persists and installs from Excalidraw\'s catalog.', es: 'Las imágenes pegadas se guardan como archivos, el historial guarda una versión por hora que se restaura como copia, cinco plantillas para empezar, comentarios fijados en el lienzo con @menciones y una biblioteca de formas que se guarda y se instala desde el catálogo de Excalidraw.', pt: 'As imagens coladas são salvas como arquivos, o histórico guarda uma versão por hora que se restaura como cópia, cinco templates para começar, comentários fixados na tela com @menções e uma biblioteca de formas que fica salva e se instala do catálogo do Excalidraw.' },
      { product: 'chat', en: 'Download a conversation or email it to the visitor, define attributes that must be filled before resolving, and merge duplicate conversations from the same visitor.', es: 'Descargar una conversación o mandarla por email al visitante, atributos que hay que completar antes de resolver, y unir conversaciones duplicadas del mismo visitante.', pt: 'Baixar uma conversa ou enviá-la por email ao visitante, atributos que precisam ser preenchidos antes de resolver, e unir conversas duplicadas do mesmo visitante.' },
      { product: 'agents', en: 'An Analytics tab with resolution, handoffs, tool errors, step limits and topics, and an email to the owner when thumbs down, tool errors or step limits spike.', es: 'Pestaña de estadísticas con resolución, derivaciones, errores de herramientas, topes de pasos y temas, y un email al dueño cuando suben los pulgares abajo, los errores o los topes.', pt: 'Aba de estatísticas com resolução, transferências, erros de ferramentas, limites de passos e temas, e um email ao dono quando sobem os polegares para baixo, os erros ou os limites.' },
      { product: 'cal', en: 'Dropdown, single and multiple choice, long text and phone questions, invitee guests, a booking analytics page and one-off meetings with hand-picked times.', es: 'Preguntas de lista, opción única o múltiple, texto largo y teléfono, invitados extra, una página de estadísticas de reservas y reuniones puntuales con horarios elegidos a mano.', pt: 'Perguntas de lista, escolha única ou múltipla, texto longo e telefone, convidados extras, uma página de estatísticas de agendamentos e reuniões avulsas com horários escolhidos à mão.' },
      { product: 'crm', en: 'Multi-select, URL, phone, currency and user custom fields, files on notes and records, and @mentions in notes and tasks that notify by email.', es: 'Campos propios de selección múltiple, URL, teléfono, moneda y usuario, archivos en notas y registros, y @menciones en notas y tareas que avisan por email.', pt: 'Campos personalizados de seleção múltipla, URL, telefone, moeda e usuário, arquivos em notas e registros, e @menções em notas e tarefas que avisam por email.' },
    ],
  },
  {
    id: '2026-10-20-backlog',
    date: '2026-10-20',
    title: {
      en: 'Recycle bin in CRM, approvals in Cal, images in Docs and tests for Agents',
      es: 'Papelera en el CRM, aprobación en Cal, imágenes en Docs y tests para Agents',
      pt: 'Lixeira no CRM, aprovação no Cal, imagens no Docs e testes para Agents',
    },
    items: [
      { product: 'docs', en: 'Image and file blocks you can upload, paste or drop. Arrow keys move between blocks, search covers page content, Cmd+P opens a page switcher and subpages inherit the parent page\'s sharing.', es: 'Bloques de imagen y archivo que se suben, se pegan o se arrastran. Las flechas pasan de un bloque a otro, la búsqueda mira el contenido de las páginas, Cmd+P abre un selector de páginas y las subpáginas heredan cómo se comparte la página de arriba.', pt: 'Blocos de imagem e arquivo que você envia, cola ou arrasta. As setas passam de um bloco a outro, a busca olha o conteúdo das páginas, Cmd+P abre um seletor de páginas e as subpáginas herdam o compartilhamento da página de cima.' },
      { product: 'crm', en: 'Deleted contacts, companies, deals and activities go to a recycle bin for 90 days. Bulk edit any property, see last contacted, last activity and next activity on every record, and make tasks repeat.', es: 'Los contactos, empresas, deals y actividades borrados quedan 90 días en una papelera. Edición en lote de cualquier propiedad, fechas de último contacto, última actividad y próxima actividad en cada registro, y tareas que se repiten.', pt: 'Contatos, empresas, negócios e atividades apagados ficam 90 dias numa lixeira. Edição em lote de qualquer propriedade, datas de último contato, última atividade e próxima atividade em cada registro, e tarefas que se repetem.' },
      { product: 'cal', en: 'Event types can require host approval, offer start times on their own interval, cap meetings per day, week or month, redirect invitees after booking and keep the booking page\'s UTM parameters.', es: 'Los tipos de evento pueden pedir aprobación del anfitrión, ofrecer horarios con su propio intervalo, limitar reuniones por día, semana o mes, redirigir al invitado después de reservar y guardar los UTM de la página de reserva.', pt: 'Os tipos de evento podem pedir aprovação do anfitrião, oferecer horários com intervalo próprio, limitar reuniões por dia, semana ou mês, redirecionar o convidado depois de agendar e guardar os UTM da página de agendamento.' },
      { product: 'track', en: 'A Markdown editor for descriptions and comments, issue subscriptions with notifications, search inside descriptions and comments, and grouping and more sort options in list and board views.', es: 'Editor Markdown para descripciones y comentarios, suscripción a issues con avisos, búsqueda dentro de descripciones y comentarios, y agrupar y más formas de ordenar en lista y tablero.', pt: 'Editor Markdown para descrições e comentários, inscrição em issues com avisos, busca dentro de descrições e comentários, e agrupar e mais ordenações em lista e quadro.' },
      { product: 'agents', en: 'The playground simulates write actions, saved tests are graded by a model, http_request can send secret headers to allowed domains, and the agent list shows 7-day usage per channel including API and Flow.', es: 'El playground simula las acciones que escriben, los tests guardados los evalúa un modelo, http_request puede mandar headers secretos a dominios permitidos y la lista de agentes muestra el uso de 7 días por canal, API y Flow incluidos.', pt: 'O playground simula as ações de escrita, os testes salvos são avaliados por um modelo, o http_request pode enviar headers secretos para domínios permitidos e a lista de agentes mostra o uso de 7 dias por canal, incluindo API e Flow.' },
      { product: 'chat', en: 'Unread replies are emailed to visitors who left, agents can set themselves away, the inbox has bulk actions, the visitor panel shows page, referrer, browser and language, and agents can edit or delete their messages and notes.', es: 'Las respuestas que el visitante no vio le llegan por email, los agentes pueden ponerse ausentes, el inbox tiene acciones en lote, el panel del visitante muestra página, origen, navegador e idioma, y cada agente puede editar o borrar sus mensajes y notas.', pt: 'As respostas que o visitante não viu chegam por email, os agentes podem ficar ausentes, o inbox tem ações em lote, o painel do visitante mostra página, origem, navegador e idioma, e cada agente pode editar ou apagar suas mensagens e notas.' },
      { product: 'link', en: 'Password-protected links keep their query parameters after unlocking.', es: 'Los links con contraseña conservan sus parámetros después de desbloquearlos.', pt: 'Os links com senha mantêm seus parâmetros depois de desbloqueados.' },
      { product: 'board', en: 'Renaming a board always saves, shows an error if it fails and updates the edit date.', es: 'Renombrar una pizarra siempre guarda, muestra un error si falla y actualiza la fecha de edición.', pt: 'Renomear um quadro sempre salva, mostra um erro se falhar e atualiza a data de edição.' },
    ],
  },
  {
    id: '2026-10-19-backlog',
    date: '2026-10-19',
    title: {
      en: 'Twenty-one fixes from the backlog across ten apps',
      es: 'Veintiún arreglos del backlog en diez apps',
      pt: 'Vinte e uma correções do backlog em dez apps',
    },
    items: [
      { product: 'flow', en: 'Schedules, delays and retries run every minute instead of every hour.', es: 'Los schedules, las esperas y los reintentos corren cada minuto en vez de cada hora.', pt: 'Os agendamentos, as esperas e as novas tentativas rodam a cada minuto em vez de a cada hora.' },
      { product: 'cal', en: 'Reminders and workflow emails go out on time, buffers protect existing bookings too, round-robin spreads bookings fairly and there is a booking.no_show event.', es: 'Los recordatorios y los emails de workflows salen a tiempo, los buffers protegen también a las reservas existentes, el round-robin reparte parejo y hay un evento booking.no_show.', pt: 'Os lembretes e os emails de workflows saem na hora, os buffers protegem também as reservas existentes, o round-robin distribui de forma justa e há um evento booking.no_show.' },
      { product: 'link', en: 'Query parameters on a short link pass to the destination, UTM fields can be edited, and expired or missing links can redirect to your own URL per link or domain.', es: 'Los parámetros de un link corto pasan al destino, los UTM se pueden editar y un link vencido o inexistente puede redirigir a tu propia URL, por link o por dominio.', pt: 'Os parâmetros de um link curto passam para o destino, os UTM podem ser editados e um link expirado ou inexistente pode redirecionar para a sua própria URL, por link ou por domínio.' },
      { product: 'board', en: 'Edits are no longer lost when you leave during a save, and when two people save at once the changes merge element by element.', es: 'Ya no se pierden cambios al salir durante un guardado, y si dos personas guardan a la vez los cambios se combinan elemento por elemento.', pt: 'As alterações não se perdem mais ao sair durante um salvamento, e se duas pessoas salvam ao mesmo tempo as mudanças se combinam elemento por elemento.' },
      { product: 'notes', en: 'Notes warn about edit conflicts between tabs or devices, keep a clip through sign-in and show up in Cmd+K search.', es: 'Notes avisa los conflictos de edición entre pestañas o dispositivos, conserva lo recortado al iniciar sesión y aparece en la búsqueda Cmd+K.', pt: 'O Notes avisa conflitos de edição entre abas ou dispositivos, mantém o recorte ao entrar e aparece na busca Cmd+K.' },
      { product: 'crm', en: 'Merging contacts keeps synced emails, sequences and form history. Deal rotting counts emails and its days are set per stage.', es: 'Fusionar contactos conserva emails sincronizados, secuencias e historial de formularios. El aviso de deal estancado cuenta los emails y sus días se configuran por etapa.', pt: 'Mesclar contatos mantém emails sincronizados, sequências e histórico de formulários. O aviso de negócio parado conta os emails e os dias são definidos por etapa.' },
      { product: 'track', en: 'Authors can edit and delete their comments, and completing a cycle logs which issues it moved.', es: 'Cada autor puede editar y borrar sus comentarios, y completar un ciclo registra qué issues movió.', pt: 'Cada autor pode editar e apagar seus comentários, e concluir um ciclo registra quais issues moveu.' },
      { product: 'agents', en: 'After a handoff the agent stops answering and a teammate can reply from the Conversations tab. Knowledge URLs download on save and refresh daily.', es: 'Después de derivar, el agente deja de responder y una persona del equipo puede contestar desde la pestaña Conversaciones. Las URLs de conocimiento se descargan al guardar y se actualizan cada día.', pt: 'Depois de transferir, o agente para de responder e alguém da equipe pode responder pela aba Conversas. As URLs de conhecimento são baixadas ao salvar e atualizadas todo dia.' },
      { product: 'robots', en: 'Runs wait in line instead of failing when another run is active, so scheduled runs are no longer lost.', es: 'Las corridas esperan en cola en vez de fallar cuando hay otra activa, así no se pierden las programadas.', pt: 'As execuções esperam na fila em vez de falhar quando há outra ativa, assim as agendadas não se perdem.' },
      { product: 'chat', en: 'The widget speaks English, Spanish and Portuguese, and inbox search matches message text.', es: 'El widget habla inglés, español y portugués, y la búsqueda del inbox encuentra el texto de los mensajes.', pt: 'O widget fala inglês, espanhol e português, e a busca do inbox encontra o texto das mensagens.' },
    ],
  },
  {
    id: '2026-10-19-mejoras',
    date: '2026-10-19',
    title: {
      en: 'Page links in Docs, security fixes and requests under review on the board',
      es: 'Links entre páginas en Docs, arreglos de seguridad y pedidos en revisión en el board',
      pt: 'Links entre páginas no Docs, correções de segurança e pedidos em revisão no board',
    },
    items: [
      { product: 'docs', en: 'Typing [[ and picking a page inserts a real link that keeps the page\'s current title. Each page lists the pages that link to it under its title.', es: 'Escribir [[ y elegir una página inserta un link real que muestra el título actual de esa página. Cada página lista, bajo su título, las páginas que la enlazan.', pt: 'Digitar [[ e escolher uma página insere um link real que mostra o título atual dessa página. Cada página lista, abaixo do título, as páginas que apontam para ela.' },
      { product: 'chat', en: 'Visitor emails are marked as verified or not, and the widget supports signed identity verification. An unverified email no longer attaches a chat to an existing CRM contact without confirmation.', es: 'Los emails de visitantes quedan marcados como verificados o no, y el widget acepta verificación de identidad firmada. Un email sin verificar ya no asocia el chat a un contacto existente del CRM sin confirmación.', pt: 'Os emails de visitantes ficam marcados como verificados ou não, e o widget aceita verificação de identidade assinada. Um email não verificado não associa mais o chat a um contato existente do CRM sem confirmação.' },
      { product: 'board', en: 'Feedback you send from the app shows on the board under your requests under review until it is published.', es: 'Lo que mandás desde la burbuja de feedback aparece en el board, en tus pedidos en revisión, hasta que se publica.', pt: 'O que você envia pela bolha de feedback aparece no board, nos seus pedidos em revisão, até ser publicado.' },
    ],
  },
  {
    id: '2026-10-13-cal-track-link',
    date: '2026-10-13',
    title: {
      en: 'Cal schedules and payments, Track with GitHub, Link analytics',
      es: 'Horarios y cobros en Cal, Track con GitHub, analytics en Link',
      pt: 'Horários e cobranças no Cal, Track com GitHub, analytics no Link',
    },
    items: [
      { product: 'cal', en: 'Reusable availability schedules with date overrides. Bookings admin with search, filters, no-show, cancel with reason and host reschedule. Reminder workflows per event type. Paid events with your own Stripe account.', es: 'Horarios de disponibilidad reutilizables con excepciones por fecha. Administración de reservas con búsqueda, filtros, no-show, cancelación con motivo y reprogramación del anfitrión. Recordatorios configurables por tipo de evento. Eventos pagos con tu propia cuenta de Stripe.', pt: 'Horários de disponibilidade reutilizáveis com exceções por data. Administração de reservas com busca, filtros, no-show, cancelamento com motivo e reagendamento pelo anfitrião. Lembretes configuráveis por tipo de evento. Eventos pagos com sua própria conta Stripe.' },
      { product: 'track', en: 'GitHub: pull requests and commits that mention an issue link to it and move it to started or done. Workspace labels, bulk edit (x, shift-click) and a triage queue for issues that come from outside.', es: 'GitHub: los pull requests y commits que mencionan un issue se vinculan y lo mueven a en curso o hecho. Labels del workspace, edición en bloque (x, shift-click) y una cola de triage para lo que llega de afuera.', pt: 'GitHub: pull requests e commits que mencionam uma issue ficam vinculados e a movem para em andamento ou concluída. Labels do workspace, edição em massa (x, shift-click) e uma fila de triagem para o que chega de fora.' },
      { product: 'link', en: 'Workspace analytics with clicks, QR scans, top links, referrers, countries and devices, plus CSV. Country and device targeting, weighted A/B destinations and app deep links. QR codes with your colors and logo.', es: 'Analytics del workspace con clics, escaneos de QR, top links, referrers, países y dispositivos, y CSV. Destinos por país y dispositivo, A/B con pesos y deep links a apps. QR con tus colores y logo.', pt: 'Analytics do workspace com cliques, leituras de QR, top links, referrers, países e dispositivos, e CSV. Destinos por país e dispositivo, A/B com pesos e deep links para apps. QR com suas cores e logo.' },
    ],
  },
  {
    id: '2026-10-13-flow-robots-integrations',
    date: '2026-10-13',
    title: {
      en: 'Flow and Robots: integrations, credentials and a recorder',
      es: 'Flow y Robots: integraciones, credenciales y un grabador',
      pt: 'Flow e Robots: integrações, credenciais e um gravador',
    },
    items: [
      { product: 'flow', en: 'Flow credentials: API keys, logins and tokens encrypted per workspace, never shown again and redacted from run logs. Native nodes for Slack, Google Sheets, Gmail, Stripe (including a signed webhook trigger), Notion, Discord and Telegram.', es: 'Credenciales en Flow: API keys, logins y tokens cifrados por workspace, que no se vuelven a mostrar y se ocultan en los logs. Nodos nativos para Slack, Google Sheets, Gmail, Stripe (con trigger de webhook firmado), Notion, Discord y Telegram.', pt: 'Credenciais no Flow: API keys, logins e tokens criptografados por workspace, que não aparecem de novo e ficam ocultos nos logs. Nós nativos para Slack, Google Sheets, Gmail, Stripe (com trigger de webhook assinado), Notion, Discord e Telegram.' },
      { product: 'flow', en: 'Flow error handling: continue on fail or an error branch per node, an error flow per workflow and re-running a failed run from any step. New nodes to run an agent, run code in a sandbox, merge or aggregate data and call another flow. Cron schedules with time zones, version history with restore and 16 templates.', es: 'Errores en Flow: continuar si falla o rama de error por nodo, un flow de error por workflow y re-ejecutar una corrida fallida desde cualquier paso. Nodos nuevos para ejecutar un agente, correr código en un sandbox, combinar o agregar datos y llamar a otro flow. Schedules con cron y zona horaria, historial de versiones con restaurar y 16 plantillas.', pt: 'Erros no Flow: continuar se falhar ou ramo de erro por nó, um flow de erro por workflow e reexecutar uma execução com falha a partir de qualquer passo. Nós novos para executar um agente, rodar código em um sandbox, juntar ou agregar dados e chamar outro flow. Agendamentos com cron e fuso horário, histórico de versões com restaurar e 16 modelos.' },
      { product: 'robots', en: 'Robots: a bookmarklet recorder that turns your clicks into steps, saved credentials in steps, sessions kept between runs, new download, upload, PDF and custom JavaScript steps, per-step retries, schedules every 15 minutes or by cron, and a local runner by default when self-hosting.', es: 'Robots: un grabador (bookmarklet) que convierte tus clics en pasos, credenciales guardadas en los pasos, sesiones que se mantienen entre corridas, pasos nuevos para descargar, subir archivos, PDF y JavaScript propio, reintentos por paso, schedules cada 15 minutos o por cron, y runner local por defecto en self-host.', pt: 'Robots: um gravador (bookmarklet) que transforma seus cliques em passos, credenciais salvas nos passos, sessões mantidas entre execuções, passos novos para baixar, enviar arquivos, PDF e JavaScript próprio, tentativas por passo, agendamentos a cada 15 minutos ou por cron, e runner local por padrão em self-host.' },
    ],
  },
  {
    id: '2026-10-13-help-center',
    date: '2026-10-13',
    title: {
      en: 'Help center, sharing and a sharper inbox',
      es: 'Centro de ayuda, compartir y una bandeja más completa',
      pt: 'Central de ajuda, compartilhamento e uma caixa de entrada mais completa',
    },
    items: [
      { product: 'docs', en: 'Publish pages to a public help center at /h/your-handle, with search, table of contents and a "Was this helpful?" vote. "Public" is now "AI can use it", separate from publishing.', es: 'Publicá páginas en un centro de ayuda público en /h/tu-handle, con búsqueda, índice y la pregunta "¿Te sirvió?". "Pública" ahora es "La IA puede usarla", separado de publicar.', pt: 'Publique páginas em uma central de ajuda pública em /h/seu-handle, com busca, índice e a pergunta "Ajudou?". "Pública" agora é "A IA pode usá-la", separado de publicar.' },
      { product: 'docs', en: 'Share pages with members or teams as viewers or editors; shared pages show up under "Shared with me". Version history with restore, and export to Markdown or PDF.', es: 'Compartí páginas con miembros o teams para ver o editar; aparecen en "Compartidas conmigo". Historial de versiones con restaurar, y export a Markdown o PDF.', pt: 'Compartilhe páginas com membros ou times para ver ou editar; elas aparecem em "Compartilhadas comigo". Histórico de versões com restauração, e exportação para Markdown ou PDF.' },
      { product: 'chat', en: 'Internal notes with @mentions, conversation tags with an inbox filter, and macros: saved replies that also set status, assign, tag or snooze.', es: 'Notas internas con @menciones, tags de conversación con filtro en la bandeja, y macros: respuestas guardadas que además cambian estado, asignan, etiquetan o posponen.', pt: 'Notas internas com @menções, tags de conversa com filtro na caixa de entrada, e macros: respostas salvas que também mudam status, atribuem, etiquetam ou adiam.' },
      { product: 'chat', en: 'The widget can show a Help tab with your published articles and suggests them while the visitor types. Reports by date range and agent, with CSV export.', es: 'El widget puede mostrar una pestaña de ayuda con tus artículos publicados y sugerirlos mientras el visitante escribe. Reportes por rango de fechas y por agente, con export a CSV.', pt: 'O widget pode mostrar uma aba de ajuda com seus artigos publicados e sugeri-los enquanto o visitante digita. Relatórios por período e por agente, com exportação CSV.' },
    ],
  },
  {
    id: '2026-10-13-app-fixes',
    date: '2026-10-13',
    title: {
      en: 'Faster everyday work across the apps',
      es: 'Menos clics en el día a día de las apps',
      pt: 'Menos cliques no dia a dia dos apps',
    },
    items: [
      { product: 'track', en: 'Cycles from the UI: create, edit, see progress and complete them, moving unfinished issues to the next cycle. Workflow statuses are managed in project settings. Sub-issues and projects are created in a modal; C, J/K and Enter work across Track, and Track actions are in ⌘K.', es: 'Ciclos desde la interfaz: crearlos, editarlos, ver el progreso y completarlos pasando lo pendiente al siguiente. Los estados se gestionan en la configuración del proyecto. Sub-issues y proyectos se crean en un modal; C, J/K y Enter funcionan en todo Track, y sus acciones están en ⌘K.', pt: 'Ciclos pela interface: criar, editar, ver o progresso e concluir passando o pendente para o próximo. Os status são gerenciados nas configurações do projeto. Sub-issues e projetos são criados em um modal; C, J/K e Enter funcionam em todo o Track, e suas ações estão no ⌘K.' },
      { product: 'link', en: 'Select several links to archive, tag or delete them at once. Editing a link opens a side panel.', es: 'Seleccioná varios links para archivarlos, etiquetarlos o borrarlos de una vez. Editar un link abre un panel lateral.', pt: 'Selecione vários links para arquivar, etiquetar ou excluir de uma vez. Editar um link abre um painel lateral.' },
      { product: 'crm', en: 'From a company you create deals and contacts without leaving the page. New workflows start from a modal. Fixed activities by owner and funnel conversion in reports.', es: 'Desde una empresa creás negocios y contactos sin salir de la página. Los workflows nuevos arrancan desde un modal. Se corrigieron las actividades por responsable y la conversión del embudo en reportes.', pt: 'A partir de uma empresa você cria negócios e contatos sem sair da página. Novos workflows começam em um modal. Corrigidas as atividades por responsável e a conversão do funil nos relatórios.' },
      { product: 'docs', en: 'Reorder pages by dragging above or below, or with Alt+↑/↓. Small text and full width are saved per page. Emoji search by name.', es: 'Reordená páginas arrastrando arriba o abajo, o con Alt+↑/↓. Texto chico y ancho completo se guardan por página. Búsqueda de emoji por nombre.', pt: 'Reordene páginas arrastando acima ou abaixo, ou com Alt+↑/↓. Texto pequeno e largura total ficam salvos por página. Busca de emoji por nome.' },
      { product: 'chat', en: 'Reports have their own section.', es: 'Los reportes tienen su propia sección.', pt: 'Os relatórios têm sua própria seção.' },
    ],
  },
  {
    id: '2026-10-13-design-zeros',
    date: '2026-10-13',
    title: {
      en: 'A new look built from zeros',
      es: 'Un diseño nuevo hecho de ceros',
      pt: 'Um visual novo feito de zeros',
    },
    items: [
      { product: 'site', en: 'New logo and favicon, zero dividers and numbering, and a colored zero for each app. Product pages lost the tags, cards and shadows.', es: 'Logo y favicon nuevos, separadores y numeración con ceros, y un cero de color por app. Las páginas de producto perdieron los tags, las cards y las sombras.', pt: 'Logo e favicon novos, divisores e numeração com zeros, e um zero colorido por app. As páginas de produto perderam as tags, os cards e as sombras.' },
      { product: 'site', en: 'Product pages for Flow, Agents, Notes, Board and Robots.', es: 'Páginas de producto para Flow, Agents, Notes, Board y Robots.', pt: 'Páginas de produto para Flow, Agents, Notes, Board e Robots.' },
    ],
  },
  {
    id: '2026-10-13-crm-forms-teams',
    date: '2026-10-13',
    title: {
      en: 'CRM: forms, lead scoring and sales teams',
      es: 'CRM: formularios, lead scoring y equipos de ventas',
      pt: 'CRM: formulários, lead scoring e equipes de vendas',
    },
    items: [
      { product: 'crm', en: 'Forms with a hosted page or an embed for your site: every submission creates or updates the contact, captures UTMs, and can set the owner, lifecycle, list, tags and sequence.', es: 'Formularios con página propia o embebidos en tu sitio: cada envío crea o actualiza el contacto, guarda los UTMs y puede asignar responsable, lifecycle, lista, tags y secuencia.', pt: 'Formulários com página própria ou incorporados no seu site: cada envio cria ou atualiza o contato, guarda os UTMs e pode definir responsável, lifecycle, lista, tags e sequência.' },
      { product: 'crm', en: 'Lead scoring with rules on properties and recent activity (opens, clicks, meetings, forms), with a breakdown of why each contact has its score.', es: 'Lead scoring con reglas sobre propiedades y actividad reciente (aperturas, clics, reuniones, formularios), con el detalle de por qué cada contacto tiene ese puntaje.', pt: 'Lead scoring com regras sobre propriedades e atividade recente (aberturas, cliques, reuniões, formulários), com o detalhe de por que cada contato tem essa pontuação.' },
      { product: 'crm', en: 'Sales teams: members can see all records, only theirs or their team\'s; round-robin assignment of new leads; monthly or quarterly quotas per owner; and API keys with scopes.', es: 'Equipos de ventas: los miembros pueden ver todo, solo lo suyo o lo de su equipo; reparto round-robin de leads nuevos; metas mensuales o trimestrales por responsable; y API keys con permisos.', pt: 'Equipes de vendas: membros podem ver tudo, só o seu ou o da sua equipe; distribuição round-robin de leads novos; metas mensais ou trimestrais por responsável; e chaves de API com permissões.' },
    ],
  },
  {
    id: '2026-10-13-crm-model',
    date: '2026-10-13',
    title: {
      en: 'CRM: products, quotes, associations, tags and currencies',
      es: 'CRM: productos, cotizaciones, asociaciones, tags y monedas',
      pt: 'CRM: produtos, cotações, associações, tags e moedas',
    },
    items: [
      { product: 'crm', en: 'Product catalog and line items on deals: the deal amount adds itself up. Send a quote as a public page your customer can accept with their name; accepting can move the deal to won.', es: 'Catálogo de productos y líneas en los deals: el monto del deal se calcula solo. Mandá una cotización como página pública que tu cliente acepta con su nombre; al aceptarla, el deal puede pasar a ganado.', pt: 'Catálogo de produtos e itens nos deals: o valor do deal se calcula sozinho. Envie uma cotação como página pública que o cliente aceita com o nome; ao aceitar, o deal pode virar ganho.' },
      { product: 'crm', en: 'Contacts and deals can belong to several companies, companies can have parents and children, and everything can be tagged and filtered by tag.', es: 'Contactos y deals pueden estar en varias empresas, las empresas pueden tener madre e hijas, y todo se puede etiquetar y filtrar por tag.', pt: 'Contatos e deals podem estar em várias empresas, empresas podem ter matriz e filiais, e tudo pode receber tags e ser filtrado por tag.' },
      { product: 'crm', en: 'Multi-currency with a base currency and your own exchange rates in reports. Import deals and use a ready-made HubSpot export mapping.', es: 'Multi-moneda con moneda base y tus propios tipos de cambio en los reportes. Importá deals y usá un mapeo listo para exports de HubSpot.', pt: 'Multimoeda com moeda base e suas próprias taxas de câmbio nos relatórios. Importe deals e use um mapeamento pronto para exports do HubSpot.' },
    ],
  },
  {
    id: '2026-10-13-crm-email',
    date: '2026-10-13',
    title: {
      en: 'CRM: Gmail sync, templates, tracking and sequences',
      es: 'CRM: sync de Gmail, plantillas, tracking y secuencias',
      pt: 'CRM: sync do Gmail, modelos, rastreamento e sequências',
    },
    items: [
      {
        product: 'crm',
        en: 'Gmail now syncs in the background: emails with your contacts land on their timeline, grouped by thread, and you can reply from the CRM. Emails are sent from your own Gmail.',
        es: 'Gmail ahora se sincroniza solo: los emails con tus contactos aparecen en su timeline, agrupados por hilo, y podés responder desde el CRM. Los emails salen desde tu propio Gmail.',
        pt: 'O Gmail agora sincroniza sozinho: os emails com seus contatos aparecem na timeline, agrupados por conversa, e você responde pelo CRM. Os emails saem do seu próprio Gmail.',
      },
      {
        product: 'crm',
        en: 'Templates and snippets with variables, an AI draft button, and open and click tracking with notifications.',
        es: 'Plantillas y snippets con variables, un botón para redactar con IA, y aviso de aperturas y clics con notificaciones.',
        pt: 'Modelos e snippets com variáveis, um botão para redigir com IA, e rastreamento de aberturas e cliques com notificações.',
      },
      {
        product: 'crm',
        en: 'Sequences: automatic follow-up emails and tasks with waits, business days and send windows. Contacts leave on their own when they reply, book a meeting or unsubscribe.',
        es: 'Secuencias: emails y tareas de seguimiento automáticos con esperas, días hábiles y horarios de envío. Los contactos salen solos cuando responden, agendan una reunión o se dan de baja.',
        pt: 'Sequências: emails e tarefas de acompanhamento automáticos com esperas, dias úteis e janelas de envio. Os contatos saem sozinhos quando respondem, agendam uma reunião ou cancelam a inscrição.',
      },
    ],
  },
  {
    id: '2026-10-13-robots',
    date: '2026-10-13',
    title: {
      en: 'Robots: browser automations',
      es: 'Robots: automatizaciones en el navegador',
      pt: 'Robots: automações no navegador',
    },
    items: [
      {
        product: 'robots',
        en: 'New app: Robots, an open-source alternative to UiPath. Build step by step (open a page, click, fill, extract text or tables, take screenshots, loops and conditions), run on demand, on a schedule or from a Flow, and get the data back as JSON.',
        es: 'App nueva: Robots, una alternativa open source a UiPath. Armalos paso a paso (abrir una página, hacer clic, completar, extraer textos o tablas, sacar capturas, loops y condiciones), correlos a mano, con horario o desde un Flow, y recibí los datos en JSON.',
        pt: 'App novo: Robots, uma alternativa open source ao UiPath. Monte passo a passo (abrir uma página, clicar, preencher, extrair textos ou tabelas, tirar capturas, loops e condições), rode manualmente, com horário ou a partir de um Flow, e receba os dados em JSON.',
      },
    ],
  },
  {
    id: '2026-10-13-agents',
    date: '2026-10-13',
    title: {
      en: 'Agents: AI agents that answer and take action',
      es: 'Agents: agentes de IA que responden y actúan',
      pt: 'Agents: agentes de IA que respondem e agem',
    },
    items: [
      {
        product: 'agents',
        en: 'New app: Agents, an open-source alternative to Intercom Fin. Give an agent instructions and knowledge (your Docs and web pages), and tools across the suite: search knowledge, save leads to the CRM, offer times and book meetings in Cal, create Track issues, run Flow automations and hand off to a person.',
        es: 'App nueva: Agents, una alternativa open source a Intercom Fin. Dale a un agente instrucciones, conocimiento (tus Docs y páginas web) y herramientas de toda la suite: buscar en el conocimiento, guardar leads en el CRM, ofrecer horarios y agendar en Cal, crear issues en Track, correr automatizaciones de Flow y derivar a una persona.',
        pt: 'App novo: Agents, uma alternativa open source ao Intercom Fin. Dê a um agente instruções, conhecimento (seus Docs e páginas web) e ferramentas de toda a suíte: buscar no conhecimento, salvar leads no CRM, oferecer horários e agendar no Cal, criar issues no Track, rodar automações do Flow e transferir para uma pessoa.',
      },
      {
        product: 'chat',
        en: 'Put an agent on any Chat widget, share it as a public page at zerosoft.ai/a/<handle>, or call it from the API. Test it in a playground that shows every tool call.',
        es: 'Poné un agente en cualquier widget de Chat, compartilo como página pública en zerosoft.ai/a/<handle> o llamalo desde la API. Probalo en un playground que muestra cada herramienta que usa.',
        pt: 'Coloque um agente em qualquer widget do Chat, compartilhe como página pública em zerosoft.ai/a/<handle> ou chame pela API. Teste num playground que mostra cada ferramenta que ele usa.',
      },
    ],
  },
  {
    id: '2026-10-13-tools',
    date: '2026-10-13',
    title: {
      en: 'Free tools, no sign-up',
      es: 'Herramientas gratis, sin registro',
      pt: 'Ferramentas grátis, sem cadastro',
    },
    items: [
      {
        product: 'site',
        en: 'zerosoft.ai/tools: email signature, QR code, invoice and privacy policy generators, a SaaS cost calculator, a website grader, a UTM builder, and AI tools for business names, emails, ad copy, buyer personas and blog ideas.',
        es: 'zerosoft.ai/tools: generadores de firma de email, códigos QR, facturas y política de privacidad, una calculadora de costos de SaaS, un evaluador de sitios web, un armador de UTMs, y herramientas con IA para nombres de empresa, emails, anuncios, buyer personas e ideas para el blog.',
        pt: 'zerosoft.ai/tools: geradores de assinatura de email, QR codes, faturas e política de privacidade, uma calculadora de custos de SaaS, um avaliador de sites, um montador de UTMs, e ferramentas com IA para nomes de empresa, emails, anúncios, buyer personas e ideias para o blog.',
      },
    ],
  },
  {
    id: '2026-10-13-quick-create',
    date: '2026-10-13',
    title: {
      en: 'Create anything with C, without leaving the list',
      es: 'Creá cualquier cosa con C, sin salir de la lista',
      pt: 'Crie qualquer coisa com C, sem sair da lista',
    },
    items: [
      { product: 'link', en: 'New link in a modal (press C or paste a URL anywhere); the short link is copied right away. Cleaner table on desktop and mobile.', es: 'Link nuevo en un modal (apretá C o pegá una URL en cualquier lado); el link corto se copia al instante. Tabla más limpia en desktop y mobile.', pt: 'Link novo em um modal (aperte C ou cole uma URL em qualquer lugar); o link curto é copiado na hora. Tabela mais limpa no desktop e no celular.' },
      { product: 'crm', en: 'Contacts, companies, deals and tasks are created in a modal. One row of timeline tabs, a lighter reports bar and a denser settings page. Fixed duplicated "other" rows in reports.', es: 'Contactos, empresas, deals y tareas se crean en un modal. Una sola fila de pestañas en el timeline, una barra de reportes más liviana y configuración más compacta. Arreglamos filas "otros" duplicadas en reportes.', pt: 'Contatos, empresas, deals e tarefas são criados em um modal. Uma só linha de abas na timeline, barra de relatórios mais leve e configurações mais compactas. Corrigimos linhas "outros" duplicadas em relatórios.' },
      { product: 'cal', en: 'New event types start active with Mon–Fri 9–17, so your link works right away. Delete event types, toggle them from the list, and bookings split into upcoming, past and cancelled.', es: 'Los tipos de evento nuevos arrancan activos con lunes a viernes de 9 a 17, así tu link funciona enseguida. Podés borrarlos, activarlos desde la lista, y las reservas se separan en próximas, pasadas y canceladas.', pt: 'Tipos de evento novos começam ativos com segunda a sexta das 9 às 17, então seu link funciona na hora. Dá para excluí-los, ativá-los pela lista, e as reservas se dividem em próximas, passadas e canceladas.' },
      { product: 'chat', en: 'The conversation no longer jumps on every refresh, J/K moves between conversations, and canned responses and rules are edited in a modal.', es: 'La conversación ya no salta en cada actualización, J/K te mueve entre conversaciones, y las respuestas guardadas y reglas se editan en un modal.', pt: 'A conversa não pula mais a cada atualização, J/K navega entre conversas, e respostas salvas e regras são editadas em um modal.' },
      { product: 'docs', en: 'Move to trash no longer deletes the page permanently and takes subpages along. Autosave waits for the save and never loses your last edit. Collapsible page tree and a people picker for sharing.', es: 'Mover a la papelera ya no borra la página definitivamente y se lleva las subpáginas. El autoguardado espera a guardar y no pierde tu última edición. Árbol de páginas plegable y selector de personas para compartir.', pt: 'Mover para a lixeira não exclui mais a página definitivamente e leva as subpáginas. O salvamento automático espera salvar e não perde sua última edição. Árvore de páginas recolhível e seletor de pessoas para compartilhar.' },
    ],
  },
  {
    id: '2026-10-13-notes-board',
    date: '2026-10-13',
    title: {
      en: 'Notes and Board: two new apps for you',
      es: 'Notes y Board: dos apps nuevas para vos',
      pt: 'Notes e Board: dois apps novos para você',
    },
    items: [
      {
        product: 'notes',
        en: 'Notes, an open-source alternative to Evernote: press N for a new note, notebooks, tags, pinning, checklists you can tick, full-text search, a web clipper, read-only share links and "Ask AI" over your notes. Your notes are private to you.',
        es: 'Notes, una alternativa open source a Evernote: apretá N para una nota nueva, libretas, tags, fijadas, checklists para tildar, búsqueda de texto completo, un clipper web, links de solo lectura y "Preguntale a la IA" sobre tus notas. Tus notas son solo tuyas.',
        pt: 'Notes, uma alternativa open source ao Evernote: aperte N para uma nota nova, cadernos, tags, fixadas, checklists para marcar, busca de texto completo, um clipper web, links somente leitura e "Pergunte à IA" sobre suas notas. Suas notas são só suas.',
      },
      {
        product: 'board',
        en: 'Board, an open-source alternative to Miro: an infinite whiteboard with autosave, thumbnails, duplicate and read-only share links.',
        es: 'Board, una alternativa open source a Miro: una pizarra infinita con autoguardado, miniaturas, duplicar y links de solo lectura.',
        pt: 'Board, uma alternativa open source ao Miro: um quadro infinito com salvamento automático, miniaturas, duplicar e links somente leitura.',
      },
    ],
  },
  {
    id: '2026-10-13-flow',
    date: '2026-10-13',
    title: {
      en: 'Flow: visual automations across every app',
      es: 'Flow: automatizaciones visuales entre todas las apps',
      pt: 'Flow: automações visuais entre todos os apps',
    },
    items: [
      {
        product: 'flow',
        en: 'New app: Flow, an open-source alternative to Zapier and n8n. Start from an event in any app (a booking, a click, a new deal, a task, a chat message), an incoming webhook or a schedule, then chain conditions, delays, loops, HTTP requests, emails, AI steps and native actions.',
        es: 'App nueva: Flow, una alternativa open source a Zapier y n8n. Arrancá desde un evento de cualquier app (una reserva, un clic, un deal nuevo, una tarea, un mensaje de chat), un webhook entrante o un horario, y encadená condiciones, esperas, loops, pedidos HTTP, emails, pasos con IA y acciones nativas.',
        pt: 'App novo: Flow, uma alternativa open source ao Zapier e ao n8n. Comece por um evento de qualquer app (uma reserva, um clique, um deal novo, uma tarefa, uma mensagem de chat), um webhook de entrada ou um horário, e encadeie condições, esperas, loops, requisições HTTP, emails, passos com IA e ações nativas.',
      },
      {
        product: 'flow',
        en: 'Visual editor with a variable picker, test runs with step-by-step logs, and five starter templates.',
        es: 'Editor visual con selector de variables, ejecuciones de prueba con el log de cada paso y cinco plantillas para empezar.',
        pt: 'Editor visual com seletor de variáveis, execuções de teste com o log de cada passo e cinco modelos para começar.',
      },
    ],
  },
  {
    id: '2026-10-13-roadmap',
    date: '2026-10-13',
    title: {
      en: 'A public roadmap built from your feedback',
      es: 'Un roadmap público hecho con tu feedback',
      pt: 'Um roadmap público feito com o seu feedback',
    },
    items: [
      {
        product: 'site',
        en: 'zerosoft.ai/roadmap shows what is planned, in progress and done. Every piece of feedback is grouped into these items, and you can upvote what you need.',
        es: 'zerosoft.ai/roadmap muestra lo planeado, en curso y hecho. Cada feedback se agrupa en estos ítems, y podés votar lo que necesitás.',
        pt: 'zerosoft.ai/roadmap mostra o que está planejado, em andamento e feito. Cada feedback é agrupado nesses itens, e você pode votar no que precisa.',
      },
      {
        product: 'chat',
        en: 'The Chat widget can now identify signed-in visitors with zsChat.identify({ email, name }).',
        es: 'El widget de Chat ahora puede identificar visitantes logueados con zsChat.identify({ email, name }).',
        pt: 'O widget do Chat agora pode identificar visitantes logados com zsChat.identify({ email, name }).',
      },
    ],
  },
  {
    id: '2026-10-13-track-tasks',
    date: '2026-10-13',
    title: {
      en: 'Track: add, check off and edit tasks without leaving the list',
      es: 'Track: crear, tildar y editar tareas sin salir de la lista',
      pt: 'Track: criar, marcar e editar tarefas sem sair da lista',
    },
    items: [
      {
        product: 'track',
        en: 'Type a title and press Enter at the bottom of the list or any board column to add a task. Press C anywhere for a quick modal. Shortcuts like !high and @tomorrow set priority and due date.',
        es: 'Escribí un título y apretá Enter al final de la lista o de cualquier columna del tablero para crear una tarea. Apretá C en cualquier lado para un modal rápido. Atajos como !alta y @mañana ponen prioridad y fecha.',
        pt: 'Digite um título e aperte Enter no fim da lista ou de qualquer coluna do quadro para criar uma tarefa. Aperte C em qualquer lugar para um modal rápido. Atalhos como !alta e @amanhã definem prioridade e data.',
      },
      {
        product: 'track',
        en: 'Check tasks off from the list, change status, priority, assignee and due date in place, and drag cards between board columns. New "My tasks" view groups what is yours by overdue, today and upcoming.',
        es: 'Tildá tareas desde la lista, cambiá estado, prioridad, responsable y fecha en el lugar, y arrastrá tarjetas entre columnas del tablero. Nueva vista "Mis tareas" con lo tuyo agrupado en vencido, hoy y próximo.',
        pt: 'Marque tarefas pela lista, mude status, prioridade, responsável e data no lugar, e arraste cartões entre colunas do quadro. Nova visão "Minhas tarefas" com o que é seu agrupado em atrasado, hoje e próximo.',
      },
    ],
  },
  {
    id: '2026-10-13-chat-ai',
    date: '2026-10-13',
    title: {
      en: 'Chat: an AI bot that answers from your public docs',
      es: 'Chat: un bot con IA que responde con tus docs públicas',
      pt: 'Chat: um bot com IA que responde com seus docs públicos',
    },
    items: [
      {
        product: 'chat',
        en: 'New "AI" bot source: it answers every visitor message from your public Docs pages and canned responses until a teammate replies. When unsure, or when the visitor asks for a person, it hands off and flags the conversation high priority.',
        es: 'Nueva fuente "IA" para el bot: responde cada mensaje del visitante con tus páginas públicas de Docs y las respuestas guardadas hasta que conteste alguien del equipo. Si no está seguro, o el visitante pide una persona, deriva y marca la conversación con prioridad alta.',
        pt: 'Nova fonte "IA" para o bot: responde cada mensagem do visitante com suas páginas públicas de Docs e as respostas salvas até alguém da equipe responder. Se não tiver certeza, ou o visitante pedir uma pessoa, transfere e marca a conversa com prioridade alta.',
      },
      {
        product: 'platform',
        en: 'AI usage is metered per workspace with a free monthly quota, shown in Settings. Self-hosters bring their own AI Gateway key.',
        es: 'El uso de IA se mide por workspace con una cuota mensual gratis, visible en Configuración. En self-host usás tu propia key de AI Gateway.',
        pt: 'O uso de IA é medido por workspace com uma cota mensal grátis, visível em Configurações. No self-host você usa sua própria chave do AI Gateway.',
      },
    ],
  },
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
        product: 'site',
        en: 'The zero made of zeros on the home page now reacts to the cursor everywhere, even over the headline, and also shows on phones.',
        es: 'El cero hecho de ceros del home ahora reacciona al cursor en todos lados, incluso sobre el título, y también se ve en el celular.',
        pt: 'O zero feito de zeros da home agora reage ao cursor em todo lugar, até sobre o título, e também aparece no celular.',
      },
      {
        product: 'site',
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
        product: 'site',
        en: 'Redesigned website: suite overview, what your current stack costs, self-hosting in one command, and a developer section with real API examples. The code is now public on GitHub.',
        es: 'Sitio rediseñado: la suite de un vistazo, cuánto cuesta tu stack actual, self-hosting en un comando y una sección para developers con ejemplos reales de la API. El código ahora es público en GitHub.',
        pt: 'Site redesenhado: a suíte num relance, quanto custa seu stack atual, self-hosting em um comando e uma seção para devs com exemplos reais da API. O código agora é público no GitHub.',
      },
      {
        product: 'site',
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
        en: 'Each product now has its own color (Link blue, CRM violet, Cal green, Track orange, Chat pink, Docs amber), used for navigation, main buttons and charts.',
        es: 'Cada producto tiene su color (Link azul, CRM violeta, Cal verde, Track naranja, Chat rosa, Docs ámbar) en la navegación, los botones principales y los gráficos.',
        pt: 'Cada produto agora tem sua cor (Link azul, CRM violeta, Cal verde, Track laranja, Chat rosa, Docs âmbar) na navegação, nos botões principais e nos gráficos.',
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
        en: 'Import from Bitly via API token or CSV: up to 2,000 links per run, keeping back-halves when they are available.',
        es: 'Importar desde Bitly con token de la API o CSV: hasta 2.000 links por vez, conservando los back-halves si están libres.',
        pt: 'Importar do Bitly via token da API ou CSV: até 2.000 links por vez, mantendo os back-halves quando estão livres.',
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
        product: 'site',
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
        en: 'Teams: shared workspaces with invite links. Create, invite, accept, switch and leave.',
        es: 'Teams: workspaces compartidos con links de invitación. Crear, invitar, aceptar, cambiar y salir.',
        pt: 'Times: workspaces compartilhados com links de convite. Criar, convidar, aceitar, trocar e sair.',
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
      en: 'First release: Link and CRM',
      es: 'Primera versión: Link y CRM',
      pt: 'Primeira versão: Link e CRM',
    },
    items: [
      {
        product: 'site',
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
