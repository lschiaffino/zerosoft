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
  lastReviewed: '2026-11-20',
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
    row('same-chat-lines', 'inbox', ['The same chat on several lines, listed once', 'El mismo chat en varias líneas, una sola vez', 'A mesma conversa em várias linhas, uma vez só'], 'have', {
      detail: [
        'A group or contact that talks to two or more of your lines is one row with the unread of all of them. Opening it shows the messages of every line in order, without the copies a group sends to each line, and each message says which line it came in on. Reading, archiving, snoozing or closing the row applies to every line. Only the lines a person can see count',
        'Un grupo o contacto que habla con dos o más de tus líneas es una sola fila con los no leídos de todas. Al abrirlo se ven los mensajes de todas las líneas en orden, sin las copias que un grupo manda a cada línea, y cada mensaje dice por qué línea entró. Leer, archivar, posponer o cerrar la fila vale para todas las líneas. Solo cuentan las líneas que la persona puede ver',
        'Um grupo ou contato que fala com duas ou mais das suas linhas é uma linha só na lista, com as não lidas de todas. Ao abrir, aparecem as mensagens de todas as linhas em ordem, sem as cópias que um grupo manda para cada linha, e cada mensagem diz por qual linha chegou. Ler, arquivar, adiar ou fechar vale para todas as linhas. Só contam as linhas que a pessoa pode ver',
      ],
    }),
    row('reply-from', 'inbox', ['Reply from another line', 'Responder desde otra línea', 'Responder de outra linha'], 'have', {
      detail: [
        'A chat that is on several lines shows Reply from in the composer, on the line of the last message by default. Everything you send goes out on the line you pick, and lines that are disconnected or left the group can not be picked. A 1:1 can only be answered from lines that already have that chat',
        'Un chat que está en varias líneas muestra Responder desde en el campo de escribir, por defecto en la línea del último mensaje. Todo lo que mandes sale por la línea elegida, y no se pueden elegir líneas desconectadas o que salieron del grupo. Un 1:1 solo se responde por líneas que ya tienen ese chat',
        'Uma conversa que está em várias linhas mostra Responder de no campo de escrever, por padrão na linha da última mensagem. Tudo o que você manda sai pela linha escolhida, e não dá para escolher linhas desconectadas ou que saíram do grupo. Uma conversa 1:1 só é respondida por linhas que já têm essa conversa',
      ],
    }),
    row('line-colors', 'inbox', ['Color per line', 'Color por línea', 'Cor por linha'], 'have', {
      detail: [
        'Each line can have a color, picked in Settings › Numbers from a short palette. The chat list shows a dot in that color on each chat, one per line when a chat is on several lines, and so do the line selector and Reply from',
        'Cada línea puede tener un color, elegido en Ajustes › Números de una paleta corta. La lista de chats muestra un punto de ese color en cada chat, uno por línea cuando el chat está en varias, y también el selector de línea y Responder desde',
        'Cada linha pode ter uma cor, escolhida em Configurações › Números numa paleta curta. A lista de conversas mostra um ponto dessa cor em cada conversa, um por linha quando a conversa está em várias, e também o seletor de linha e Responder de',
      ],
    }),
    row('numbers-table', 'inbox', ['Lines table with status, last message and open chats', 'Tabla de líneas con estado, último mensaje y chats abiertos', 'Tabela de linhas com status, última mensagem e conversas abertas'], 'have', {
      detail: [
        'Settings › Numbers lists every line with its status and since when, the time of its last message (no content) and how many chats it has open. On a phone the rows stack',
        'Ajustes › Números lista cada línea con su estado y desde cuándo, la hora de su último mensaje (sin contenido) y cuántos chats tiene abiertos. En el teléfono las filas se apilan',
        'Configurações › Números lista cada linha com o status e desde quando, a hora da última mensagem (sem conteúdo) e quantas conversas estão abertas. No celular as linhas se empilham',
      ],
    }),
    row('shared-folders', 'organize', ['Team and personal chat folders', 'Carpetas de chats del equipo y personales', 'Pastas de conversas da equipe e pessoais'], 'have', {
      detail: [
        'Two kinds of folders side by side, each with subfolders and unread counts. Team folders: admins create, rename and delete them, everyone in the workspace sees them, and anyone who can edit a chat can put it in one (one team folder per chat, the same for everyone). Personal folders: each person has their own, which nobody else sees. A chat can be in a team folder and in your own folder at once. Counts and lists only include chats on lines you can see. Hold a chat (or a selection) and drop it on any folder, with undo, or use Move to folder. "No folder" at the top of the tree lists the chats that are in none',
        'Dos tipos de carpetas, una al lado de la otra, cada una con subcarpetas y no leídos. Del equipo: las crean, renombran y borran los admins, las ve todo el workspace y cualquiera que puede editar un chat lo pone en una (una carpeta del equipo por chat, la misma para todos). Personales: cada persona tiene las suyas, que nadie más ve. Un chat puede estar en una del equipo y en una tuya a la vez. Los conteos y las listas solo incluyen chats de líneas que ves. Mantené apretado un chat (o una selección) y soltalo en cualquier carpeta, con deshacer, o usá Mover a carpeta. "Sin carpeta" arriba del árbol lista los chats que no están en ninguna',
        'Dois tipos de pastas, lado a lado, cada uma com subpastas e não lidas. Da equipe: os admins criam, renomeiam e excluem, todo o workspace vê e qualquer pessoa que pode editar uma conversa a coloca numa (uma pasta da equipe por conversa, a mesma para todos). Pessoais: cada pessoa tem as suas, que ninguém mais vê. Uma conversa pode estar numa pasta da equipe e numa sua ao mesmo tempo. As contagens e listas só incluem conversas de linhas que você vê. Segure uma conversa (ou uma seleção) e solte em qualquer pasta, com desfazer, ou use Mover para pasta. "Sem pasta" no topo da árvore lista as conversas que não estão em nenhuma',
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
    row('history-older', 'numbers', ['Load older messages from the phone, on demand', 'Cargar mensajes anteriores desde el teléfono, a pedido', 'Carregar mensagens anteriores do celular, sob demanda'], 'partial', {
      detail: [
        'A "Load older messages" chip at the top of a chat, once what we have stored runs out. It asks the phone for the 50 messages before the oldest one we have; they come in as history, without duplicates, and what you were reading stays in place. It says when the phone has no more, lets you retry after an error and is disabled with the reason while the line is disconnected. One request per chat at a time and a cap per line per hour. Tested with the fake server; with real WhatsApp it needs the phone online, and after linking a line again it needs our WhatsApp server image with patch 0006',
        'Una ficha "Cargar mensajes anteriores" arriba del chat, cuando lo que tenemos guardado se termina. Le pide al teléfono los 50 mensajes anteriores al más viejo que tenemos; entran como historial, sin repetidos, y lo que estabas leyendo queda en su lugar. Dice cuando el teléfono no tiene más, deja reintentar después de un error y queda deshabilitada con el motivo mientras la línea está desconectada. Un pedido por chat a la vez y un tope por línea por hora. Probado con el servidor falso; con WhatsApp real necesita el teléfono en línea y, después de volver a vincular una línea, la imagen de nuestro servidor de WhatsApp con el parche 0006',
        'Uma ficha "Carregar mensagens anteriores" no topo da conversa, quando o que temos guardado acaba. Pede ao celular as 50 mensagens anteriores à mais antiga que temos; entram como histórico, sem repetidas, e o que você estava lendo fica no lugar. Avisa quando o celular não tem mais, deixa tentar de novo depois de um erro e fica desabilitada com o motivo enquanto a linha está desconectada. Um pedido por conversa por vez e um limite por linha por hora. Testado com o servidor falso; com o WhatsApp real precisa do celular online e, depois de vincular uma linha de novo, da imagem do nosso servidor de WhatsApp com o patch 0006',
      ],
    }),
    row('history-missing', 'numbers', ['Fetch missing messages from the phone', 'Traer mensajes que faltan desde el teléfono', 'Buscar mensagens que faltam no celular'], 'partial', {
      detail: [
        '"Fetch missing messages" in the chat menu asks the phone for the messages before the last one, around the gaps WhatsApp reported and a bit further back (up to three requests of 50). What comes back is stored as history without duplicates, and a strip at the top of the chat says what happened: how many came, that nothing was missing, that the phone did not answer (with retry), that the line is disconnected or at its hourly cap. Tested with the fake server; with real WhatsApp it needs the phone online, and on lines linked again it needs our WhatsApp server image with patch 0006',
        '"Traer mensajes que faltan" en el menú del chat le pide al teléfono los mensajes anteriores al último, alrededor de los huecos que avisó WhatsApp y un poco más atrás (hasta tres pedidos de 50). Lo que vuelve se guarda como historial sin repetidos, y una franja arriba del chat dice qué pasó: cuántos llegaron, que no faltaba nada, que el teléfono no respondió (con reintentar), que la línea está desconectada o llegó a su tope por hora. Probado con el servidor falso; con WhatsApp real necesita el teléfono en línea y, en líneas vinculadas de nuevo, la imagen de nuestro servidor de WhatsApp con el parche 0006',
        '"Buscar mensagens que faltam" no menu da conversa pede ao celular as mensagens anteriores à última, em volta das lacunas que o WhatsApp avisou e um pouco mais para trás (até três pedidos de 50). O que volta é guardado como histórico sem repetidas, e uma faixa no topo da conversa diz o que aconteceu: quantas vieram, que não faltava nada, que o celular não respondeu (com tentar de novo), que a linha está desconectada ou chegou ao limite por hora. Testado com o servidor falso; com o WhatsApp real precisa do celular online e, em linhas vinculadas de novo, da imagem do nosso servidor de WhatsApp com o patch 0006',
      ],
    }),
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
    row('new-chat', 'inbox', ['New chat like WhatsApp Web: search, frequently contacted, all contacts A to Z', 'Chat nuevo como WhatsApp Web: buscador, contactados con frecuencia, todos los contactos de la A a la Z', 'Nova conversa como o WhatsApp Web: pesquisa, contatos frequentes, todos os contatos de A a Z'], 'partial', {
      detail: [
        'New in the sidebar opens it directly; names without accents and numbers in any format; New group goes to the group form; keyboard and phone layout. Tested with the fake provider; not yet tried with real WhatsApp',
        'Nuevo del lateral lo abre directo; nombres sin tildes y números escritos como sea; Grupo nuevo lleva a crear el grupo; teclado y teléfono. Probado con el proveedor falso; falta probarlo con WhatsApp real',
        'Novo da barra lateral abre direto; nomes sem acento e números em qualquer formato; Novo grupo leva ao formulário de grupo; teclado e celular. Testado com o provedor falso; falta testar com WhatsApp real',
      ],
    }),
    row('reply-from-app', 'inbox', ['Reply without the phone, media and replies', 'Responder sin el teléfono, con media y respuestas citadas', 'Responder sem o telefone, com mídia e respostas citadas'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('offline-queue', 'inbox', ['Write without a connection: messages queue and send on their own', 'Escribir sin conexión: los mensajes quedan en cola y salen solos', 'Escrever sem conexão: as mensagens ficam na fila e saem sozinhas'], 'partial', {
      detail: [
        'Chats you opened open without a connection. A text written offline shows with the clock, survives a reload, can be deleted before it goes, and sends in order and once when the connection is back (also with two tabs open); if the server rejects it, it stays as not sent with retry. Files need a connection: they stay in the tray. Tested with the fake provider',
        'Los chats que abriste se abren sin conexión. Un texto escrito sin red aparece con el reloj, sobrevive a recargar, se puede borrar antes de que salga y sale en orden y una sola vez al volver la conexión (también con dos pestañas abiertas); si el servidor lo rechaza, queda como no enviado con reintentar. Los archivos necesitan conexión: quedan en la bandeja. Probado con el proveedor falso',
        'As conversas que você abriu abrem sem conexão. Um texto escrito sem conexão aparece com o relógio, sobrevive a recarregar, pode ser apagado antes de sair e sai em ordem e uma única vez quando a conexão volta (também com duas abas abertas); se o servidor recusar, fica como não enviado com tentar de novo. Arquivos precisam de conexão: ficam na bandeja. Testado com o provedor falso',
      ],
    }),
    row('reactions', 'inbox', ['Reactions', 'Reacciones', 'Reações'], 'partial', {
      detail: [
        'Any emoji, and a click on the reactions shows who reacted (photo, name, number hidden for people who cannot see numbers) and removes your own. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Cualquier emoji, y un clic en las reacciones muestra quién reaccionó (foto, nombre, número oculto para quien no puede ver números) y saca la propia. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Qualquer emoji, e um clique nas reações mostra quem reagiu (foto, nome, número oculto para quem não pode ver números) e remove a sua. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('edit-delete-forward', 'inbox', ['Edit, delete, forward and pin messages', 'Editar, borrar, reenviar y fijar mensajes', 'Editar, apagar, encaminhar e fixar mensagens'], 'partial', {
      detail: [
        'The message menu follows the WhatsApp order and, in groups, has Reply privately (the one on one chat on the same line opens replying, with the group in the quote) and Message plus the name of the sender. Edit (15 min) and delete for everyone on WAHA and Evolution numbers, also when it happens on the phone. Pins go to WhatsApp on WAHA and stay in Lines elsewhere. Forward is native on WAHA and a copy elsewhere, for any message: a voice note goes as a voice note with its length, and what arrived through Evolution is copied too. On Evolution it reaches the other phone with the Forwarded label (Forwarded many times from five), as from the phone, once the gateway runs patch 0013. The Cloud API cannot edit or delete. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'El menú del mensaje sigue el orden de WhatsApp y, en grupos, tiene Responder en privado (el chat individual en la misma línea se abre respondiendo, con el grupo en la cita) y Enviar mensaje con el nombre de quien escribió. Editar (15 min) y borrar para todos en números WAHA y Evolution, también cuando pasa desde el teléfono. Fijar llega a WhatsApp en WAHA y queda en Lines en el resto. Reenviar es nativo en WAHA y una copia en el resto, para cualquier mensaje: una nota de voz sale como nota de voz con su duración, y lo que llegó por Evolution también se copia. En Evolution llega al otro teléfono con la marca de Reenviado (Reenviado muchas veces desde cinco), como desde el teléfono, una vez que el gateway tiene el parche 0013. La Cloud API no deja editar ni borrar. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'O menu da mensagem segue a ordem do WhatsApp e, em grupos, tem Responder em particular (a conversa individual na mesma linha abre respondendo, com o grupo na citação) e Enviar mensagem com o nome de quem escreveu. Editar (15 min) e apagar para todos em números WAHA e Evolution, também quando acontece no telefone. Fixar chega ao WhatsApp no WAHA e fica no Lines nos outros. Encaminhar é nativo no WAHA e uma cópia nos outros, para qualquer mensagem: uma nota de voz sai como nota de voz com sua duração, e o que chegou pelo Evolution também é copiado. No Evolution chega ao outro telefone com a marca de Encaminhada (Encaminhada com frequência a partir de cinco), como pelo celular, quando o gateway tiver o patch 0013. A Cloud API não deixa editar nem apagar. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('assignment', 'inbox', ['Assign chats', 'Asignar chats', 'Atribuir chats'], 'have', {
      weight: 2,
      detail: [
        'To a person and a team, Mine, Unassigned and team filters, history in the thread and in the chat details (who, to whom, when and why, also by API) and a notification to the assignee',
        'A una persona y a un equipo, filtros Míos, Sin asignar y por equipo, historial en el hilo y en los detalles del chat (quién, a quién, cuándo y por qué, también por API) y aviso a quien lo recibe',
        'A uma pessoa e a uma equipe, filtros Minhas, Sem atribuição e por equipe, histórico no fio e nos detalhes do chat (quem, para quem, quando e por quê, também por API) e aviso para quem recebe',
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
        'Photos and videos sent together show as one album. Voice notes and files show in the chat as soon as you send them and upload in the background. Link previews like WhatsApp (large image, compact, while typing) and a personal Display setting (text size, list density, media size, previews) with a live preview, opened from the chat menu. No message search inside a chat yet',
        'Las fotos y videos mandados juntos se ven en un álbum. Las notas de voz y los archivos aparecen en el chat al mandarlos y se suben por detrás. Vista previa de links como WhatsApp (imagen grande, compacta, al escribir) y una Visualización por persona (tamaño del texto, densidad de la lista, tamaño de la media, vistas previas) con vista previa en vivo, desde el menú del chat. Todavía sin búsqueda dentro de un chat',
        'Fotos e vídeos enviados juntos aparecem num álbum. Notas de voz e arquivos aparecem na conversa assim que são enviados e sobem em segundo plano. Prévia de links como no WhatsApp (imagem grande, compacta, ao digitar) e uma Visualização por pessoa (tamanho do texto, densidade da lista, tamanho da mídia, prévias) com prévia ao vivo, pelo menu da conversa. Ainda sem busca dentro de uma conversa',
      ],
    }),
    row('wa-stickers', 'inbox', ['Stickers and GIFs: see, send, favorites', 'Stickers y GIF: verlos, mandarlos, favoritos', 'Figurinhas e GIFs: ver, enviar, favoritas'], 'partial', {
      detail: [
        'Received stickers show small and without a bubble (animated ones move), GIFs play inside the bubble. The Stickers tab of the emoji panel shows yours first, like WhatsApp: Recent (what you sent from that number, also from the phone), Favorites and Created by you, with received stickers folded under "From your chats"; one collection per number (each chat shows the stickers of its own number); WhatsApp does not let linked devices read the stickers saved on the phone, so the collection is built from the stickers in the chats of that number (imported on their own the first time you open the tab, then it stays up to date) and from images you turn into stickers. Lottie stickers show as a placeholder. Tested with the fake provider',
        'Los stickers que llegan se ven chicos y sin burbuja (los animados se mueven) y los GIF se reproducen en la burbuja. La pestaña Stickers del panel de emojis muestra primero lo tuyo, como WhatsApp: Recientes (lo que mandaste desde ese número, también desde el teléfono), Favoritos y Creados por vos, con los recibidos plegados en "De tus chats"; una colección por número (cada chat muestra los stickers de su número); WhatsApp no deja que los dispositivos vinculados lean los stickers guardados en el teléfono, así que la colección se arma con los stickers de los chats de ese número (se importan solos la primera vez que abrís la pestaña y después se mantiene sola) y con imágenes que convertís en sticker. Los stickers Lottie se ven como un lugar vacío. Probado con el proveedor falso',
        'As figurinhas recebidas aparecem pequenas e sem balão (as animadas se mexem) e os GIFs tocam no balão. A aba Figurinhas do painel de emojis mostra primeiro as suas, como o WhatsApp: Recentes (o que você enviou desse número, também pelo celular), Favoritas e Criadas por você, com as recebidas recolhidas em "Das suas conversas"; uma coleção por número (cada conversa mostra as figurinhas do seu número); o WhatsApp não deixa aparelhos vinculados lerem as figurinhas salvas no celular, então a coleção é montada com as figurinhas das conversas desse número (importadas sozinhas na primeira vez que você abre a aba e depois se atualiza sozinha) e com imagens que você transforma em figurinha. Figurinhas Lottie aparecem como um espaço vazio. Testado com o provedor falso',
      ],
    }),
    row('wa-gifs', 'inbox', ['Search and send GIFs', 'Buscar y mandar GIF', 'Pesquisar e enviar GIFs'], 'partial', {
      detail: [
        'GIFs tab in the emoji panel, between Emoji and Stickers: trending when empty, categories like WhatsApp (Haha, Sad, Love...), search in your language, and a click sends it as a WhatsApp GIF (MP4 that plays muted on a loop). Needs a GIPHY or Tenor key on the server. With Evolution 2.3.7 and earlier it arrives as a regular video, because that version does not pass gifPlayback. Tested with sample GIFs and the fake provider',
        'Pestaña GIF en el panel de emojis, entre Emoji y Stickers: tendencias al abrirla, categorías como WhatsApp (Jaja, Triste, Amor...), búsqueda en tu idioma, y un clic lo manda como GIF de WhatsApp (MP4 que se reproduce sin sonido y en bucle). Necesita una clave de GIPHY o Tenor en el servidor. Con Evolution 2.3.7 o anterior llega como video común, porque esa versión no pasa gifPlayback. Probado con GIF de ejemplo y el proveedor falso',
        'Aba GIFs no painel de emojis, entre Emoji e Figurinhas: em alta ao abrir, categorias como no WhatsApp (Haha, Triste, Amor...), pesquisa no seu idioma, e um clique envia como GIF do WhatsApp (MP4 que toca sem som e em loop). Precisa de uma chave do GIPHY ou do Tenor no servidor. Com o Evolution 2.3.7 ou anterior chega como vídeo comum, porque essa versão não repassa gifPlayback. Testado com GIFs de exemplo e o provedor falso',
      ],
    }),
    row('wa-photos', 'inbox', ['Profile photos of chats and group members', 'Fotos de perfil de chats y miembros de grupos', 'Fotos de perfil de conversas e membros de grupos'], 'partial', {
      detail: [
        'Chats and every group member (next to their messages, in the member list and when mentioning), fetched a few at a time, stored so they do not expire and checked again every week. Tested with the fake provider',
        'Los chats y cada miembro de un grupo (al lado de sus mensajes, en la lista de miembros y al mencionar), pedidas de a pocas, guardadas para que no venzan y revisadas cada semana. Probado con el proveedor falso',
        'As conversas e cada membro de um grupo (ao lado das mensagens, na lista de membros e ao mencionar), buscadas poucas por vez, guardadas para não expirar e conferidas toda semana. Testado com o provedor falso',
      ],
    }),
    row('wa-contact-info', 'inbox', ['Contact info of a group member', 'Info del contacto de un miembro del grupo', 'Dados do contato de um membro do grupo'], 'partial', {
      detail: [
        'The photo or name of a sender, or a member in the chat details, opens their contact info like WhatsApp: photo, name, number, about, admin badge, Message (opens or starts the chat on the same line), shared media, links and docs, starred messages, mute and block of that chat (block also from the info panel of a one-to-one chat, on lines connected through Evolution), and groups in common on the line. No calls. Tested with the fake provider; blocking not yet tried with real WhatsApp',
        'La foto o el nombre de quien escribió, o un miembro en los detalles del chat, abre su info del contacto como en WhatsApp: foto, nombre, número, info, si es admin, Mensaje (abre o empieza el chat en la misma línea), archivos, enlaces y documentos, destacados, silenciar y bloquear ese chat (bloquear también desde la info de un chat 1:1, en líneas conectadas con Evolution), y los grupos en común de la línea. Sin llamadas. Probado con el proveedor falso; bloquear falta probarlo con WhatsApp real',
        'A foto ou o nome de quem escreveu, ou um membro nos detalhes da conversa, abre os dados do contato como no WhatsApp: foto, nome, número, recado, se é admin, Mensagem (abre ou começa a conversa na mesma linha), mídia, links e docs, favoritas, silenciar e bloquear essa conversa (bloquear também pelos dados de uma conversa 1:1, em linhas conectadas pelo Evolution), e os grupos em comum da linha. Sem chamadas. Testado com o provedor falso; bloquear falta testar com WhatsApp real',
      ],
    }),
    row('wa-mentions', 'inbox', ['@mentions in groups that notify on WhatsApp', '@menciones en grupos que avisan en WhatsApp', '@menções em grupos que avisam no WhatsApp'], 'partial', {
      detail: [
        'Type @ to pick a group member, the mention shows in green in the field and goes out as a real WhatsApp mention. Clicking a received mention opens that contact info. Not in file captions or scheduled messages yet. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Con @ se elige a alguien del grupo, la mención se ve en verde en el campo y sale como mención real de WhatsApp. Una mención recibida abre la info del contacto. Todavía no en los comentarios de archivos ni en los mensajes programados. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Com @ se escolhe alguém do grupo, a menção aparece em verde no campo e sai como menção real do WhatsApp. Uma menção recebida abre os dados do contato. Ainda não nas legendas de arquivos nem nas mensagens agendadas. Testado contra um gateway simulado; falta testar com WhatsApp real',
      ],
    }),
    row('archive', 'inbox', ['Archive chats and an Archived section, delete a chat from the list and restore it from Deleted', 'Archivar chats con la sección Archivados, eliminar un chat de la lista y recuperarlo desde Eliminados', 'Arquivar conversas com a seção Arquivadas, apagar uma conversa da lista e recuperá-la em Apagadas'], 'have', {
      detail: [
        'Synced with the phone both ways. Sending a message to an archived chat unarchives it, like on WhatsApp, and Keep archived holds a chosen chat in Archived',
        'Sincronizado con el teléfono en los dos sentidos. Mandar un mensaje a un chat archivado lo desarchiva, como en WhatsApp, y Mantener archivado deja un chat elegido en Archivados',
        'Sincronizado com o celular nos dois sentidos. Enviar uma mensagem para uma conversa arquivada a desarquiva, como no WhatsApp, e Manter arquivada deixa uma conversa escolhida em Arquivadas',
      ],
    }),
    row('snooze', 'inbox', ['Snooze a chat', 'Posponer un chat', 'Adiar uma conversa'], 'have', {
      competitorHas: false,
      detail: [
        'From the chat menu, with options that fit the moment or a day and time from a calendar. The chat waits in Archived (on the phone too) and comes back when the time is up or a new message arrives',
        'Desde el menú del chat, con opciones según el momento o un día y hora del calendario. El chat espera en Archivados (también en el teléfono) y vuelve a la hora o cuando llega un mensaje',
        'Pelo menu da conversa, com opções conforme o momento ou um dia e hora do calendário. A conversa espera em Arquivadas (no celular também) e volta na hora ou quando chega uma mensagem',
      ],
    }),
    row('presence', 'inbox', ['Typing, recording and online indicators', 'Indicadores de escribiendo, grabando y en línea', 'Indicadores de digitando, gravando e online'], 'have', {
      detail: ['QR lines (Evolution); 1:1 chats that WhatsApp identifies only by a hidden id do not show it', 'Líneas por QR (Evolution); los 1 a 1 que WhatsApp identifica solo con un id oculto no lo muestran', 'Linhas por QR (Evolution); conversas 1 a 1 que o WhatsApp identifica só por um id oculto não mostram'],
    }),
    row('read-receipts', 'inbox', ['Mark chats as read on WhatsApp when the team reads them (optional)', 'Marcar leído en WhatsApp cuando el equipo lee (opcional)', 'Marcar como lida no WhatsApp quando a equipe lê (opcional)'], 'have'),
    row('send-contact', 'inbox', ['Send contact cards', 'Mandar tarjetas de contacto', 'Enviar cartões de contato'], 'have'),
    row('wa-image-editor', 'inbox', ['Edit a photo before sending (crop, draw, text, sticker, HD)', 'Editar una foto antes de mandarla (recortar, dibujar, texto, sticker, HD)', 'Editar uma foto antes de enviar (cortar, desenhar, texto, figurinha, HD)'], 'partial', {
      detail: [
        'Same editor as Inbox: crop and rotate, emoji or sticker, colored text, pencil, undo, caption emoji and HD. Missing: blur and filters. Tested with the fake provider',
        'El mismo editor que Inbox: recortar y rotar, emoji o sticker, texto de color, lápiz, deshacer, emoji en el comentario y HD. Faltan desenfocar y filtros. Probado con el proveedor falso',
        'O mesmo editor do Inbox: cortar e girar, emoji ou figurinha, texto colorido, lápis, desfazer, emoji na legenda e HD. Faltam desfoque e filtros. Testado com o provedor falso',
      ],
    }),
    row('wa-attach-menu', 'inbox', ['Attach menu like WhatsApp (camera, poll, new sticker)', 'Menú de adjuntar como WhatsApp (cámara, encuesta, sticker nuevo)', 'Menu de anexar como o WhatsApp (câmera, enquete, nova figurinha)'], 'partial', {
      detail: [
        'Document, photos and videos, camera (the computer camera too), audio, contact, poll and new sticker, in the WhatsApp order with colored icons; poll and contact only show when the line can send them. Help me write, dictate, send later and commands go below a line. Events are missing: our WhatsApp server cannot send them yet. Tested with the fake provider',
        'Documento, fotos y videos, cámara (también la de la computadora), audio, contacto, encuesta y sticker nuevo, en el orden de WhatsApp con íconos de color; encuesta y contacto aparecen solo si la línea los puede mandar. Ayudame a escribir, dictar, enviar más tarde y comandos van debajo de una línea. Faltan los eventos: nuestro servidor de WhatsApp todavía no los puede mandar. Probado con el proveedor falso',
        'Documento, fotos e vídeos, câmera (também a do computador), áudio, contato, enquete e nova figurinha, na ordem do WhatsApp com ícones coloridos; enquete e contato só aparecem se a linha pode enviá-los. Me ajude a escrever, ditar, enviar depois e comandos ficam abaixo de uma linha. Faltam os eventos: nosso servidor de WhatsApp ainda não consegue enviá-los. Testado com o provedor falso',
      ],
    }),
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
    row('kanban-inbox', 'inbox', ['Kanban view of the inbox', 'Vista kanban de la bandeja', 'Visualização kanban da caixa'], 'better', {
      competitorHas: false,
      detail: [
        'Chats as cards in columns: team stages set by an admin, your own private stages, or the options of a HubSpot company property (moving a card writes it to HubSpot). Filters, search, folders and lines apply to the board',
        'Los chats como tarjetas en columnas: etapas del equipo que define un admin, tus etapas privadas o las opciones de una propiedad de la empresa de HubSpot (mover una tarjeta la escribe en HubSpot). Filtros, búsqueda, carpetas y líneas valen en el tablero',
        'As conversas como cartões em colunas: etapas da equipe definidas por um admin, suas etapas privadas ou as opções de uma propriedade da empresa no HubSpot (mover um cartão grava no HubSpot). Filtros, busca, pastas e linhas valem no quadro',
      ],
    }),
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
    row('group-events', 'groups', ['Group notices: created, added, left, admins', 'Avisos del grupo: creado, agregó, salió, admins', 'Avisos do grupo: criado, adicionou, saiu, admins'], 'partial', {
      detail: [
        'A new group, or one the line was added to, shows in the inbox right away with its notice as the preview. Adds, removals, leaves, invite link joins, admin changes and name or description changes made from zerosoft show as centered lines. Changes of name, description or icon made on the phone arrive once the updated WhatsApp server is deployed. Tested against a simulated gateway',
        'Un grupo nuevo, o uno al que agregaron a la línea, aparece en la bandeja en el momento con su aviso de vista previa. Agregados, sacados, salidas, entradas con el link, cambios de admin y de nombre o descripción hechos desde zerosoft se ven como líneas centradas. Los cambios de nombre, descripción o foto hechos en el teléfono llegan cuando se despliegue el servidor de WhatsApp actualizado. Probado contra un gateway simulado',
        'Um grupo novo, ou um ao qual a linha foi adicionada, aparece na caixa na hora com seu aviso como prévia. Adições, remoções, saídas, entradas pelo link, mudanças de admin e de nome ou descrição feitas pelo zerosoft aparecem como linhas centralizadas. Mudanças de nome, descrição ou foto feitas no celular chegam quando o servidor do WhatsApp atualizado for implantado. Testado contra um gateway simulado',
      ],
    }),
    row('bulk-create', 'groups', ['Create many groups from a CSV', 'Crear muchos grupos desde un CSV', 'Criar muitos grupos a partir de um CSV'], 'partial', {
      competitorHas: false,
      detail: ['Up to 50 per run with result per row. Tested against a simulated gateway; not yet tried with real WhatsApp', 'Hasta 50 por vez con resultado por fila. Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Até 50 por vez com resultado por linha. Testado contra um gateway simulado; falta testar com WhatsApp real'],
    }),
    row('bulk-members', 'groups', ['Add and remove members in many groups', 'Agregar y quitar miembros en muchos grupos', 'Adicionar e remover membros em muitos grupos'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'], weight: 2 }),
    row('admins', 'groups', ['Promote and demote admins in bulk', 'Promover y degradar admins en masa', 'Promover e rebaixar admins em massa'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('invite-links', 'groups', ['Invite link and reset', 'Link de invitación y regenerarlo', 'Link de convite e redefinir'], 'partial', { detail: ['Tested against a simulated gateway; not yet tried with real WhatsApp', 'Probado contra un gateway simulado; falta probarlo con WhatsApp real', 'Testado contra um gateway simulado; falta testar com WhatsApp real'] }),
    row('group-members-panel', 'groups', ['Add members and change admins from the chat', 'Agregar miembros y cambiar admins desde el chat', 'Adicionar membros e mudar admins pela conversa'], 'partial', {
      detail: [
        'Members sits near the top of the group details: Add members (several at once, from the line contacts or a typed number), Invite via link, and a menu on each member to make or dismiss a group admin, remove them or message them. Anyone who can see the chat can use it. If the line is not an admin of the group the actions show disabled with the reason; WhatsApp refusals show per person, with an option to send the invite link. Tested with the fake provider; not yet tried with real WhatsApp',
        'Miembros está arriba en los detalles del grupo: Agregar miembros (varios a la vez, de los contactos de la línea o un número escrito), Invitar con link, y un menú en cada miembro para hacerlo admin o quitarle el admin, sacarlo o mandarle un mensaje. Lo puede usar quien ve el chat. Si la línea no es admin del grupo, las acciones se ven deshabilitadas con el motivo; los rechazos de WhatsApp se ven por persona, con la opción de mandar el link. Probado con el proveedor falso; falta probarlo con WhatsApp real',
        'Membros fica no topo dos detalhes do grupo: Adicionar membros (vários de uma vez, dos contatos da linha ou um número digitado), Convidar via link e um menu em cada membro para torná-lo admin ou tirar o admin, removê-lo ou mandar mensagem. Quem vê a conversa pode usar. Se a linha não é admin do grupo, as ações aparecem desabilitadas com o motivo; as recusas do WhatsApp aparecem por pessoa, com a opção de enviar o link. Testado com o provedor falso; falta testar com WhatsApp real',
      ],
    }),
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
    row('groups-table', 'groups', ['Groups table with columns, filters and sorting', 'Tabla de grupos con columnas, filtros y orden', 'Tabela de grupos com colunas, filtros e ordenação'], 'have', {
      detail: [
        'Pick the columns (group, zerosoft properties, HubSpot company properties, company owner, deal and deal stage), add your own, edit them in the cell (labels, status, zerosoft properties and HubSpot company properties, written to HubSpot), sort by any of them and filter by one, several or all numbers. A group that several of your numbers are in is one row that lists those numbers, with one HubSpot company, which you link, change or unlink right in the cell by searching HubSpot as you type (the Contacts table does the same with the HubSpot contact). The header and the name stay in place while you scroll, and arrow keys move between cells',
        'Elegís las columnas (del grupo, propiedades de zerosoft, de la empresa en HubSpot, dueño, negocio y etapa), agregás las tuyas, las editás en la celda (etiquetas, estado, propiedades de zerosoft y de la empresa en HubSpot, que se escriben en HubSpot), ordenás por cualquiera y filtrás por una, varias o todas las líneas. Un grupo en el que están varias de tus líneas es una sola fila que dice en cuáles está, con una sola empresa de HubSpot, que se vincula, cambia o desvincula en la misma celda buscando en HubSpot mientras escribís (la tabla de Contactos hace lo mismo con el contacto de HubSpot). La cabecera y el nombre quedan fijos al scrollear, y las flechas pasan de celda en celda',
        'Escolha as colunas (do grupo, propriedades do zerosoft, da empresa no HubSpot, dono, negócio e etapa), adicione as suas, edite na célula (etiquetas, status, propriedades do zerosoft e da empresa no HubSpot, gravadas no HubSpot), ordene por qualquer uma e filtre por uma, várias ou todas as linhas. Um grupo em que estão várias das suas linhas é uma só linha da tabela que mostra em quais está, com uma só empresa do HubSpot, que se vincula, troca ou desvincula na própria célula buscando no HubSpot enquanto você digita (a tabela de Contatos faz o mesmo com o contato do HubSpot). O cabeçalho e o nome ficam fixos ao rolar, e as setas passam de célula em célula',
      ],
    }),
    row('leave-join', 'groups', ['Join by invite and leave a group', 'Entrar por invitación y salir de un grupo', 'Entrar por convite e sair de um grupo'], 'partial', {
      detail: [
        'Join with the invite link, or with Join group on an invite card in a chat (after a confirmation), and the group arrives with its members; leaving keeps the history. Tested against a simulated gateway; not yet tried with real WhatsApp',
        'Entrar con el link de invitación, o con Unirme al grupo en la tarjeta de una invitación en un chat (después de confirmar), trae el grupo con sus miembros; salir conserva el historial. Probado contra un gateway simulado; falta probarlo con WhatsApp real',
        'Entrar com o link de convite, ou com Entrar no grupo no cartão de um convite numa conversa (depois de confirmar), traz o grupo com os membros; sair mantém o histórico. Testado contra um gateway simulado; falta testar com WhatsApp real',
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
      detail: [
        'Chats and groups link to CRM contacts and companies, with messages and tickets on the record. A Contacts section lists each person once across lines (phone and WhatsApp id joined), with their lines, groups, last message and HubSpot contact and company; create in HubSpot looks the phone up first and adds the contact to the company of their groups. Tested with the fake provider and a simulated HubSpot',
        'Chats y grupos se vinculan a contactos y empresas del CRM, con mensajes y tickets en la ficha. Una sección Contactos muestra cada persona una vez entre líneas (teléfono e id de WhatsApp unidos), con sus líneas, grupos, último mensaje y su contacto y empresa de HubSpot; crear en HubSpot busca el teléfono antes y suma el contacto a la empresa de sus grupos. Probado con el proveedor falso y un HubSpot simulado',
        'Chats e grupos se vinculam a contatos e empresas do CRM, com mensagens e tickets na ficha. Uma seção Contatos mostra cada pessoa uma vez entre linhas (telefone e id do WhatsApp unidos), com linhas, grupos, última mensagem e o contato e a empresa no HubSpot; criar no HubSpot busca o telefone antes e coloca o contato na empresa dos grupos dele. Testado com o provedor falso e um HubSpot simulado',
      ],
    }),
    row('saved-lists', 'organize', ['Saved chat lists', 'Listas guardadas de chats', 'Listas salvas de chats'], 'have', {
      detail: [
        'Filters by tab, label, type, assignee and property; shared or personal, in the sidebar and ⌘K, and as a broadcast audience',
        'Filtros por pestaña, etiqueta, tipo, asignado y propiedad; compartidas o personales, en el sidebar y ⌘K, y como audiencia de envíos',
        'Filtros por aba, etiqueta, tipo, responsável e propriedade; compartilhadas ou pessoais, na barra lateral e no ⌘K, e como público de envios',
      ],
    }),
    row('migrate-from-periskope', 'organize', ['Move from Periskope', 'Migrar de Periskope', 'Migrar do Periskope'], 'partial', {
      competitorHas: false,
      detail: [
        'CSV files of labels, quick replies, chats and contacts with a preview; chats get labels, assignee and custom properties. Periskope does not publish its export columns, so common names are read and the rest is reported',
        'Archivos CSV de etiquetas, respuestas rápidas, chats y contactos con vista previa; los chats reciben etiquetas, asignado y propiedades. Periskope no publica las columnas de sus exports: se leen los nombres comunes y se avisa el resto',
        'Arquivos CSV de etiquetas, respostas rápidas, chats e contatos com prévia; os chats recebem etiquetas, responsável e propriedades. O Periskope não publica as colunas dos exports: lemos os nomes comuns e avisamos o resto',
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
        'Send later from the message box with options that fit the moment (working hours, Monday morning on a Friday) or a day and time from a calendar; the pending message stays in the chat, where you can send it now, change the time, edit or cancel it; one view lists them across chats. A voice note can be scheduled from the recording bar: it shows with its length and a play button, and goes out as a voice note (tested with the fake provider)',
        'Enviar más tarde desde el cuadro con opciones según el momento (horario de trabajo, el lunes a la mañana si es viernes) o un día y hora del calendario; el pendiente queda en el chat, donde se envía ahora, se le cambia la hora, se edita o se cancela; una vista los lista de todos los chats. Una nota de voz se programa desde la barra de grabación: se ve con su duración y un botón para escucharla, y sale como nota de voz (probado con el proveedor falso)',
        'Enviar mais tarde pela caixa com opções conforme o momento (horário comercial, segunda de manhã se for sexta) ou um dia e hora do calendário; a pendente fica na conversa, onde dá para enviar agora, mudar o horário, editar ou cancelar; uma tela lista as de todas as conversas. Uma mensagem de voz pode ser agendada pela barra de gravação: aparece com a duração e um botão para ouvir, e sai como mensagem de voz (testado com o provedor falso)',
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
        'Rules by number, label or chat type that rotate among a team or some people who are online (online, away or offline status). A rule can hand the open chats of someone who goes offline to the people online',
        'Reglas por número, etiqueta o tipo de chat que rotan entre un equipo o algunas personas en línea (estado en línea, ausente o desconectado). Una regla puede pasar los chats abiertos de quien se desconecta a quienes están en línea',
        'Regras por número, etiqueta ou tipo de chat que revezam entre uma equipe ou algumas pessoas online (status online, ausente ou offline). Uma regra pode passar os chats abertos de quem fica offline para quem está online',
      ],
    }),
    row('ai-summary', 'automation', ['AI summary of a chat', 'Resumen AI de un chat', 'Resumo IA de um chat'], 'have'),
    row('ai-agent', 'automation', ['AI agent that answers in chats and groups', 'Agente AI que responde en chats y grupos', 'Agente IA que responde em chats e grupos'], 'have', {
      detail: ['Any agent from Agents, with its knowledge, tools and handoff', 'Cualquier agente de Agents, con su conocimiento, herramientas y derivación', 'Qualquer agente do Agents, com seu conhecimento, ferramentas e transferência'],
    }),
    row('folders-json', 'automation', ['Folders from a JSON with the assistant', 'Carpetas desde un JSON con el asistente', 'Pastas a partir de um JSON com o assistente'], 'partial', {
      competitorHas: false,
      detail: [
        'Paste a JSON exported from another tool and the assistant plans your folders and which chats go in each, only with chats you can see. Chats already in another folder stay there unless you ask to move them; you confirm before anything changes. It cannot create chats that are not on a line yet. Tested with the fake model',
        'Pegá un JSON exportado de otra herramienta y el asistente arma el plan de tus carpetas y qué chats van en cada una, solo con los chats que ves. Los que ya están en otra carpeta se quedan ahí salvo que pidas moverlos; confirmás antes de que cambie algo. No puede crear chats que todavía no están en una línea. Probado con el modelo falso',
        'Cole um JSON exportado de outra ferramenta e o assistente monta o plano das suas pastas e quais conversas vão em cada uma, só com as conversas que você vê. As que já estão em outra pasta ficam lá a menos que você peça para movê-las; você confirma antes de qualquer mudança. Não consegue criar conversas que ainda não estão numa linha. Testado com o modelo falso',
      ],
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
        'Connect with a HubSpot service key or the token of an existing private app; link each chat or group to a HubSpot company, deal and contact, with a suggestion by phone number, a daily note on the linked records and an inbox filter. All the company properties (custom ones too) are imported and synced both ways, editable from a HubSpot panel on the chat that can be pinned next to the conversation, usable as inbox filters, and there is a view to link groups in bulk. Each person picks which company, contact and deal properties they see, and the panel shows every contact and deal property (custom ones too), editable from Lines. A 1:1 chat creates its HubSpot contact with one click, or by itself when it comes in (an opt-in setting), after checking the phone is not there yet. Periskope also creates HubSpot tickets from a chat and sends WhatsApp from a HubSpot workflow. Tested against a simulated HubSpot; not yet tried with a real account',
        'Se conecta con una service key de HubSpot o el token de una private app que ya existe; cada chat o grupo se vincula a una empresa, un negocio y un contacto de HubSpot, con sugerencia por teléfono, una nota diaria en los registros vinculados y un filtro en la bandeja. Todas las propiedades de la empresa (también las propias) se importan y se sincronizan en los dos sentidos, se editan desde un panel de HubSpot en el chat que se puede fijar al costado de la conversación, sirven como filtros de la bandeja, y hay una vista para vincular grupos de a muchos. Cada persona elige qué propiedades de la empresa, del contacto y del negocio ve, y el panel muestra todas las del contacto y del negocio (también las propias), editables desde Lines. Un chat 1:1 crea su contacto en HubSpot con un clic, o solo al entrar (un ajuste opcional), después de revisar que el teléfono no esté. Periskope además crea tickets de HubSpot desde un chat y manda WhatsApp desde un workflow de HubSpot. Probado contra un HubSpot simulado; falta probarlo con una cuenta real',
        'Conecta com uma service key do HubSpot ou o token de um private app que já existe; cada conversa ou grupo se vincula a uma empresa, um negócio e um contato do HubSpot, com sugestão por telefone, uma nota diária nos registros vinculados e um filtro na caixa. Todas as propriedades da empresa (também as personalizadas) são importadas e sincronizadas nos dois sentidos, editadas em um painel do HubSpot na conversa que pode ficar fixo ao lado dela, usadas como filtros da caixa, e há uma visão para vincular grupos em massa. Cada pessoa escolhe quais propriedades da empresa, do contato e do negócio vê, e o painel mostra todas as do contato e do negócio (também as personalizadas), editáveis pelo Lines. Uma conversa 1:1 cria o contato no HubSpot com um clique, ou sozinha quando chega (um ajuste opcional), depois de conferir que o telefone ainda não está lá. O Periskope também cria tickets do HubSpot a partir de uma conversa e envia WhatsApp a partir de um workflow do HubSpot. Testado contra um HubSpot simulado; falta testar com uma conta real',
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
        'Each line has an owner and can be limited to chosen people or teams; admins and the owner always see it. Lines can be put in groups (Sales, Operations) and a whole group given to people or teams, including the lines added to it later; the inbox selector lists lines under their group and filters by group. Chats, messages, search, Cmd+K, the API, MCP, CRM and notifications all follow it. Covered by unit tests; not yet tried by a real team',
        'Cada línea tiene un dueño y se puede limitar a personas o equipos elegidos; admins y dueño siempre la ven. Las líneas se pueden poner en grupos (Ventas, Operaciones) y darle un grupo entero a personas o equipos, también con las líneas que se sumen después; el selector de la bandeja lista las líneas debajo de su grupo y filtra por grupo. Chats, mensajes, búsqueda, Cmd+K, API, MCP, CRM y avisos la respetan. Cubierto con tests unitarios; falta probarlo con un equipo real',
        'Cada linha tem um dono e pode ser limitada a pessoas ou equipes escolhidas; admins e dono sempre a veem. As linhas podem ficar em grupos (Vendas, Operações) e um grupo inteiro pode ser dado a pessoas ou equipes, também com as linhas adicionadas depois; o seletor da caixa lista as linhas abaixo do grupo e filtra por grupo. Conversas, mensagens, busca, Cmd+K, API, MCP, CRM e avisos a respeitam. Coberto com testes unitários; falta testar com uma equipe real',
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
