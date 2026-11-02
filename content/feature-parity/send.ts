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

/**
 * Send contra DocSend. Fuente: docs/benchmark/send.md (centro de ayuda de
 * Dropbox, leído el 2026-11-02; docsend.com devolvió 403). Lo probado solo con
 * fakes o que pide un servicio externo queda como partial. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'DocSend',
  lastReviewed: '2026-11-02',
  areas: [
    { id: 'content', label: loc(['Content', 'Contenido', 'Conteúdo']) },
    { id: 'links', label: loc(['Links', 'Links', 'Links']) },
    { id: 'access', label: loc(['Access and protection', 'Acceso y protección', 'Acesso e proteção']) },
    { id: 'viewer', label: loc(['Viewer', 'Visor', 'Visor']) },
    { id: 'analytics', label: loc(['Analytics', 'Números', 'Números']) },
    { id: 'alerts', label: loc(['Alerts', 'Avisos', 'Avisos']) },
    { id: 'versions', label: loc(['Versions', 'Versiones', 'Versões']) },
    { id: 'spaces', label: loc(['Spaces (data rooms)', 'Espacios (salas de datos)', 'Espaços (salas de dados)']) },
    { id: 'agreements', label: loc(['Agreements and signing', 'Acuerdos y firma', 'Acordos e assinatura']) },
    { id: 'branding', label: loc(['Branding', 'Marca', 'Marca']) },
    { id: 'platform', label: loc(['Team and integrations', 'Equipo e integraciones', 'Equipe e integrações']) },
  ],
  rows: [
    // Contenido
    row('pdf', 'content', ['PDF', 'PDF', 'PDF'], 'partial', {
      weight: 2,
      detail: ['Shown exactly, up to 500 pages like DocSend, but 100 MB per file against their 2 GB', 'Se ve exacto, hasta 500 páginas como DocSend, pero 100 MB por archivo contra sus 2 GB', 'Exibido exatamente, até 500 páginas como o DocSend, mas 100 MB por arquivo contra 2 GB deles'],
    }),
    row('powerpoint', 'content', ['PowerPoint', 'PowerPoint', 'PowerPoint'], 'partial', {
      weight: 2,
      detail: ['.pptx through a built-in renderer: text, images, tables and basic shapes, with a warning. No charts, SmartArt, gradients or animation, and no .ppt', '.pptx con un dibujo propio: texto, imágenes, tablas y formas básicas, con un aviso. Sin gráficos, SmartArt, degradados ni animación, y sin .ppt', '.pptx com um desenho próprio: texto, imagens, tabelas e formas básicas, com um aviso. Sem gráficos, SmartArt, degradês nem animação, e sem .ppt'],
    }),
    row('word', 'content', ['Word', 'Word', 'Word'], 'partial', {
      detail: ['.docx with a simplified layout and a warning, Latin alphabets only. No .doc', '.docx con un diseño simplificado y un aviso, solo alfabetos latinos. Sin .doc', '.docx com layout simplificado e um aviso, só alfabetos latinos. Sem .doc'],
    }),
    row('keynote', 'content', ['Keynote', 'Keynote', 'Keynote'], 'missing'),
    row('excel', 'content', ['Excel and spreadsheets in a viewer', 'Excel y planillas en un visor', 'Excel e planilhas em um visor'], 'missing'),
    row('video', 'content', ['Video', 'Video', 'Vídeo'], 'partial', {
      weight: 2,
      detail: ['MP4, WebM and MOV up to 1 GB against their 2 GB, played as uploaded with no transcoding', 'MP4, WebM y MOV hasta 1 GB contra sus 2 GB, se reproduce como se subió, sin transcodificar', 'MP4, WebM e MOV até 1 GB contra 2 GB deles, reproduzido como enviado, sem transcodificação'],
    }),
    row('audio', 'content', ['Audio', 'Audio', 'Áudio'], 'missing'),
    row('download-only', 'content', ['Download-only files', 'Archivos solo para descargar', 'Arquivos só para download'], 'missing'),
    row('external-url', 'content', ['Share external URLs', 'Compartir URLs externas', 'Compartilhar URLs externas'], 'missing'),
    row('zip', 'content', ['Upload and extract a ZIP', 'Subir y extraer un ZIP', 'Enviar e extrair um ZIP'], 'missing'),
    row('cloud-sources', 'content', ['Upload from Drive, Dropbox and others', 'Subir desde Drive, Dropbox y otros', 'Enviar do Drive, Dropbox e outros'], 'missing'),
    row('password-pdf', 'content', ['PDFs with a password', 'PDF con contraseña', 'PDF com senha'], 'missing', {
      detail: ['Rejected with a message; the link can have its own passcode', 'Se rechazan con un mensaje; el link puede tener su propio código', 'Rejeitados com uma mensagem; o link pode ter seu próprio código'],
    }),
    row('folders', 'content', ['Content folders', 'Carpetas de contenido', 'Pastas de conteúdo'], 'missing'),
    row('in-doc-links', 'content', ['Clickable links inside a document', 'Links clicables dentro de un documento', 'Links clicáveis dentro de um documento'], 'missing', {
      detail: ['Pages are images, so links in a PDF don\'t click yet', 'Las páginas son imágenes: los links de un PDF todavía no se pueden tocar', 'As páginas são imagens: os links de um PDF ainda não podem ser clicados'],
    }),
    row('in-doc-media', 'content', ['Videos and GIFs inside a document', 'Videos y GIF dentro de un documento', 'Vídeos e GIFs dentro de um documento'], 'missing'),
    row('internal-notes', 'content', ['Internal notes on a document', 'Notas internas en un documento', 'Notas internas em um documento'], 'missing'),
    row('in-doc-feedback', 'content', ['Feedback inside a document', 'Comentarios dentro de un documento', 'Comentários dentro de um documento'], 'missing'),
    row('recommendations', 'content', ['Content recommendations', 'Recomendaciones de contenido', 'Recomendações de conteúdo'], 'missing'),
    row('docs-source', 'content', ['Share a Docs page', 'Compartir una página de Docs', 'Compartilhar uma página do Docs'], 'have', {
      competitorHas: false,
      detail: ['A copy as a PDF, with the same permissions as Docs; Latin alphabets only', 'Una copia en PDF, con los permisos de Docs; solo alfabetos latinos', 'Uma cópia em PDF, com as permissões do Docs; só alfabetos latinos'],
    }),

    // Links
    row('many-links', 'links', ['Many links per document, each with a name', 'Muchos links por documento, cada uno con nombre', 'Vários links por documento, cada um com nome'], 'have', { weight: 2 }),
    row('recipient', 'links', ['A link per recipient', 'Un link por destinatario', 'Um link por destinatário'], 'have', {
      detail: ['Optional recipient email, used to spot a forward', 'Email de destinatario opcional, para notar un reenvío', 'Email de destinatário opcional, para notar um encaminhamento'],
    }),
    row('edit-link', 'links', ['Change a link\'s rules later', 'Cambiar las reglas de un link', 'Alterar as regras de um link'], 'have', {
      detail: ['Changing an access rule makes people pass again', 'Cambiar una regla de acceso hace pasar de nuevo a quien ya entró', 'Alterar uma regra de acesso faz quem já entrou passar de novo'],
    }),
    row('disable-link', 'links', ['Disable a link', 'Deshabilitar un link', 'Desabilitar um link'], 'have', {
      weight: 2,
      detail: ['Denies the next request, images and video included. No shared cache', 'Corta el pedido siguiente, imágenes y video incluidos. Sin caché compartido', 'Bloqueia o pedido seguinte, imagens e vídeo incluídos. Sem cache compartilhado'],
    }),
    row('delete-link', 'links', ['Delete a link', 'Borrar un link', 'Excluir um link'], 'have'),
    row('welcome-message', 'links', ['Welcome message', 'Mensaje de bienvenida', 'Mensagem de boas-vindas'], 'have'),
    row('custom-url', 'links', ['Custom link URL', 'URL propia del link', 'URL própria do link'], 'missing', {
      detail: ['Links are random on purpose; DocSend warns custom ones are easier to guess', 'Los links son al azar a propósito; DocSend avisa que los propios se adivinan más fácil', 'Os links são aleatórios de propósito; o DocSend avisa que os próprios são mais fáceis de adivinhar'],
    }),
    row('custom-button', 'links', ['Custom button in the viewer', 'Botón propio en el visor', 'Botão próprio no visor'], 'missing'),
    row('embed', 'links', ['Embed a link on a website', 'Incrustar un link en un sitio', 'Incorporar um link em um site'], 'missing'),
    row('contact-card', 'links', ['Contact card and contact the owner', 'Tarjeta de contacto y contactar al dueño', 'Cartão de contato e contatar o dono'], 'missing'),
    row('view-as-visitor', 'links', ['See it as a visitor', 'Verlo como visitante', 'Ver como visitante'], 'partial', {
      detail: ['A preview of the pages; to see the gates, open the link in a private window', 'Una vista previa de las páginas; para ver los pasos, abrí el link en una ventana privada', 'Uma prévia das páginas; para ver as etapas, abra o link em uma janela privada'],
    }),
    row('campaign-links', 'links', ['Campaign links', 'Links de campaña', 'Links de campanha'], 'partial', {
      detail: ['A named link per campaign; no contact variables', 'Un link con nombre por campaña; sin variables de contacto', 'Um link com nome por campanha; sem variáveis de contato'],
    }),
    row('mail-merge', 'links', ['Mail merge links', 'Links para combinación de correspondencia', 'Links para mala direta'], 'missing'),
    row('internal-links', 'links', ['Internal links for the team', 'Links internos para el equipo', 'Links internos para a equipe'], 'missing'),

    // Acceso
    row('require-email', 'access', ['Require an email', 'Pedir un email', 'Pedir um email'], 'have', {
      weight: 2,
      detail: ['Shown as not verified: a typed email is declared, not proven', 'Se muestra sin verificar: un email escrito es declarado, no probado', 'Aparece como não verificado: um email digitado é declarado, não comprovado'],
    }),
    row('verify-email', 'access', ['Verify the email', 'Verificar el email', 'Verificar o email'], 'have', {
      weight: 2,
      detail: ['6-digit code, 15 minutes, same browser; 5 attempts. Sent through the workspace\'s email provider', 'Código de 6 dígitos, 15 minutos, mismo navegador; 5 intentos. Sale por el proveedor de email', 'Código de 6 dígitos, 15 minutos, mesmo navegador; 5 tentativas. Sai pelo provedor de email'],
    }),
    row('passcode', 'access', ['Passcode', 'Código de acceso', 'Código de acesso'], 'have', {
      weight: 2,
      detail: ['Hashed, with limits per person and per link', 'Con hash, y con topes por persona y por link', 'Com hash, e com limites por pessoa e por link'],
    }),
    row('expiry', 'access', ['Expiry date', 'Fecha de vencimiento', 'Data de vencimento'], 'have', { weight: 2 }),
    row('allow-block', 'access', ['Allow or block emails and domains', 'Permitir o bloquear emails y dominios', 'Permitir ou bloquear emails e domínios'], 'have', {
      detail: ['500 entries per link. An allow list needs verification by code, which DocSend only recommends', '500 entradas por link. Una lista de permitidos exige verificación por código, que DocSend solo recomienda', '500 entradas por link. Uma lista de permitidos exige verificação por código, que o DocSend só recomenda'],
    }),
    row('allow-block-csv', 'access', ['Import the list from a CSV', 'Importar la lista de un CSV', 'Importar a lista de um CSV'], 'missing', {
      detail: ['Pasting works, with one entry per line or separated by commas', 'Se puede pegar, una entrada por línea o separadas por comas', 'Dá para colar, uma entrada por linha ou separadas por vírgula'],
    }),
    row('download-toggle', 'access', ['Allow or block download', 'Permitir o bloquear descarga', 'Permitir ou bloquear download'], 'have', {
      weight: 2,
      detail: ['Without it, the file never reaches the browser, only page images', 'Sin ella, el archivo no llega al navegador, solo imágenes de las páginas', 'Sem ela, o arquivo nunca chega ao navegador, só imagens das páginas'],
    }),
    row('watermark', 'access', ['Dynamic watermark', 'Watermark dinámico', 'Marca d\'água dinâmica'], 'partial', {
      weight: 2,
      detail: ['Email, date and time, drawn on the server on every page and in downloads. No custom text, IP, position, color or transparency, and only over the player on video', 'Email, fecha y hora, dibujados en el servidor en cada página y en las descargas. Sin texto libre, IP, posición, color ni transparencia, y en video solo sobre el reproductor', 'Email, data e hora, desenhados no servidor em cada página e nos downloads. Sem texto livre, IP, posição, cor nem transparência, e em vídeo só sobre o player'],
    }),
    row('watermark-default', 'access', ['Default watermark for the account', 'Watermark por defecto de la cuenta', 'Marca d\'água padrão da conta'], 'missing'),
    row('screenshot-protection', 'access', ['Screenshot protection', 'Protección contra capturas', 'Proteção contra prints'], 'missing', {
      detail: ['A web page can\'t stop a screenshot, and we say so where it matters', 'Una página web no puede frenar una captura, y lo decimos donde importa', 'Uma página web não pode impedir um print, e dizemos isso onde importa'],
    }),
    row('atypical-visits', 'access', ['Alert on atypical sources', 'Aviso de fuentes atípicas', 'Aviso de fontes atípicas'], 'missing'),
    row('bot-filter', 'access', ['Bots and previews don\'t count', 'Bots y vistas previas no cuentan', 'Bots e prévias não contam'], 'have', {
      competitorHas: false,
      detail: ['A visit needs a few seconds of reading with a visible tab; known bots and automated browsers are left out', 'Una visita pide unos segundos de lectura con la pestaña visible; quedan afuera los bots conocidos y los navegadores automatizados', 'Uma visita pede alguns segundos de leitura com a aba visível; ficam de fora bots conhecidos e navegadores automatizados'],
    }),

    // Visor
    row('no-account', 'viewer', ['View without an account', 'Ver sin cuenta', 'Ver sem conta'], 'have', { weight: 2 }),
    row('mobile', 'viewer', ['Works on a phone', 'Funciona en el teléfono', 'Funciona no celular'], 'have', { weight: 2 }),
    row('viewer-tools', 'viewer', ['Jump to a page, full screen, zoom', 'Saltar a una página, pantalla completa, zoom', 'Pular para uma página, tela cheia, zoom'], 'partial', {
      detail: ['Previous and next, keys and full screen. Zoom is the browser\'s', 'Anterior y siguiente, teclado y pantalla completa. El zoom es el del navegador', 'Anterior e próxima, teclado e tela cheia. O zoom é o do navegador'],
    }),
    row('video-player', 'viewer', ['Video player', 'Reproductor de video', 'Player de vídeo'], 'partial', {
      detail: ['The browser\'s, with its speed and keys', 'El del navegador, con su velocidad y su teclado', 'O do navegador, com sua velocidade e teclado'],
    }),
    row('video-rules', 'viewer', ['Block seeking, speed changes, pause in background', 'Bloquear saltos y velocidad, pausar en segundo plano', 'Bloquear saltos e velocidade, pausar em segundo plano'], 'missing'),

    // Números
    row('who-opened', 'analytics', ['Who opened it and when', 'Quién lo abrió y cuándo', 'Quem abriu e quando'], 'have', { weight: 2 }),
    row('time-per-page', 'analytics', ['Time per page per visit', 'Tiempo por página de cada visita', 'Tempo por página de cada visita'], 'have', {
      weight: 2,
      detail: ['From the reader\'s browser. Pauses with a hidden tab and, unlike DocSend, after 2 minutes idle', 'Desde el navegador de quien lee. Frena con la pestaña oculta y, a diferencia de DocSend, tras 2 minutos sin actividad', 'Do navegador de quem lê. Para com a aba oculta e, ao contrário do DocSend, após 2 minutos sem atividade'],
    }),
    row('completion', 'analytics', ['Percentage viewed', 'Porcentaje visto', 'Percentual visto'], 'have', { weight: 2 }),
    row('dropoff', 'analytics', ['Average time per page and drop-off', 'Tiempo promedio por página y abandono', 'Tempo médio por página e abandono'], 'have', { weight: 2 }),
    row('return-visits', 'analytics', ['Return visits', 'Visitas de vuelta', 'Visitas de volta'], 'have'),
    row('device', 'analytics', ['Device, system and browser', 'Dispositivo, sistema y navegador', 'Dispositivo, sistema e navegador'], 'have'),
    row('location', 'analytics', ['Location', 'Ubicación', 'Localização'], 'partial', {
      detail: ['City and country from the IP, approximate, with no map', 'Ciudad y país por IP, aproximados, sin mapa', 'Cidade e país pelo IP, aproximados, sem mapa'],
    }),
    row('per-link', 'analytics', ['Numbers per link', 'Números por link', 'Números por link'], 'have'),
    row('forwarded', 'analytics', ['Forwards through the email gate', 'Reenvíos por el pedido de email', 'Encaminhamentos pelo pedido de email'], 'have', {
      detail: ['Another email on a recipient\'s link is marked as possibly forwarded. It\'s a hint, not proof', 'Otro email en el link de un destinatario se marca como posible reenvío. Es un indicio, no una prueba', 'Outro email no link de um destinatário é marcado como possível encaminhamento. É um indício, não uma prova'],
    }),
    row('video-analytics', 'analytics', ['Video analytics', 'Números de video', 'Números de vídeo'], 'partial', {
      detail: ['Time per stretch of the video and % watched. No engagement score', 'Tiempo por tramo del video y % visto. Sin puntaje de atención', 'Tempo por trecho do vídeo e % visto. Sem pontuação de atenção'],
    }),
    row('csv-export', 'analytics', ['Export visits as CSV', 'Exportar visitas a CSV', 'Exportar visitas em CSV'], 'have', {
      detail: ['Admins only, with the seconds per page and the version of each visit', 'Solo admins, con los segundos por página y la versión de cada visita', 'Só admins, com os segundos por página e a versão de cada visita'],
    }),
    row('link-clicks', 'analytics', ['Clicks on links inside the document', 'Clics en links del documento', 'Cliques em links do documento'], 'missing'),
    row('visit-map', 'analytics', ['Visit map', 'Mapa de visitas', 'Mapa de visitas'], 'missing'),
    row('contacts-page', 'analytics', ['A page per contact, across documents', 'Una página por contacto, entre documentos', 'Uma página por contato, entre documentos'], 'missing', {
      detail: ['Visitors are listed per document and per space; with a matching CRM contact, the visits land on its timeline', 'Las personas se listan por documento y por espacio; con un contacto del CRM, las visitas llegan a su línea de tiempo', 'As pessoas são listadas por documento e por espaço; com um contato do CRM, as visitas chegam à linha do tempo'],
    }),
    row('enrichment', 'analytics', ['Enrich contacts with public data', 'Completar contactos con datos públicos', 'Completar contatos com dados públicos'], 'missing'),
    row('accounts', 'analytics', ['Accounts and company visits', 'Cuentas y visitas de empresa', 'Contas e visitas de empresa'], 'missing'),
    row('dashboard', 'analytics', ['Dashboard across all content', 'Tablero de todo el contenido', 'Painel de todo o conteúdo'], 'partial', {
      detail: ['The document list shows visits, last visit and who is reading now', 'La lista de documentos muestra visitas, última visita y quién lee ahora', 'A lista de documentos mostra visitas, última visita e quem está lendo agora'],
    }),

    // Avisos
    row('email-alert', 'alerts', ['Email when someone opens it', 'Email cuando alguien lo abre', 'Email quando alguém abre'], 'partial', {
      weight: 2,
      detail: ['Sent when a real visit starts, at most once per half hour per session. With no email provider set up it isn\'t delivered', 'Sale cuando empieza una visita real, como mucho una vez por media hora por sesión. Sin proveedor de email configurado no llega', 'Sai quando começa uma visita real, no máximo uma vez a cada meia hora por sessão. Sem provedor de email configurado não chega'],
    }),
    row('in-app-alert', 'alerts', ['Live "someone is reading" alert', 'Aviso en vivo de "alguien está leyendo"', 'Aviso ao vivo de "alguém está lendo"'], 'have', {
      detail: ['In the notification bell and on the document page. DocSend\'s are desktop notifications', 'En la campana de avisos y en la página del documento. Los de DocSend son notificaciones de escritorio', 'No sino de avisos e na página do documento. Os do DocSend são notificações de desktop'],
    }),
    row('unauthorized-alert', 'alerts', ['Alert on an unauthorized email', 'Aviso de un email no autorizado', 'Aviso de um email não autorizado'], 'partial', {
      detail: ['In the bell and in the activity list; no email yet, and no one-click grant', 'En la campana y en la actividad; todavía sin email ni permiso en un clic', 'No sino e na atividade; ainda sem email nem permissão em um clique'],
    }),
    row('disabled-alert', 'alerts', ['Alert when a disabled link is opened', 'Aviso al abrir un link deshabilitado', 'Aviso ao abrir um link desabilitado'], 'missing'),
    row('digests', 'alerts', ['Daily and weekly digests', 'Resúmenes diarios y semanales', 'Resumos diários e semanais'], 'missing'),
    row('notify-team', 'alerts', ['Notify teammates of a visit', 'Avisar a compañeros de una visita', 'Avisar colegas de uma visita'], 'partial', {
      detail: ['The document owner and the person who made the link', 'El dueño del documento y quien armó el link', 'O dono do documento e quem criou o link'],
    }),

    // Versiones
    row('replace-file', 'versions', ['Replace a file, keep its links', 'Reemplazar un archivo sin tocar los links', 'Substituir um arquivo mantendo os links'], 'have', {
      weight: 2,
      detail: ['Links switch when the new file is ready. The type can change', 'Los links cambian cuando el archivo nuevo está listo. El tipo puede cambiar', 'Os links mudam quando o arquivo novo está pronto. O tipo pode mudar'],
    }),
    row('version-analytics', 'versions', ['Numbers per version', 'Números por versión', 'Números por versão'], 'have', { weight: 2 }),
    row('cloud-refresh', 'versions', ['Refresh from Dropbox or Drive', 'Actualizar desde Dropbox o Drive', 'Atualizar do Dropbox ou Drive'], 'missing'),

    // Espacios
    row('space-create', 'spaces', ['Several documents behind one link', 'Varios documentos detrás de un link', 'Vários documentos atrás de um link'], 'have', { weight: 2 }),
    row('space-analytics', 'spaces', ['Numbers per document and per visitor', 'Números por documento y por persona', 'Números por documento e por pessoa'], 'have', { weight: 2 }),
    row('space-access', 'spaces', ['Access per person', 'Acceso por persona', 'Acesso por pessoa'], 'have', {
      detail: ['By email: pick which documents a person sees. Works with verification on', 'Por email: elegí qué documentos ve cada persona. Sirve con la verificación prendida', 'Por email: escolha quais documentos cada pessoa vê. Funciona com a verificação ligada'],
    }),
    row('space-csv', 'spaces', ['Export the space\'s visits', 'Exportar las visitas del espacio', 'Exportar as visitas do espaço'], 'have'),
    row('space-folders', 'spaces', ['Folders', 'Carpetas', 'Pastas'], 'partial', {
      detail: ['One level, as a label on each document. 2,000 documents, no per-folder permissions', 'Un nivel, como etiqueta de cada documento. 2.000 documentos, sin permisos por carpeta', 'Um nível, como rótulo de cada documento. 2.000 documentos, sem permissões por pasta'],
    }),
    row('space-customize', 'spaces', ['Title, subtitle and header image', 'Título, subtítulo e imagen de cabecera', 'Título, subtítulo e imagem de cabeçalho'], 'partial', {
      detail: ['Title, description and the workspace brand; no header image', 'Título, descripción y marca del workspace; sin imagen de cabecera', 'Título, descrição e marca do workspace; sem imagem de cabeçalho'],
    }),
    row('space-collaborators', 'spaces', ['Collaborators on a space', 'Colaboradores en un espacio', 'Colaboradores em um espaço'], 'partial', {
      detail: ['Owner and admins; others can\'t be added one by one', 'Dueño y admins; no se pueden sumar personas de a una', 'Dono e admins; não dá para adicionar pessoas uma a uma'],
    }),
    row('space-granular', 'spaces', ['Granular per link: visible, downloadable', 'Permisos por link: visible, descargable', 'Permissões por link: visível, baixável'], 'missing'),
    row('space-groups', 'spaces', ['Visitor groups with email invites', 'Grupos de visitantes con invitación por email', 'Grupos de visitantes com convite por email'], 'missing'),
    row('space-index', 'spaces', ['Numbered index', 'Índice numerado', 'Índice numerado'], 'missing'),
    row('space-audit', 'spaces', ['Audit log', 'Registro de auditoría', 'Registro de auditoria'], 'missing'),
    row('space-qa', 'spaces', ['Questions and answers', 'Preguntas y respuestas', 'Perguntas e respostas'], 'missing'),
    row('space-diligence', 'spaces', ['Diligence tracker', 'Seguimiento de due diligence', 'Acompanhamento de due diligence'], 'missing'),
    row('space-duplicate', 'spaces', ['Duplicate and templates', 'Duplicar y plantillas', 'Duplicar e modelos'], 'missing'),
    row('space-notify', 'spaces', ['Notify a space\'s visitors', 'Avisar a los visitantes del espacio', 'Avisar os visitantes do espaço'], 'missing'),
    row('space-tags', 'spaces', ['Tags on spaces', 'Etiquetas en los espacios', 'Etiquetas nos espaços'], 'missing'),
    row('file-requests', 'spaces', ['File requests', 'Pedidos de archivos', 'Pedidos de arquivos'], 'missing'),
    row('ai-organize', 'spaces', ['Organize a space with AI', 'Ordenar un espacio con IA', 'Organizar um espaço com IA'], 'missing'),

    // Acuerdos
    row('nda-gate', 'agreements', ['Signed NDA before viewing', 'NDA firmado antes de ver', 'NDA assinado antes de ver'], 'partial', {
      weight: 2,
      detail: ['Through a Sign template with one signer: each person signs a copy. Not per folder, and no one-click agreement', 'Con una plantilla de Sign con un firmante: cada persona firma su copia. Sin acuerdo por carpeta ni de un clic', 'Com um modelo do Sign com um signatário: cada pessoa assina sua cópia. Sem acordo por pasta nem de um clique'],
    }),
    row('one-click-nda', 'agreements', ['One-click agreement', 'Acuerdo de un clic', 'Acordo de um clique'], 'missing'),
    row('certificate', 'agreements', ['Certificate and audit trail', 'Certificado y auditoría', 'Certificado e auditoria'], 'have', {
      detail: ['Sign\'s certificate of completion', 'El certificado de finalización de Sign', 'O certificado de conclusão do Sign'],
    }),
    row('signable-docs', 'agreements', ['Signable documents', 'Documentos firmables', 'Documentos assináveis'], 'have', {
      detail: ['In the Sign app, with more field types and several signers', 'En la app Sign, con más tipos de campo y varios firmantes', 'No app Sign, com mais tipos de campo e vários signatários'],
    }),
    row('nda-badge', 'agreements', ['See who signed from the visit', 'Ver quién firmó desde la visita', 'Ver quem assinou a partir da visita'], 'missing'),

    // Marca
    row('brand-logo-color', 'branding', ['Logo, color and website link', 'Logo, color y link al sitio', 'Logo, cor e link para o site'], 'have', {
      detail: ['The logo goes by URL, with no upload yet', 'El logo va por URL, todavía sin subida', 'O logo vai por URL, ainda sem upload'],
    }),
    row('brand-per-link', 'branding', ['Turn the brand off per link', 'Apagar la marca por link', 'Desligar a marca por link'], 'have', { competitorHas: false }),
    row('subdomain', 'branding', ['Custom subdomain', 'Subdominio propio', 'Subdomínio próprio'], 'missing'),

    // Plataforma
    row('roles', 'platform', ['Roles', 'Roles', 'Papéis'], 'have', {
      detail: ['Workspace roles and access per app. A member sees theirs and what\'s shared', 'Roles del workspace y acceso por app. Un member ve lo suyo y lo compartido', 'Papéis do workspace e acesso por app. Um member vê o seu e o compartilhado'],
    }),
    row('crm-timeline', 'platform', ['Visits on the CRM contact', 'Visitas en el contacto del CRM', 'Visitas no contato do CRM'], 'have', {
      detail: ['With zerosoft\'s CRM, when the email matches. DocSend does it with Salesforce', 'Con el CRM de zerosoft, cuando el email coincide. DocSend lo hace con Salesforce', 'Com o CRM da zerosoft, quando o email coincide. O DocSend faz isso com o Salesforce'],
    }),
    row('salesforce', 'platform', ['Salesforce', 'Salesforce', 'Salesforce'], 'missing'),
    row('zapier', 'platform', ['Zapier and IFTTT', 'Zapier e IFTTT', 'Zapier e IFTTT'], 'missing'),
    row('browser-email-addins', 'platform', ['Chrome, Gmail and Outlook add-ins', 'Complementos de Chrome, Gmail y Outlook', 'Complementos de Chrome, Gmail e Outlook'], 'missing'),
    row('mcp', 'platform', ['MCP server', 'Servidor MCP', 'Servidor MCP'], 'partial', {
      detail: ['Reads documents, versions and numbers. Making or loosening a link stays on the web', 'Lee documentos, versiones y números. Crear o aflojar un link queda en la web', 'Lê documentos, versões e números. Criar ou afrouxar um link fica na web'],
    }),
    row('subteams', 'platform', ['Sub-teams and folder access', 'Subequipos y acceso por carpeta', 'Subequipes e acesso por pasta'], 'missing'),
    row('transfer', 'platform', ['Transfer someone\'s content', 'Transferir el contenido de alguien', 'Transferir o conteúdo de alguém'], 'missing'),
    row('self-host', 'platform', ['Run it on your own server', 'Correrlo en tu servidor', 'Rodar no seu servidor'], 'have', { competitorHas: false }),
  ],
};

export default parity;
