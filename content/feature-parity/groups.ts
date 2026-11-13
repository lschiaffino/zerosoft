import type { Localized, ParityRow, ParityStatus, ProductParity } from './types';

type L = [en: string, es: string, pt: string];
const loc = ([en, es, pt]: L): Localized => ({ en, es, pt });

function row(
  id: string,
  area: string,
  label: L,
  status: ParityStatus,
  opts: { detail?: L; competitorHas?: boolean; weight?: 1 | 2 } = {},
): ParityRow {
  return {
    id,
    area,
    label: loc(label),
    ...(opts.detail ? { detail: loc(opts.detail) } : {}),
    status,
    competitorHas: opts.competitorHas ?? true,
    ...(opts.weight ? { weight: opts.weight } : {}),
  };
}

/** Groups contra Periskope. Fuente: docs/benchmark/groups.md, revisado contra el código de esta rama. */
const parity: ProductParity = {
  competitor: 'Periskope',
  lastReviewed: '2026-11-12',
  areas: [
    { id: 'numbers', label: loc(['Numbers and connection', 'Números y conexión', 'Números e conexão']) },
    { id: 'inbox', label: loc(['Shared inbox', 'Bandeja compartida', 'Caixa compartilhada']) },
    { id: 'groups', label: loc(['Group management', 'Gestión de grupos', 'Gestão de grupos']) },
    { id: 'organize', label: loc(['Labels, properties and contacts', 'Etiquetas, propiedades y contactos', 'Etiquetas, propriedades e contatos']) },
    { id: 'tickets', label: loc(['Tickets and SLA', 'Tickets y SLA', 'Tickets e SLA']) },
    { id: 'broadcasts', label: loc(['Broadcasts and scheduling', 'Envíos masivos y programados', 'Envios em massa e agendados']) },
    { id: 'automation', label: loc(['Automation and AI', 'Automatización y AI', 'Automação e IA']) },
    { id: 'integrations', label: loc(['Integrations and API', 'Integraciones y API', 'Integrações e API']) },
    { id: 'admin', label: loc(['Permissions and privacy', 'Permisos y privacidad', 'Permissões e privacidade']) },
    { id: 'reports', label: loc(['Reports and export', 'Reportes y export', 'Relatórios e exportação']) },
    { id: 'apps', label: loc(['Mobile and desktop', 'Mobile y escritorio', 'Mobile e desktop']) },
  ],
  rows: [
    // Números
    row('line-selector', 'inbox', ['Pick a line or see all lines together', 'Elegir una línea o ver todas juntas', 'Escolher uma linha ou ver todas juntas'], 'have', {
      detail: [
        'A selector in the inbox switches between one line and all lines (a badge shows the line of each chat). The choice is remembered per person',
        'Un selector en la bandeja cambia entre una línea y todas (una etiqueta muestra la línea de cada chat). La elección se recuerda por persona',
        'Um seletor na caixa alterna entre uma linha e todas (uma etiqueta mostra a linha de cada conversa). A escolha é lembrada por pessoa',
      ],
    }),
    row('shared-folders', 'organize', ['Shared chat folders', 'Carpetas compartidas de chats', 'Pastas compartilhadas de conversas'], 'have', {
      detail: [
        'Folders and subfolders shared by the workspace, with unread counts per person, hold a chat (or a selection) and drop it on a folder, with undo, or use Move to folder',
        'Carpetas y subcarpetas compartidas por el workspace, con no leídos por persona; mantené apretado un chat (o una selección) y soltalo en una carpeta, con deshacer, o usá Mover a carpeta',
        'Pastas e subpastas compartilhadas pelo workspace, com não lidas por pessoa; segure uma conversa (ou uma seleção) e solte numa pasta, com desfazer, ou use Mover para pasta',
      ],
    }),
    row('qr-connect', 'numbers', ['Connect a number with a QR code', 'Conectar un número con QR', 'Conectar um número com QR'], 'partial', {
      weight: 2,
      detail: [
        'Scan from the phone on our Evolution API server, or with your own WAHA or Evolution API gateway: the QR refreshes by itself, the status follows the phone and groups come in on connect. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Escanear desde el teléfono en nuestro servidor de Evolution API, o con tu propio gateway WAHA o Evolution API: el QR se actualiza solo, el estado sigue al teléfono y los grupos llegan al conectar. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Escanear pelo celular no nosso servidor de Evolution API, ou com seu próprio gateway WAHA ou Evolution API: o QR se atualiza sozinho, o status acompanha o telefone e os grupos chegam ao conectar. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('multi-number', 'numbers', ['Several numbers in one inbox', 'Varios números en una bandeja', 'Vários números em uma caixa'], 'have', {
      weight: 2,
      detail: ['Up to 50 numbers per workspace, filter by number', 'Hasta 50 números por workspace, filtro por número', 'Até 50 números por workspace, filtro por número'],
    }),
    row('official-api', 'numbers', ['Official WhatsApp Cloud API numbers', 'Números de la API oficial (Cloud API)', 'Números da API oficial (Cloud API)'], 'partial', {
      competitorHas: false,
      detail: [
        'Webhook with signature check, media and templates; Periskope does not accept official API numbers. Tested against a simulated API; not yet tried with real WhatsApp',
        'Webhook con firma verificada, media y plantillas; Periskope no acepta números de la API oficial. Probado contra una API simulada; falta probarlo con WhatsApp real',
        'Webhook com assinatura verificada, mídia e templates; o Periskope não aceita números da API oficial. Testado contra uma API simulada; falta testar com WhatsApp real',
      ],
    }),
    row('number-ops', 'numbers', ['Reconnect, resync groups and remove a number', 'Reconectar, resincronizar grupos y borrar un número', 'Reconectar, ressincronizar grupos e remover um número'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('history-import', 'numbers', ['Import chats and their full history when a number connects', 'Importar chats y todo su historial al conectar un número', 'Importar conversas e todo o histórico ao conectar um número'], 'partial', {
      detail: [
        'Chats, groups, contacts, names, photos, unread counts and every message the WhatsApp server kept (the latest of each chat first, the rest in the background), in resumable batches and without triggering rules or notifications. Names, contact info, group subjects, descriptions, members and photos are refreshed once a day. QR and Evolution only; how far back it goes depends on what the phone sends when linking. Tested against a simulated Evolution with 200 chats; payload shapes checked against a real instance.',
        'Chats, grupos, contactos, nombres, fotos, no leídos y todos los mensajes que guardó el servidor de WhatsApp (primero los últimos de cada chat, el resto en segundo plano), en tandas que se retoman y sin disparar reglas ni avisos. Nombres, info de los contactos, asuntos, descripciones, miembros y fotos de los grupos se repasan una vez por día. Solo por QR y Evolution; hasta dónde llega depende de lo que el teléfono manda al vincular. Probado contra un Evolution simulado con 200 chats; los formatos se verificaron contra una instancia real.',
        'Conversas, grupos, contatos, nomes, fotos, não lidas e todas as mensagens que o servidor do WhatsApp guardou (primeiro as últimas de cada conversa, o resto em segundo plano), em lotes retomáveis e sem disparar regras nem avisos. Nomes, recado dos contatos, assuntos, descrições, membros e fotos dos grupos são atualizados uma vez por dia. Só por QR e Evolution; até onde chega depende do que o celular envia ao vincular. Testado contra um Evolution simulado com 200 conversas; os formatos foram conferidos com uma instância real.',
      ],
      weight: 2,
    }),
    row('self-host', 'numbers', ['Self-hosted, your data on your server', 'Self-host, los datos en tu servidor', 'Self-host, os dados no seu servidor'], 'better', { competitorHas: false }),

    // Bandeja
    row('chats-and-groups', 'inbox', ['1:1 chats and groups in one list', 'Chats 1:1 y grupos en una lista', 'Chats 1:1 e grupos em uma lista'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('reply-from-app', 'inbox', ['Reply without the phone, media and replies', 'Responder sin el teléfono, con media y respuestas citadas', 'Responder sem o telefone, com mídia e respostas citadas'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('reactions', 'inbox', ['Reactions', 'Reacciones', 'Reações'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('edit-delete-forward', 'inbox', ['Edit, delete, forward and pin messages', 'Editar, borrar, reenviar y fijar mensajes', 'Editar, apagar, encaminhar e fixar mensagens'], 'partial', {
      detail: [
        'Edit (15 min) and delete for everyone on WAHA and Evolution numbers, also when it happens on the phone. Pins go to WhatsApp on WAHA and stay in Lines elsewhere. Forward is native on WAHA and a copy elsewhere, for any message: a voice note goes as a voice note with its length, and what arrived through Evolution is copied too. On Evolution the copy reaches the other phone without the Forwarded label. The Cloud API cannot edit or delete. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Editar (15 min) y borrar para todos en números WAHA y Evolution, también cuando pasa desde el teléfono. Fijar llega a WhatsApp en WAHA y queda en Lines en el resto. Reenviar es nativo en WAHA y una copia en el resto, para cualquier mensaje: una nota de voz sale como nota de voz con su duración, y lo que llegó por Evolution también se copia. En Evolution la copia llega al otro teléfono sin la marca de reenviado. La Cloud API no deja editar ni borrar. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Editar (15 min) e apagar para todos em números WAHA e Evolution, também quando acontece no telefone. Fixar chega ao WhatsApp no WAHA e fica no Lines nos outros. Encaminhar é nativo no WAHA e uma cópia nos outros, para qualquer mensagem: uma nota de voz sai como nota de voz com sua duração, e o que chegou pelo Evolution também é copiado. No Evolution a cópia chega ao outro telefone sem a marca de encaminhada. A Cloud API não deixa editar nem apagar. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('assignment', 'inbox', ['Assign chats', 'Asignar chats', 'Atribuir chats'], 'have', {
      weight: 2,
      detail: [
        'To a person and a team, Mine, Unassigned and team filters, history in the thread and a notification to the assignee',
        'A una persona y a un equipo, filtros Míos, Sin asignar y por equipo, historial en el hilo y aviso a quien lo recibe',
        'A uma pessoa e a uma equipe, filtros Minhas, Sem atribuição e por equipe, histórico no fio e aviso para quem recebe',
      ],
    }),
    row('private-notes', 'inbox', ['Internal notes', 'Notas internas', 'Notas internas'], 'have', {
      detail: [
        '@mentions with autocomplete and a notification, edit and delete, marked as internal in the thread',
        '@menciones con autocompletado y aviso, editar y borrar, marcadas como internas en el hilo',
        '@menções com autocompletar e aviso, editar e apagar, marcadas como internas no fio',
      ],
    }),
    row('whatsapp-look', 'inbox', ['Looks and works like WhatsApp Web (bubbles, ticks, media, voice notes, drag and drop)', 'Se ve y se usa como WhatsApp Web (burbujas, tildes, media, notas de voz, arrastrar y soltar)', 'Parece e funciona como o WhatsApp Web (balões, tiques, mídia, mensagens de voz, arrastar e soltar)'], 'partial', {
      detail: [
        'Photos and videos sent together show as one album. Link previews like WhatsApp (large image, compact, while typing) and a personal Display setting (text size, list density, media size, previews). No message search inside a chat yet',
        'Las fotos y videos mandados juntos se ven en un álbum. Vista previa de links como WhatsApp (imagen grande, compacta, al escribir) y una Visualización por persona (tamaño del texto, densidad de la lista, tamaño de la media, vistas previas). Todavía sin búsqueda dentro de un chat',
        'Fotos e vídeos enviados juntos aparecem num álbum. Prévia de links como no WhatsApp (imagem grande, compacta, ao digitar) e uma Visualização por pessoa (tamanho do texto, densidade da lista, tamanho da mídia, prévias). Ainda sem busca dentro de uma conversa',
      ],
    }),
    row('wa-stickers', 'inbox', ['Stickers and GIFs: see, send, favorites', 'Stickers y GIF: verlos, mandarlos, favoritos', 'Figurinhas e GIFs: ver, enviar, favoritas'], 'partial', {
      detail: [
        'Received stickers show small and without a bubble (animated ones move), GIFs play inside the bubble. The Stickers tab of the emoji panel has recent ones, favorites and your collection; WhatsApp does not let linked devices read the stickers saved on the phone, so the collection is built from the stickers in your chats (one click to import, then it stays up to date) and from images you turn into stickers. Lottie stickers show as a placeholder. Tested with the fake provider',
        'Los stickers que llegan se ven chicos y sin burbuja (los animados se mueven) y los GIF se reproducen en la burbuja. La pestaña Stickers del panel de emojis tiene recientes, favoritos y tu colección; WhatsApp no deja que los dispositivos vinculados lean los stickers guardados en el teléfono, así que la colección se arma con los stickers de tus chats (un clic para importarlos y después se mantiene sola) y con imágenes que convertís en sticker. Los stickers Lottie se ven como un lugar vacío. Probado con el proveedor falso',
        'As figurinhas recebidas aparecem pequenas e sem balão (as animadas se mexem) e os GIFs tocam no balão. A aba Figurinhas do painel de emojis tem recentes, favoritas e a sua coleção; o WhatsApp não deixa aparelhos vinculados lerem as figurinhas salvas no celular, então a coleção é montada com as figurinhas das suas conversas (um clique para importar e depois se atualiza sozinha) e com imagens que você transforma em figurinha. Figurinhas Lottie aparecem como um espaço vazio. Testado com o provedor falso',
      ],
    }),
    row('archive', 'inbox', ['Archive chats and an Archived section, delete a chat from the list', 'Archivar chats con la sección Archivados y eliminar un chat de la lista', 'Arquivar conversas com a seção Arquivadas e apagar uma conversa da lista'], 'have'),
    row('presence', 'inbox', ['Typing, recording and online indicators', 'Indicadores de escribiendo, grabando y en línea', 'Indicadores de digitando, gravando e online'], 'have', {
      detail: ['QR lines (Evolution); 1:1 chats that WhatsApp identifies only by a hidden id do not show it', 'Líneas por QR (Evolution); los 1 a 1 que WhatsApp identifica solo con un id oculto no lo muestran', 'Linhas por QR (Evolution); conversas 1 a 1 que o WhatsApp identifica só por um id oculto não mostram'],
    }),
    row('read-receipts', 'inbox', ['Mark chats as read on WhatsApp when the team reads them (optional)', 'Marcar leído en WhatsApp cuando el equipo lee (opcional)', 'Marcar como lida no WhatsApp quando a equipe lê (opcional)'], 'have'),
    row('send-contact', 'inbox', ['Send contact cards', 'Mandar tarjetas de contacto', 'Enviar cartões de contato'], 'have'),
    row('line-health', 'numbers', ['Warning when a line disconnects, with QR re-scan', 'Aviso cuando una línea se desconecta, con QR de nuevo', 'Aviso quando uma linha desconecta, com QR de novo'], 'have'),
    row('quick-replies', 'inbox', ['Quick replies with /shortcut', 'Respuestas rápidas con /atajo', 'Respostas rápidas com /atalho'], 'have', {
      detail: [
        'In the / menu of the message field, next to the commands of the chat (assign, close, label, note, ticket, send later and more)',
        'En el menú / del campo de mensaje, junto a los comandos del chat (asignar, cerrar, etiqueta, nota, ticket, enviar más tarde y más)',
        'No menu / do campo de mensagem, junto aos comandos da conversa (atribuir, fechar, etiqueta, nota, ticket, enviar mais tarde e mais)',
      ],
    }),
    row('filters', 'inbox', ['Filters: unread, unanswered, mine, label', 'Filtros: sin leer, sin responder, míos, etiqueta', 'Filtros: não lidas, sem resposta, minhas, etiqueta'], 'have'),
    row('message-search', 'inbox', ['Search chats and message text', 'Buscar chats y texto de mensajes', 'Buscar chats e texto das mensagens'], 'have'),
    row('close-reopen', 'inbox', ['Close, reopen and mark as read', 'Cerrar, reabrir y marcar leído', 'Fechar, reabrir e marcar como lida'], 'have', {
      detail: [
        'Close, reopen, read or unread and pin chats to the top, one by one or in bulk, with E, U, P and X',
        'Cerrar, reabrir, leído o no leído y fijar chats arriba, de a uno o en masa, con E, U, P y X',
        'Fechar, reabrir, lida ou não lida e fixar chats no topo, um por um ou em massa, com E, U, P e X',
      ],
    }),
    row('keyboard-inbox', 'inbox', ['Keyboard-first inbox', 'Bandeja manejable con teclado', 'Caixa operável pelo teclado'], 'better', {
      competitorHas: false,
      detail: ['J/K, R, N, E, A, T and Cmd+K across the suite', 'J/K, R, N, E, A, T y Cmd+K en toda la suite', 'J/K, R, N, E, A, T e Cmd+K em toda a suíte'],
    }),
    row('calls', 'inbox', ['Voice calls with recording', 'Llamadas de voz con grabación', 'Chamadas de voz com gravação'], 'partial', {
      detail: [
        'Call log in the chat: incoming, outgoing, missed and declined, with duration on the Cloud API (Calling API). Calling from Lines and recordings are not available: the providers do not expose the call audio',
        'Registro de llamadas en el chat: entrantes, salientes, perdidas y rechazadas, con duración en la Cloud API (Calling API). Llamar desde Lines y grabar no están: los proveedores no dan el audio de la llamada',
        'Registro de chamadas no chat: recebidas, feitas, perdidas e recusadas, com duração na Cloud API (Calling API). Ligar pelo Lines e gravar não estão disponíveis: os provedores não entregam o áudio da chamada',
      ],
    }),
    row('translation', 'inbox', ['Message translation', 'Traducción de mensajes', 'Tradução de mensagens'], 'have', {
      detail: [
        "Incoming messages in your language with L, cached per message, with the original one click away",
        'Los mensajes entrantes en tu idioma con L, cacheados por mensaje y con el original a un clic',
        'As mensagens recebidas no seu idioma com L, em cache por mensagem e com o original a um clique',
      ],
    }),

    // Grupos
    row('create-group', 'groups', ['Create a group', 'Crear un grupo', 'Criar um grupo'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('bulk-create', 'groups', ['Create many groups from a CSV', 'Crear muchos grupos desde un CSV', 'Criar muitos grupos a partir de um CSV'], 'partial', {
      competitorHas: false,
      detail: ['Up to 50 per run with result per row. Tested against a simulated gateway; not yet tried with real WhatsApp', 'Hasta 50 por vez con resultado por fila. Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Até 50 por vez com resultado por linha. Testado contra um gateway simulado; falta testar com WhatsApp real'],
    }),
    row('bulk-members', 'groups', ['Add and remove members in many groups', 'Agregar y quitar miembros en muchos grupos', 'Adicionar e remover membros em muitos grupos'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('admins', 'groups', ['Promote and demote admins in bulk', 'Promover y degradar admins en masa', 'Promover e rebaixar admins em massa'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('invite-links', 'groups', ['Invite link and reset', 'Link de invitación y regenerarlo', 'Link de convite e redefinir'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('group-settings', 'groups', ['Group settings (name, description, who can write or edit)', 'Ajustes del grupo (nombre, descripción, quién escribe o edita)', 'Configurações do grupo (nome, descrição, quem escreve ou edita)'], 'partial', {
      detail: [
        'Name, description, photo, admin-only messages and edits, invite link; disappearing messages with Evolution API. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Nombre, descripción, foto, solo admins escriben y editan, link de invitación; mensajes temporales con Evolution API. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Nome, descrição, foto, só admins escrevem e editam, link de convite; mensagens temporárias com Evolution API. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('group-templates', 'groups', ['Group templates with preset members', 'Plantillas de grupo con miembros fijos', 'Modelos de grupo com membros predefinidos'], 'partial', {
      detail: [
        'Fixed members and admins, name with variables, labels, settings and a welcome message; one group or many from a CSV. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Miembros y admins fijos, nombre con variables, etiquetas, ajustes y mensaje de bienvenida; un grupo o varios desde un CSV. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Membros e admins fixos, nome com variáveis, etiquetas, configurações e mensagem de boas-vindas; um grupo ou vários de um CSV. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('sync-groups', 'groups', ['Refresh groups and members from WhatsApp', 'Refrescar grupos y miembros desde WhatsApp', 'Atualizar grupos e membros pelo WhatsApp'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('leave-join', 'groups', ['Join by invite and leave a group', 'Entrar por invitación y salir de un grupo', 'Entrar por convite e sair de um grupo'], 'partial', {
      detail: [
        'Join with the invite link and the group arrives with its members; leaving keeps the history. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Entrar con el link de invitación trae el grupo con sus miembros; salir conserva el historial. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Entrar com o link de convite traz o grupo com os membros; sair mantém o histórico. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),

    // Organización
    row('labels', 'organize', ['Colored labels on chats', 'Etiquetas con color en chats', 'Etiquetas coloridas nos chats'], 'have'),
    row('custom-properties', 'organize', ['Custom properties on chats and groups', 'Propiedades propias en chats y grupos', 'Propriedades próprias em chats e grupos'], 'have', {
      detail: [
        'Text, number, option, multi-select, date, checkbox, link, file and dependent dropdowns up to 3 levels; filters, list columns and CSV',
        'Texto, número, opción, multiselección, fecha, casilla, link, archivo y desplegables dependientes de hasta 3 niveles; filtros, columnas y CSV',
        'Texto, número, opção, seleção múltipla, data, caixa, link, arquivo e listas dependentes de até 3 níveis; filtros, colunas e CSV',
      ],
    }),
    row('contacts-crm', 'organize', ['Contacts', 'Contactos', 'Contatos'], 'better', {
      detail: ['Chats and groups link to CRM contacts and companies, with messages and tickets on the record', 'Chats y grupos se vinculan a contactos y empresas del CRM, con mensajes y tickets en la ficha', 'Chats e grupos se vinculam a contatos e empresas do CRM, com mensagens e tickets na ficha'],
    }),
    row('saved-lists', 'organize', ['Saved chat lists', 'Listas guardadas de chats', 'Listas salvas de chats'], 'have', {
      detail: [
        'Filters by tab, label, type, assignee and property; shared or personal, in the sidebar and ⌘K, and as a broadcast audience',
        'Filtros por pestaña, etiqueta, tipo, asignado y propiedad; compartidas o personales, en el sidebar y ⌘K, y como audiencia de envíos',
        'Filtros por aba, etiqueta, tipo, responsável e propriedade; compartilhadas ou pessoais, na barra lateral e no ⌘K, e como público de envios',
      ],
    }),

    // Tickets
    row('ticket-from-message', 'tickets', ['Ticket from a message', 'Ticket desde un mensaje', 'Ticket a partir de uma mensagem'], 'have', { weight: 2 }),
    row('emoji-ticket', 'tickets', ['Ticket by emoji reaction', 'Ticket por reacción con emoji', 'Ticket por reação com emoji'], 'have', {
      weight: 2,
      detail: ['From Lines or from the phone, one ticket per message', 'Desde Lines o desde el teléfono, un ticket por mensaje', 'Pelo Lines ou pelo telefone, um ticket por mensagem'],
    }),
    row('keyword-ticket', 'tickets', ['Ticket by keyword', 'Ticket por palabra clave', 'Ticket por palavra-chave'], 'have'),
    row('ticket-fields', 'tickets', ['Status, priority, assignee and due time', 'Estado, prioridad, asignado y vencimiento', 'Status, prioridade, responsável e vencimento'], 'have'),
    row('sla', 'tickets', ['First response and resolution SLA', 'SLA de primera respuesta y resolución', 'SLA de primeira resposta e resolução'], 'have'),
    row('unanswered-flag', 'tickets', ['Flag unanswered messages', 'Marcar mensajes sin responder', 'Marcar mensagens sem resposta'], 'have', {
      weight: 2,
      detail: [
        'By time or with AI that tells questions from comments, with your own rules; a reply, a ticket or a click clears it',
        'Por tiempo o con AI que separa preguntas de comentarios, con reglas propias; lo desmarca una respuesta, un ticket o un clic',
        'Por tempo ou com IA que separa perguntas de comentários, com regras próprias; desmarca com uma resposta, um ticket ou um clique',
      ],
    }),
    row('phone-replies-count', 'tickets', ['Replies from the phone count as answered', 'Lo respondido desde el teléfono cuenta como respuesta', 'O respondido pelo telefone conta como resposta'], 'better', { competitorHas: false }),
    row('sla-email', 'tickets', ['Email when an SLA is breached', 'Email cuando vence un SLA', 'Email quando um SLA vence'], 'have', {
      detail: [
        'To the assignee, the admins or other addresses, once per breach, plus webhooks and Flow',
        'A la persona asignada, los admins u otras direcciones, una vez por vencimiento, además de webhooks y Flow',
        'Para o responsável, os admins ou outros endereços, uma vez por vencimento, além de webhooks e Flow',
      ],
    }),
    row('ticket-custom-fields', 'tickets', ['Custom fields on tickets', 'Campos propios en tickets', 'Campos próprios em tickets'], 'have', {
      detail: [
        'Same field types as chats, required to close, filters and CSV export',
        'Los mismos tipos que en los chats, obligatorios al cerrar, filtros y export CSV',
        'Os mesmos tipos dos chats, obrigatórios para fechar, filtros e exportação CSV',
      ],
    }),
    row('tasks-reminders', 'tickets', ['Tasks and reminders from a chat', 'Tareas y recordatorios desde el chat', 'Tarefas e lembretes pelo chat'], 'have', {
      detail: [
        'From any message, with an in-app and email reminder on time; they are CRM tasks too, with a link back to the chat, and the chat shows the CRM tasks of its contact or company',
        'Desde cualquier mensaje, con aviso en la app y por email a la hora; también son tareas del CRM, con link de vuelta al chat, y el chat muestra las tareas del CRM de su contacto o empresa',
        'De qualquer mensagem, com aviso no app e por email no horário; também são tarefas do CRM, com link de volta ao chat, e o chat mostra as tarefas do CRM do seu contato ou empresa',
      ],
    }),

    // Envíos
    row('broadcast', 'broadcasts', ['Broadcast to many groups and chats', 'Envío a muchos grupos y chats', 'Envio para muitos grupos e chats'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('variables', 'broadcasts', ['Variables in the message', 'Variables en el mensaje', 'Variáveis na mensagem'], 'have'),
    row('throttle', 'broadcasts', ['Pace between messages', 'Ritmo entre mensajes', 'Ritmo entre mensagens'], 'have', {
      detail: ['Per broadcast and a cap per number', 'Por envío y un tope por número', 'Por envio e um teto por número'],
    }),
    row('scheduled', 'broadcasts', ['Scheduled messages', 'Mensajes programados', 'Mensagens agendadas'], 'have', {
      detail: [
        'Send later from the message box with presets or a date; the pending message stays in the chat, where you can send it now, change the time, edit or cancel it; one view lists them across chats',
        'Enviar más tarde desde el cuadro con opciones rápidas o una fecha; el pendiente queda en el chat, donde se envía ahora, se le cambia la hora, se edita o se cancela; una vista los lista de todos los chats',
        'Enviar mais tarde pela caixa com opções rápidas ou uma data; a pendente fica na conversa, onde dá para enviar agora, mudar o horário, editar ou cancelar; uma tela lista as de todas as conversas',
      ],
    }),
    row('recurring', 'broadcasts', ['Recurring messages', 'Mensajes recurrentes', 'Mensagens recorrentes'], 'have', {
      detail: [
        'Daily, weekly by day, monthly or cron, with time zone and end date, to chats and groups; pause, edit and next runs visible; each run goes out with the broadcast pace',
        'Diario, semanal por días, mensual o cron, con zona horaria y fecha de fin, a chats y grupos; pausar, editar y próximas corridas a la vista; cada corrida sale con el ritmo de los envíos',
        'Diário, semanal por dias, mensal ou cron, com fuso e data de fim, para chats e grupos; pausar, editar e próximas execuções visíveis; cada execução sai no ritmo dos envios',
      ],
    }),
    row('delivery-log', 'broadcasts', ['Live status per recipient', 'Estado en vivo por destinatario', 'Status ao vivo por destinatário'], 'have'),
    row('polls', 'broadcasts', ['Polls in broadcasts', 'Encuestas en envíos', 'Enquetes nos envios'], 'partial', {
      detail: [
        'In chats, broadcasts and recurring messages, with live results from WAHA votes; Evolution counts votes when the gateway sends them decrypted; the Meta Cloud API has no polls. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'En chats, envíos y recurrentes, con resultados en vivo de los votos de WAHA; Evolution los cuenta cuando el gateway los manda descifrados; la Cloud API de Meta no tiene encuestas. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Em chats, envios e recorrentes, com resultados ao vivo dos votos do WAHA; o Evolution conta quando o gateway manda os votos decifrados; a Cloud API da Meta não tem enquetes. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('no-send-credits', 'broadcasts', ['No per-seat send credits', 'Sin créditos de envío por licencia', 'Sem créditos de envio por licença'], 'better', { competitorHas: false }),

    // Automatización y AI
    row('rules-engine', 'automation', ['Automation rules on WhatsApp events', 'Reglas sobre eventos de WhatsApp', 'Regras sobre eventos de WhatsApp'], 'have', {
      detail: ['Flow triggers for message received and ticket created or updated, with no rule cap', 'Disparadores de Flow para mensaje recibido y ticket creado o actualizado, sin tope de reglas', 'Gatilhos do Flow para mensagem recebida e ticket criado ou atualizado, sem limite de regras'],
    }),
    row('send-action', 'automation', ['Send a WhatsApp message from an automation', 'Mandar un WhatsApp desde una automatización', 'Enviar um WhatsApp por uma automação'], 'have'),
    row('auto-assign', 'automation', ['Round-robin auto assignment', 'Asignación automática round-robin', 'Atribuição automática round-robin'], 'have', {
      detail: [
        'Rules by number, label or chat type that rotate among a team or some people, only those marked available',
        'Reglas por número, etiqueta o tipo de chat que rotan entre un equipo o algunas personas, solo entre quienes están disponibles',
        'Regras por número, etiqueta ou tipo de chat que revezam entre uma equipe ou algumas pessoas, só entre quem está disponível',
      ],
    }),
    row('ai-summary', 'automation', ['AI summary of a chat', 'Resumen AI de un chat', 'Resumo IA de um chat'], 'have'),
    row('ai-agent', 'automation', ['AI agent that answers in chats and groups', 'Agente AI que responde en chats y grupos', 'Agente IA que responde em chats e grupos'], 'have', {
      detail: ['Any agent from Agents, with its knowledge, tools and handoff', 'Cualquier agente de Agents, con su conocimiento, herramientas y derivación', 'Qualquer agente do Agents, com seu conhecimento, ferramentas e transferência'],
    }),
    row('ai-drafts', 'automation', ['AI drafts and translation of replies', 'Borradores y traducción AI de respuestas', 'Rascunhos e tradução IA de respostas'], 'have', {
      detail: [
        "Help me write: describe the message and it is drafted from the chat, quick replies and the chat agent's knowledge or public Docs. Review it before it reaches the message field, refine it (shorter, longer, tone, grammar, your own change), translate it to the customer's language, insert it and undo. Tested with the fake model",
        'Ayudame a escribir: describís el mensaje y se redacta con el chat, las respuestas rápidas y el conocimiento del agente del chat o las páginas públicas de Docs. Lo revisás antes de que llegue al campo del mensaje, lo ajustás (más corto, más largo, tono, gramática, un cambio propio), lo traducís al idioma del cliente, lo insertás y podés deshacer. Probado con el modelo falso',
        'Ajude-me a escrever: você descreve a mensagem e ela é redigida com a conversa, as respostas rápidas e o conhecimento do agente da conversa ou as páginas públicas do Docs. Você revisa antes de chegar ao campo da mensagem, ajusta (mais curto, mais longo, tom, gramática, uma mudança sua), traduz para o idioma do cliente, insere e pode desfazer. Testado com o modelo falso',
      ],
    }),

    // Integraciones
    row('crm-native', 'integrations', ['CRM link with timeline', 'Vínculo con el CRM y timeline', 'Vínculo com o CRM e timeline'], 'better', {
      weight: 2,
      detail: ['Native: the CRM record shows the WhatsApp messages and open tickets', 'Nativo: la ficha del CRM muestra los mensajes de WhatsApp y los tickets abiertos', 'Nativo: a ficha do CRM mostra as mensagens de WhatsApp e os tickets abertos'],
    }),
    row('hubspot', 'integrations', ['HubSpot: chats linked to companies and deals', 'HubSpot: chats vinculados a empresas y negocios', 'HubSpot: conversas vinculadas a empresas e negócios'], 'partial', {
      weight: 2,
      detail: [
        'Connect with a private app token; link each chat or group to a HubSpot company, deal and contact, with a suggestion by phone number, a daily note on the linked records and an inbox filter. All the company properties (custom ones too) are imported and synced both ways, editable from a HubSpot screen on the chat, usable as inbox filters, and there is a view to link groups in bulk. Periskope also creates HubSpot tickets from a chat and sends WhatsApp from a HubSpot workflow; deal and contact properties are still a fixed handful here. Tested against a simulated HubSpot; not yet tried with a real account',
        'Se conecta con el token de una private app; cada chat o grupo se vincula a una empresa, un negocio y un contacto de HubSpot, con sugerencia por teléfono, una nota diaria en los registros vinculados y un filtro en la bandeja. Todas las propiedades de la empresa (también las propias) se importan y se sincronizan en los dos sentidos, se editan desde una pantalla de HubSpot en el chat, sirven como filtros de la bandeja, y hay una vista para vincular grupos de a muchos. Periskope además crea tickets de HubSpot desde un chat y manda WhatsApp desde un workflow de HubSpot; las propiedades de negocios y contactos acá siguen siendo unas pocas fijas. Probado contra un HubSpot simulado; falta probarlo con una cuenta real',
        'Conecta com o token de um private app; cada conversa ou grupo se vincula a uma empresa, um negócio e um contato do HubSpot, com sugestão por telefone, uma nota diária nos registros vinculados e um filtro na caixa. Todas as propriedades da empresa (também as personalizadas) são importadas e sincronizadas nos dois sentidos, editadas em uma tela do HubSpot na conversa, usadas como filtros da caixa, e há uma visão para vincular grupos em massa. O Periskope também cria tickets do HubSpot a partir de uma conversa e envia WhatsApp a partir de um workflow do HubSpot; as propriedades de negócios e contatos aqui continuam sendo poucas e fixas. Testado contra um HubSpot simulado; falta testar com uma conta real',
      ],
    }),
    row('webhooks', 'integrations', ['Outgoing webhooks', 'Webhooks salientes', 'Webhooks de saída'], 'have', {
      detail: [
        '13 events (messages in and out, chat created, assigned and closed, members in and out, tickets, SLA, poll votes), HMAC signature, retries with backoff, delivery log and resend; Periskope also sends message edits, deletions and number status',
        '13 eventos (mensajes entrantes y salientes, chat creado, asignado y cerrado, miembros que entran y salen, tickets, SLA, votos), firma HMAC, reintentos con backoff, log de entregas y reenvío; Periskope además manda ediciones, borrados y estado del número',
        '13 eventos (mensagens recebidas e enviadas, chat criado, atribuído e fechado, membros que entram e saem, tickets, SLA, votos), assinatura HMAC, novas tentativas com backoff, log de entregas e reenvio; o Periskope também manda edições, exclusões e status do número',
      ],
    }),
    row('public-api', 'integrations', ['Public REST API', 'API REST pública', 'API REST pública'], 'have', {
      detail: [
        'Chats, messages (text, media, polls), groups, members and invite links, tickets, labels, numbers, broadcasts and recurring messages, with scoped API keys; no contacts or custom property endpoints yet',
        'Chats, mensajes (texto, media, encuestas), grupos, miembros y links de invitación, tickets, etiquetas, números, envíos y recurrentes, con API keys por scope; sin endpoints de contactos ni de propiedades por ahora',
        'Chats, mensagens (texto, mídia, enquetes), grupos, membros e links de convite, tickets, etiquetas, números, envios e recorrentes, com API keys por scope; sem endpoints de contatos nem de propriedades por enquanto',
      ],
    }),
    row('helpdesk-integrations', 'integrations', ['Freshdesk, Zoho, Slack and Zapier', 'Freshdesk, Zoho, Slack y Zapier', 'Freshdesk, Zoho, Slack e Zapier'], 'have', {
      detail: [
        'Slack channel alerts; Freshdesk and Zoho Desk tickets created from ours with status synced both ways (each workspace pastes its own keys, stored encrypted); Zapier through webhooks and the API, with no app in the Zapier directory',
        'Avisos en un canal de Slack; tickets de Freshdesk y Zoho Desk creados desde los nuestros con el estado sincronizado en los dos sentidos (cada workspace pega sus claves, guardadas cifradas); Zapier por webhooks y la API, sin app en el directorio de Zapier',
        'Avisos em um canal do Slack; tickets do Freshdesk e do Zoho Desk criados a partir dos nossos com status sincronizado nos dois sentidos (cada workspace cola suas chaves, guardadas criptografadas); Zapier por webhooks e a API, sem app no diretório do Zapier',
      ],
    }),
    row('mcp', 'integrations', ['MCP server', 'Servidor MCP', 'Servidor MCP'], 'have', {
      detail: [
        'Streamable HTTP with an API key: 9 tools to list chats, read and send messages and polls, assign, close and label chats, and handle tickets; Periskope lists 56 tools',
        'Streamable HTTP con API key: 9 herramientas para listar chats, leer y mandar mensajes y encuestas, asignar, cerrar y etiquetar chats y manejar tickets; Periskope lista 56',
        'Streamable HTTP com API key: 9 ferramentas para listar chats, ler e enviar mensagens e enquetes, atribuir, fechar e etiquetar chats e cuidar de tickets; o Periskope lista 56',
      ],
    }),

    // Permisos
    row('roles', 'admin', ['Admin and member roles', 'Roles admin y miembro', 'Papéis admin e membro'], 'have', {
      detail: ['Admins connect numbers and change rules; members work the inbox', 'Admins conectan números y cambian reglas; miembros atienden la bandeja', 'Admins conectam números e mudam regras; membros atendem a caixa'],
    }),
    row('member-connect-numbers', 'admin', ['Let a member connect numbers without being admin', 'Dejar que un miembro conecte números sin ser admin', 'Deixar um membro conectar números sem ser admin'], 'have', {
      detail: [
        'An admin turns on "Can connect numbers in Lines" for one member in Members and permissions. The member manages only the numbers they add, which start private. Covered by unit and e2e tests against the test provider; not yet tried by a real team',
        'Un admin le activa "Puede conectar números en Lines" a un miembro en Miembros y permisos. El miembro administra solo los números que agrega, que nacen privados. Cubierto con tests unitarios y e2e contra el proveedor de prueba; falta probarlo con un equipo real',
        'Um admin ativa "Pode conectar números no Lines" para um membro em Membros e permissões. O membro administra só os números que adiciona, que nascem privados. Coberto com testes unitários e e2e contra o provedor de teste; falta testar com uma equipe real',
      ],
    }),
    row('label-access', 'admin', ['Members see only chats with their labels', 'Miembros ven solo chats con sus etiquetas', 'Membros veem só chats com suas etiquetas'], 'have', {
      detail: [
        'Per label, who sees it; members also see the chats assigned to them; applies to inbox, search, Cmd+K, reports, export, API and MCP',
        'Por etiqueta, quién la ve; los miembros ven además los chats que tienen asignados; aplica en bandeja, búsqueda, Cmd+K, reportes, export, API y MCP',
        'Por etiqueta, quem a vê; os membros também veem os chats atribuídos a eles; vale na caixa, na busca, no Cmd+K, nos relatórios, no export, na API e no MCP',
      ],
    }),
    row('line-owner-visibility', 'admin', ['Line owner and who can see each line', 'Dueño de cada línea y quién la ve', 'Dono de cada linha e quem a vê'], 'have', {
      detail: [
        'Each line has an owner and can be limited to chosen people or teams; admins and the owner always see it. Chats, messages, search, Cmd+K, the API, MCP, CRM and notifications all follow it. Covered by unit tests; not yet tried by a real team',
        'Cada línea tiene un dueño y se puede limitar a personas o equipos elegidos; admins y dueño siempre la ven. Chats, mensajes, búsqueda, Cmd+K, API, MCP, CRM y avisos la respetan. Cubierto con tests unitarios; falta probarlo con un equipo real',
        'Cada linha tem um dono e pode ser limitada a pessoas ou equipes escolhidas; admins e dono sempre a veem. Conversas, mensagens, busca, Cmd+K, API, MCP, CRM e avisos a respeitam. Coberto com testes unitários; falta testar com uma equipe real',
      ],
    }),
    row('masking', 'admin', ['Phone number masking', 'Ocultar números de teléfono', 'Ocultar números de telefone'], 'have', {
      detail: [
        'Per role (members, admins); hidden in the app, CSV export, API, MCP and push notifications',
        'Por rol (miembros, admins); ocultos en la app, el export CSV, la API, el MCP y las notificaciones',
        'Por papel (membros, admins); ocultos no app, no export CSV, na API, no MCP e nas notificações',
      ],
    }),
    row('encrypted-credentials', 'admin', ['Provider credentials encrypted at rest', 'Credenciales del proveedor cifradas', 'Credenciais do provedor criptografadas'], 'have'),
    row('audit-log', 'admin', ['Audit log per chat', 'Log de auditoría por chat', 'Log de auditoria por chat'], 'have', {
      detail: [
        'Who assigned, closed, labeled, renamed, exported, removed or changed members and tickets, from the app, API or MCP; in each chat and for the whole workspace, filterable by action and person',
        'Quién asignó, cerró, etiquetó, renombró, exportó, sacó o cambió miembros y tickets, desde la app, la API o el MCP; en cada chat y para todo el workspace, filtrable por acción y persona',
        'Quem atribuiu, fechou, etiquetou, renomeou, exportou, removeu ou mudou membros e tickets, pelo app, pela API ou pelo MCP; em cada chat e para todo o workspace, filtrável por ação e pessoa',
      ],
    }),

    // Reportes
    row('response-metrics', 'reports', ['Messages, active chats and first response time', 'Mensajes, chats activos y tiempo de primera respuesta', 'Mensagens, chats ativos e tempo de primeira resposta'], 'have', {
      detail: [
        'Median and 9 out of 10, per day and by how fast the reply was; chats waiting now by how long; new chats; received by weekday and hour',
        'Mediana y 9 de cada 10, por día y según qué tan rápido se respondió; chats esperando ahora según hace cuánto; chats nuevos; recibidos por día de la semana y hora',
        'Mediana e 9 em cada 10, por dia e pela rapidez da resposta; chats esperando agora por tempo de espera; chats novos; recebidas por dia da semana e hora',
      ],
    }),
    row('report-dashboard', 'reports', ['Dashboard with tabs, charts and comparison with the previous period', 'Tablero con pestañas, gráficos y comparación con el período anterior', 'Painel com abas, gráficos e comparação com o período anterior'], 'have', {
      detail: [
        'Overview, Conversations, Response, Team, Groups, Broadcasts, Tickets and tasks, Labels; each number shows its change against the same number of days before',
        'Resumen, Conversaciones, Respuesta, Equipo, Grupos, Envíos, Tickets y tareas, Etiquetas; cada número muestra el cambio contra la misma cantidad de días anteriores',
        'Resumo, Conversas, Resposta, Equipe, Grupos, Envios, Tickets e tarefas, Etiquetas; cada número mostra a variação contra a mesma quantidade de dias anteriores',
      ],
    }),
    row('ticket-metrics', 'reports', ['Ticket and resolution metrics', 'Métricas de tickets y resolución', 'Métricas de tickets e resolução'], 'have'),
    row('per-agent', 'reports', ['By person, by line, by group and by label', 'Por persona, por línea, por grupo y por etiqueta', 'Por pessoa, por linha, por grupo e por etiqueta'], 'have'),
    row('broadcast-metrics', 'reports', ['Broadcast delivery: sent, delivered, read and replied', 'Entrega de los envíos: enviados, entregados, leídos y respondidos', 'Entrega dos envios: enviadas, entregues, lidas e respondidas'], 'have'),
    row('report-filters', 'reports', ['Filter reports by line, assigned person, label and date range', 'Filtrar reportes por línea, persona asignada, etiqueta y rango', 'Filtrar relatórios por linha, responsável, etiqueta e período'], 'have', {
      detail: [
        '7, 30 or 90 days or any date range up to a year, in your time zone',
        '7, 30 o 90 días o cualquier rango de fechas de hasta un año, en tu zona horaria',
        '7, 30 ou 90 dias ou qualquer período de até um ano, no seu fuso horário',
      ],
    }),
    row('csv-export', 'reports', ['CSV export of chats, messages, tickets and each report tab', 'Export CSV de chats, mensajes, tickets y cada pestaña de los reportes', 'Exportar CSV de chats, mensagens, tickets e cada aba dos relatórios'], 'have'),

    // Apps
    row('mobile-app', 'apps', ['Mobile app', 'App mobile', 'App mobile'], 'partial', {
      detail: [
        'Installable app (PWA, the same one as the CRM) on Android and iPhone with push notifications for assigned chats. It is not in the App Store or Google Play; Periskope has native apps',
        'App instalable (PWA, la misma del CRM) en Android y iPhone con notificaciones push de los chats asignados. No está en App Store ni Google Play; Periskope tiene apps nativas',
        'App instalável (PWA, o mesmo do CRM) no Android e no iPhone com notificações push dos chats atribuídos. Não está na App Store nem no Google Play; o Periskope tem apps nativos',
      ],
    }),
    row('desktop-app', 'apps', ['Desktop app', 'App de escritorio', 'App desktop'], 'partial', {
      detail: [
        'The installable app (PWA) in Chrome or Edge, with its own window and notifications. The zerosoft app for Mac and Windows shows up on /download with its first published release',
        'La app instalable (PWA) en Chrome o Edge, con ventana propia y avisos. La app de zerosoft para Mac y Windows aparece en /download con su primera versión publicada',
        'O app instalável (PWA) no Chrome ou Edge, com janela própria e avisos. O app do zerosoft para Mac e Windows aparece em /download com a primeira versão publicada',
      ],
    }),
  ],
};

export default parity;
