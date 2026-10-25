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
 * Rec contra Loom. Fuente: docs/benchmark/rec.md (2026-10-25). Primera
 * versión (tanda 4c): grabador en el navegador, subida por partes, página
 * pública, comentarios, analítica, transcripción e IA. Lo que depende de un
 * proveedor (transcripción) lo dice en `detail`. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Loom',
  lastReviewed: '2026-10-25',
  areas: [
    { id: 'capture', label: loc(['Recording', 'Grabación', 'Gravação']) },
    { id: 'recorder', label: loc(['Recording tools', 'Herramientas al grabar', 'Ferramentas de gravação']) },
    { id: 'editing', label: loc(['Editing', 'Edición', 'Edição']) },
    { id: 'sharing', label: loc(['Sharing', 'Compartir', 'Compartilhamento']) },
    { id: 'privacy', label: loc(['Privacy', 'Privacidad', 'Privacidade']) },
    { id: 'engagement', label: loc(['Comments and reactions', 'Comentarios y reacciones', 'Comentários e reações']) },
    { id: 'analytics', label: loc(['Analytics', 'Analítica', 'Análises']) },
    { id: 'ai', label: loc(['AI', 'IA', 'IA']) },
    { id: 'library', label: loc(['Library and spaces', 'Biblioteca y espacios', 'Biblioteca e espaços']) },
    { id: 'integrations', label: loc(['Integrations', 'Integraciones', 'Integrações']) },
    { id: 'admin', label: loc(['Admin and security', 'Administración y seguridad', 'Administração e segurança']) },
  ],
  rows: [
    // Grabación
    row('screen-camera-record', 'capture', ['Record screen and camera together', 'Grabar pantalla y cámara a la vez', 'Gravar tela e câmera juntas'], 'have', {
      weight: 2,
      detail: [
        'Screen and camera, screen only or camera only, from the browser. The camera bubble is drawn into the video and you drag it, resize it or move it with the keyboard',
        'Pantalla y cámara, solo pantalla o solo cámara, desde el navegador. La burbuja se dibuja en el video y se arrastra, se agranda o se mueve con el teclado',
        'Tela e câmera, só tela ou só câmera, pelo navegador. A bolha é desenhada no vídeo e se arrasta, aumenta ou move com o teclado',
      ],
    }),
    row('capture-source', 'capture', ['Pick full screen, window or tab', 'Elegir pantalla completa, ventana o pestaña', 'Escolher tela inteira, janela ou aba'], 'have', {
      weight: 2,
      detail: [
        'The browser picker: full screen, a window or a tab',
        'El selector del navegador: pantalla completa, una ventana o una pestaña',
        'O seletor do navegador: tela inteira, uma janela ou uma aba',
      ],
    }),
    row('browser-extension', 'capture', ['Chrome extension', 'Extensión de Chrome', 'Extensão do Chrome'], 'missing'),
    row('desktop-app', 'capture', ['Desktop app', 'App de escritorio', 'App desktop'], 'missing', {
      detail: ['Mac and Windows, records over any app', 'Mac y Windows, graba sobre cualquier app', 'Mac e Windows, grava sobre qualquer app'],
    }),
    row('mobile-app', 'capture', ['Mobile app', 'App móvil', 'App mobile'], 'missing', {
      detail: [
        'iOS and Android: screen, camera or audio only',
        'iOS y Android: pantalla, cámara o solo audio',
        'iOS e Android: tela, câmera ou só áudio',
      ],
    }),
    row('audio-capture', 'capture', ['Microphone, system audio and noise suppression', 'Micrófono, audio del sistema y supresión de ruido', 'Microfone, áudio do sistema e supressão de ruído'], 'partial', {
      weight: 2,
      detail: [
        'Microphone with device picker, the browser noise suppression and a level meter. Tab audio in Chrome and system audio only where the browser shares it (Windows and ChromeOS): no Mac system audio without a desktop app',
        'Micrófono con selector, la supresión de ruido del navegador y medidor de nivel. Audio de la pestaña en Chrome y del sistema solo donde el navegador lo comparte (Windows y ChromeOS): sin app de escritorio no hay audio del sistema en Mac',
        'Microfone com seletor, a supressão de ruído do navegador e medidor de nível. Áudio da aba no Chrome e do sistema só onde o navegador compartilha (Windows e ChromeOS): sem app desktop não há áudio do sistema no Mac',
      ],
    }),
    row('pause-rewind', 'capture', ['Pause, resume and rewind while recording', 'Pausar, retomar y volver atrás mientras se graba', 'Pausar, retomar e voltar enquanto grava'], 'partial', {
      detail: [
        'Pause and resume with a 3 second countdown before starting. No Live Rewind',
        'Pausar y seguir, con cuenta regresiva de 3 segundos al empezar. Sin Live Rewind',
        'Pausar e continuar, com contagem de 3 segundos ao começar. Sem Live Rewind',
      ],
    }),
    row('meeting-recording', 'capture', ['Record meetings', 'Grabar reuniones', 'Gravar reuniões'], 'missing'),

    // Herramientas al grabar
    row('recording-quality', 'recorder', ['Up to 4K quality', 'Calidad hasta 4K', 'Qualidade até 4K'], 'have', {
      detail: [
        '720p, 1080p or 4K, capped by the source (your screen or camera)',
        '720p, 1080p o 4K, con el tope de la fuente (tu pantalla o tu cámara)',
        '720p, 1080p ou 4K, limitado pela fonte (sua tela ou sua câmera)',
      ],
    }),
    row('camera-effects', 'recorder', ['Virtual backgrounds, camera frames and blur', 'Fondos virtuales, marcos de cámara y desenfoque', 'Fundos virtuais, molduras de câmera e desfoque'], 'missing'),
    row('drawing-tool', 'recorder', ['Draw on screen and highlight the mouse', 'Dibujar en pantalla y resaltar el mouse', 'Desenhar na tela e destacar o mouse'], 'missing'),

    // Edición
    row('trim-stitch', 'editing', ['Trim and stitch videos', 'Recortar y unir videos', 'Cortar e unir vídeos'], 'partial', {
      weight: 2,
      detail: [
        'Trim the start and the end. In WebM recordings everyone else gets a copy cut without re-encoding (from the keyframe before the start: up to about 2 s before it stay in that file, hidden by the player); thumbnail, GIF and captions are rebuilt for the trim. MP4 and MOV uploads are only trimmed in the player. No joining clips',
        'Recortar el principio y el final. En las grabaciones WebM los demás reciben una copia cortada sin recodificar (desde el keyframe anterior al inicio: hasta unos 2 s antes quedan en ese archivo, ocultos por el reproductor); miniatura, GIF y subtítulos se rearman para el recorte. En MP4 y MOV subidos solo se recorta en el reproductor. Sin unir clips',
        'Cortar o começo e o fim. Nas gravações WebM os outros recebem uma cópia cortada sem recodificar (desde o keyframe anterior ao começo: até uns 2 s antes ficam nesse arquivo, ocultos pelo player); miniatura, GIF e legendas são refeitos para o corte. Em MP4 e MOV enviados só corta no player. Sem juntar clipes',
      ],
    }),
    row('edit-by-transcript', 'editing', ['Edit from the transcript', 'Editar desde la transcripción', 'Editar pela transcrição'], 'missing', {
      detail: ['Deleting text cuts the video', 'Borrar texto corta el video', 'Apagar texto corta o vídeo'],
    }),
    row('filler-silence-removal', 'editing', ['Remove filler words and silences with AI', 'Quitar muletillas y silencios con IA', 'Remover vícios de linguagem e silêncios com IA'], 'missing'),
    row('custom-thumbnail', 'editing', ['Custom and GIF thumbnails', 'Miniatura propia y GIF', 'Miniatura própria e GIF'], 'have', {
      detail: [
        'A GIF of the first seconds and a thumbnail are made while recording; any frame can be the thumbnail',
        'Un GIF de los primeros segundos y una miniatura se arman al grabar; cualquier cuadro puede ser la miniatura',
        'Um GIF dos primeiros segundos e uma miniatura são feitos ao gravar; qualquer quadro pode ser a miniatura',
      ],
    }),
    row('overlays', 'editing', ['Text, box and arrow overlays', 'Textos, cajas y flechas sobre el video', 'Textos, caixas e setas sobre o vídeo'], 'missing'),
    row('upload-download', 'editing', ['Upload and download videos', 'Subir y descargar videos', 'Enviar e baixar vídeos'], 'have', {
      detail: [
        'Upload a WebM, MP4 or MOV file and download the original',
        'Subir un archivo WebM, MP4 o MOV y descargar el original',
        'Enviar um arquivo WebM, MP4 ou MOV e baixar o original',
      ],
    }),

    // Compartir
    row('instant-link', 'sharing', ['Share link ready when you stop', 'Link listo al terminar de grabar', 'Link pronto ao parar a gravação'], 'have', {
      weight: 2,
      detail: [
        'It uploads in parts while you record and the link is copied when you stop. Each part is kept in the browser until the server has it: if the connection drops it keeps recording, retries by itself and the upload can be resumed or downloaded after a reload',
        'Se sube por partes mientras grabás y el link se copia al cortar. Cada parte queda en el navegador hasta que el servidor la tiene: si se corta la red sigue grabando, reintenta solo y después de recargar se puede retomar o descargar',
        'É enviado em partes enquanto você grava e o link é copiado ao parar. Cada parte fica no navegador até o servidor recebê-la: se a rede cair continua gravando, tenta de novo sozinho e depois de recarregar dá para retomar ou baixar',
      ],
    }),
    row('watch-page', 'sharing', ['Video page with player and transcript', 'Página del video con reproductor y transcripción', 'Página do vídeo com player e transcrição'], 'have', {
      weight: 2,
      detail: [
        '/v/<id>: player with speed, captions, chapters and keyboard shortcuts, summary, transcript and comments',
        '/v/<id>: reproductor con velocidad, subtítulos, capítulos y atajos de teclado, resumen, transcripción y comentarios',
        '/v/<id>: player com velocidade, legendas, capítulos e atalhos de teclado, resumo, transcrição e comentários',
      ],
    }),
    row('embed-player', 'sharing', ['Embed the player in other sites', 'Insertar el reproductor en otros sitios', 'Incorporar o player em outros sites'], 'have', {
      detail: [
        'Copy an iframe code for /v/<id>/embed; it works in any page that accepts iframes',
        'Copiás un código iframe de /v/<id>/embed; anda en cualquier página que acepte iframes',
        'Você copia um código iframe de /v/<id>/embed; funciona em qualquer página que aceite iframes',
      ],
    }),
    row('cta-button', 'sharing', ['Call to action button', 'Botón de llamada a la acción', 'Botão de chamada para ação'], 'have', {
      detail: [
        'Web links only (no email, phone or IP), during the whole video or only at the end, with click counts',
        'Solo links web (sin email, teléfono ni IP), durante todo el video o solo al final, con conteo de clics',
        'Só links web (sem email, telefone ou IP), durante o vídeo todo ou só no final, com contagem de cliques',
      ],
    }),
    row('custom-branding', 'sharing', ['Your logo and colors, no Loom branding', 'Logo y colores propios, sin la marca de Loom', 'Logo e cores próprios, sem a marca do Loom'], 'missing'),

    // Privacidad
    row('privacy-levels', 'privacy', ['Who can watch: link, workspace or specific people', 'Quién lo ve: link, workspace o personas puntuales', 'Quem assiste: link, workspace ou pessoas específicas'], 'partial', {
      weight: 2,
      detail: [
        'Anyone with the link or only signed-in members of the workspace. Not specific people yet, and no workspace default',
        'Cualquiera con el link o solo miembros del workspace con sesión. Todavía no personas puntuales ni privacidad por defecto del workspace',
        'Qualquer pessoa com o link ou só membros do workspace com sessão. Ainda não pessoas específicas nem privacidade padrão do workspace',
      ],
    }),
    row('password-protect', 'privacy', ['Password-protected videos', 'Videos con contraseña', 'Vídeos com senha'], 'have', {
      detail: [
        'The video, thumbnail, GIF and captions are only served through our routes after checking the password, expiry and workspace. With REC_BLOB_ACCESS=private the Blob store is private; with a public store the file path is random and never shown',
        'El video, la miniatura, el GIF y los subtítulos solo salen por nuestras rutas después de chequear contraseña, vencimiento y workspace. Con REC_BLOB_ACCESS=private el store de Blob es privado; con uno público el path del archivo es al azar y nunca se muestra',
        'O vídeo, a miniatura, o GIF e as legendas só saem pelas nossas rotas depois de checar senha, expiração e workspace. Com REC_BLOB_ACCESS=private o store do Blob é privado; com um público o path do arquivo é aleatório e nunca aparece',
      ],
    }),
    row('request-access', 'privacy', ['Request access or ask for an email to watch', 'Pedir acceso o pedir email para ver', 'Pedir acesso ou pedir email para assistir'], 'missing'),
    row('download-restriction', 'privacy', ['Block downloads', 'Bloquear la descarga', 'Bloquear o download'], 'partial', {
      detail: [
        'Per video, off by default with a password: the download button and the download link stop working. The video still streams, so it can be captured',
        'Por video, apagada por defecto con contraseña: el botón y el link de descarga dejan de andar. El video se sigue transmitiendo, así que se puede capturar',
        'Por vídeo, desligado por padrão com senha: o botão e o link de download param de funcionar. O vídeo continua sendo transmitido, então dá para capturar',
      ],
    }),

    // Interacción
    row('timestamped-comments', 'engagement', ['Time-stamped comments', 'Comentarios con tiempo', 'Comentários com tempo'], 'have', {
      weight: 2,
      detail: [
        'Marked on the timeline, one click jumps to the second, with text replies (no video replies)',
        'Marcados en la línea de tiempo, un clic lleva al segundo, con respuestas de texto (sin respuestas en video)',
        'Marcados na linha do tempo, um clique leva ao segundo, com respostas de texto (sem respostas em vídeo)',
      ],
    }),
    row('emoji-reactions', 'engagement', ['Emoji reactions', 'Reacciones con emoji', 'Reações com emoji'], 'have', {
      detail: [
        'Six reactions with the second of the video, shown on the timeline',
        'Seis reacciones con el segundo del video, marcadas en la línea de tiempo',
        'Seis reações com o segundo do vídeo, marcadas na linha do tempo',
      ],
    }),
    row('transcript-captions', 'engagement', ['Transcript and captions', 'Transcripción y subtítulos', 'Transcrição e legendas'], 'have', {
      weight: 2,
      detail: [
        'With the transcription provider configured (AI Gateway by default, or OpenAI or Deepgram with REC_TRANSCRIBE_PROVIDER): clickable transcript and captions in the language spoken',
        'Con el proveedor de transcripción configurado (AI Gateway por defecto, u OpenAI o Deepgram con REC_TRANSCRIBE_PROVIDER): transcripción clicable y subtítulos en el idioma hablado',
        'Com o provedor de transcrição configurado (AI Gateway por padrão, ou OpenAI ou Deepgram com REC_TRANSCRIBE_PROVIDER): transcrição clicável e legendas no idioma falado',
      ],
    }),
    row('notifications', 'engagement', ['Notifications for views, comments and reactions', 'Avisos de vistas, comentarios y reacciones', 'Avisos de visualizações, comentários e reações'], 'have', {
      detail: [
        'The first view of each viewer, and comments and reactions grouped in one notice ("3 new comments") until you read it; can be turned off per video',
        'La primera vista de cada espectador, y los comentarios y reacciones agrupados en un aviso ("3 comentarios nuevos") hasta que lo leés; se apaga por video',
        'A primeira visualização de cada espectador, e os comentários e reações agrupados num aviso ("3 comentários novos") até você ler; dá para desligar por vídeo',
      ],
    }),

    // Analítica
    row('viewer-insights', 'analytics', ['Who watched', 'Quién vio el video', 'Quem assistiu'], 'have', {
      weight: 2,
      detail: [
        'Views, unique viewers and the names of signed-in viewers; your own views do not count',
        'Vistas, espectadores únicos y el nombre de quien entró con sesión; tus propias vistas no cuentan',
        'Visualizações, espectadores únicos e o nome de quem entrou com sessão; suas próprias visualizações não contam',
      ],
    }),
    row('engagement-insights', 'analytics', ['Watch time, CTA clicks and export', 'Cuánto vio cada uno, clics y export', 'Quanto cada um assistiu, cliques e exportação'], 'have', {
      detail: [
        'Time really watched per viewer (the union of the parts played: skipping ahead does not count), average, watched to the end, a retention curve and CTA clicks, with CSV export. Only whoever manages the video sees it',
        'Tiempo realmente visto por espectador (la unión de lo reproducido: adelantar no cuenta), promedio, quienes lo vieron hasta el final, curva de retención y clics en la CTA, con export a CSV. Solo la ve quien administra el video',
        'Tempo realmente assistido por espectador (a união do que foi reproduzido: avançar não conta), média, quem assistiu até o fim, curva de retenção e cliques na CTA, com exportação CSV. Só quem administra o vídeo vê',
      ],
    }),

    // IA
    row('ai-title-summary', 'ai', ['AI title and summary', 'Título y resumen con IA', 'Título e resumo com IA'], 'have', {
      weight: 2,
      detail: [
        'From the transcript, through the workspace AI quota; the title is kept if you changed it',
        'Desde la transcripción, con la cuota de IA del workspace; si cambiaste el título, se respeta',
        'A partir da transcrição, com a cota de IA do workspace; se você mudou o título, ele é mantido',
      ],
    }),
    row('ai-chapters', 'ai', ['AI chapters', 'Capítulos con IA', 'Capítulos com IA'], 'have', {
      detail: [
        'For videos of 60 seconds or more, editable as "0:00 Intro" lines',
        'En videos de 60 segundos o más, editables como líneas "0:00 Intro"',
        'Em vídeos de 60 segundos ou mais, editáveis como linhas "0:00 Intro"',
      ],
    }),
    row('ai-workflows', 'ai', ['Turn a video into a doc or a task', 'Del video a un documento o una tarea', 'Do vídeo para um documento ou uma tarefa'], 'missing', {
      detail: [
        'Docs, bug reports and Jira issues from the video',
        'Documentos, reportes de bug e issues de Jira a partir del video',
        'Documentos, relatórios de bug e issues do Jira a partir do vídeo',
      ],
    }),
    row('ai-meeting-notes', 'ai', ['Meeting notes and recap emails', 'Notas y mail de resumen de reuniones', 'Notas e email de resumo de reuniões'], 'missing'),

    // Biblioteca
    row('library-folders', 'library', ['Personal library with folders and archive', 'Biblioteca personal con carpetas y archivo', 'Biblioteca pessoal com pastas e arquivo'], 'partial', {
      weight: 2,
      detail: [
        'My videos with folders, search, rename, move and delete. No archive or watch later',
        'Mis videos con carpetas, búsqueda, renombrar, mover y borrar. Sin archivo ni "ver más tarde"',
        'Meus vídeos com pastas, busca, renomear, mover e apagar. Sem arquivo nem "assistir depois"',
      ],
    }),
    row('shared-spaces', 'library', ['Shared team spaces', 'Espacios compartidos del equipo', 'Espaços compartilhados da equipe'], 'partial', {
      detail: [
        'One space shared with the whole workspace, with its own folders. Not several spaces with their own members',
        'Un espacio compartido con todo el workspace, con sus carpetas. Todavía no varios espacios con miembros propios',
        'Um espaço compartilhado com todo o workspace, com suas pastas. Ainda não vários espaços com membros próprios',
      ],
    }),
    row('video-search', 'library', ['Search videos', 'Buscar videos', 'Buscar vídeos'], 'have', {
      detail: [
        'By title, description and transcript, with matching folders, in the library and in Cmd+K. People who do not manage a video only find text inside its trim',
        'Por título, descripción y transcripción, con las carpetas que coinciden, en la biblioteca y en Cmd+K. Quien no administra un video solo encuentra texto dentro de su recorte',
        'Por título, descrição e transcrição, com as pastas que coincidem, na biblioteca e no Cmd+K. Quem não administra um vídeo só encontra texto dentro do corte',
      ],
    }),

    // Integraciones
    row('slack', 'integrations', ['Slack previews', 'Vista previa en Slack', 'Prévia no Slack'], 'missing'),
    row('jira-confluence-github', 'integrations', ['Jira, Confluence and GitHub', 'Jira, Confluence y GitHub', 'Jira, Confluence e GitHub'], 'missing'),
    row('gmail', 'integrations', ['Record and insert from Gmail', 'Grabar e insertar desde Gmail', 'Gravar e inserir pelo Gmail'], 'missing'),

    // Administración
    row('members-roles', 'admin', ['Members and roles', 'Miembros y roles', 'Membros e funções'], 'have', {
      detail: [
        'Workspace members and roles: My videos are only for whoever recorded them (admins included, as in Loom); in the workspace space the author or an admin edits',
        'Miembros y roles del workspace: Mis videos son solo de quien los grabó (los admins tampoco los ven, como en Loom); en el espacio del workspace edita el autor o un admin',
        'Membros e funções do workspace: Meus vídeos são só de quem gravou (os admins também não veem, como no Loom); no espaço do workspace edita o autor ou um admin',
      ],
    }),
    row('sso-scim', 'admin', ['SSO and SCIM', 'SSO y SCIM', 'SSO e SCIM'], 'missing'),
    row('data-retention', 'admin', ['Data retention and content transfer', 'Retención de datos y traspaso de contenido', 'Retenção de dados e transferência de conteúdo'], 'missing'),
  ],
};

export default parity;
