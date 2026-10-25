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
 * Rec contra Loom. Fuente: docs/benchmark/rec.md (2026-10-25). Rec todavía no
 * existe (solo el shell "Próximamente"), así que todas las filas están en
 * missing. Los ids son estables: las tandas siguientes los pasan a have.
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
    row('screen-camera-record', 'capture', ['Record screen and camera together', 'Grabar pantalla y cámara a la vez', 'Gravar tela e câmera juntas'], 'missing', {
      weight: 2,
      detail: [
        'Camera bubble over the screen, plus screen only and camera only modes',
        'Burbuja de cámara sobre la pantalla, y modos solo pantalla y solo cámara',
        'Bolha da câmera sobre a tela, e modos só tela e só câmera',
      ],
    }),
    row('capture-source', 'capture', ['Pick full screen, window or tab', 'Elegir pantalla completa, ventana o pestaña', 'Escolher tela inteira, janela ou aba'], 'missing', { weight: 2 }),
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
    row('audio-capture', 'capture', ['Microphone, system audio and noise suppression', 'Micrófono, audio del sistema y supresión de ruido', 'Microfone, áudio do sistema e supressão de ruído'], 'missing', { weight: 2 }),
    row('pause-rewind', 'capture', ['Pause, resume and rewind while recording', 'Pausar, retomar y volver atrás mientras se graba', 'Pausar, retomar e voltar enquanto grava'], 'missing', {
      detail: [
        'Live Rewind drops the last seconds without stopping the recording',
        'Live Rewind borra los últimos segundos sin cortar la grabación',
        'Live Rewind apaga os últimos segundos sem parar a gravação',
      ],
    }),
    row('meeting-recording', 'capture', ['Record meetings', 'Grabar reuniones', 'Gravar reuniões'], 'missing'),

    // Herramientas al grabar
    row('recording-quality', 'recorder', ['Up to 4K quality', 'Calidad hasta 4K', 'Qualidade até 4K'], 'missing', {
      detail: ['720p on the free plan, 4K on paid plans', '720p en el plan gratis, 4K en los pagos', '720p no plano grátis, 4K nos pagos'],
    }),
    row('camera-effects', 'recorder', ['Virtual backgrounds, camera frames and blur', 'Fondos virtuales, marcos de cámara y desenfoque', 'Fundos virtuais, molduras de câmera e desfoque'], 'missing'),
    row('drawing-tool', 'recorder', ['Draw on screen and highlight the mouse', 'Dibujar en pantalla y resaltar el mouse', 'Desenhar na tela e destacar o mouse'], 'missing'),

    // Edición
    row('trim-stitch', 'editing', ['Trim and stitch videos', 'Recortar y unir videos', 'Cortar e unir vídeos'], 'missing', { weight: 2 }),
    row('edit-by-transcript', 'editing', ['Edit from the transcript', 'Editar desde la transcripción', 'Editar pela transcrição'], 'missing', {
      detail: ['Deleting text cuts the video', 'Borrar texto corta el video', 'Apagar texto corta o vídeo'],
    }),
    row('filler-silence-removal', 'editing', ['Remove filler words and silences with AI', 'Quitar muletillas y silencios con IA', 'Remover vícios de linguagem e silêncios com IA'], 'missing'),
    row('custom-thumbnail', 'editing', ['Custom and GIF thumbnails', 'Miniatura propia y GIF', 'Miniatura própria e GIF'], 'missing'),
    row('overlays', 'editing', ['Text, box and arrow overlays', 'Textos, cajas y flechas sobre el video', 'Textos, caixas e setas sobre o vídeo'], 'missing'),
    row('upload-download', 'editing', ['Upload and download videos', 'Subir y descargar videos', 'Enviar e baixar vídeos'], 'missing'),

    // Compartir
    row('instant-link', 'sharing', ['Share link ready when you stop', 'Link listo al terminar de grabar', 'Link pronto ao parar a gravação'], 'missing', {
      weight: 2,
      detail: [
        'The link is copied as soon as the recording stops',
        'El link se copia apenas se corta la grabación',
        'O link é copiado assim que a gravação para',
      ],
    }),
    row('watch-page', 'sharing', ['Video page with player and transcript', 'Página del video con reproductor y transcripción', 'Página do vídeo com player e transcrição'], 'missing', {
      weight: 2,
      detail: ['Speed controls, transcript and comments', 'Velocidad, transcripción y comentarios', 'Velocidade, transcrição e comentários'],
    }),
    row('embed-player', 'sharing', ['Embed the player in other sites', 'Insertar el reproductor en otros sitios', 'Incorporar o player em outros sites'], 'missing', {
      detail: [
        'Notion, Confluence, FigJam, Intercom, Zendesk and your own site',
        'Notion, Confluence, FigJam, Intercom, Zendesk y webs propias',
        'Notion, Confluence, FigJam, Intercom, Zendesk e sites próprios',
      ],
    }),
    row('cta-button', 'sharing', ['Call to action button', 'Botón de llamada a la acción', 'Botão de chamada para ação'], 'missing', {
      detail: [
        'Shown during the whole video or only at the end',
        'Se ve durante todo el video o solo al final',
        'Aparece durante o vídeo todo ou só no final',
      ],
    }),
    row('custom-branding', 'sharing', ['Your logo and colors, no Loom branding', 'Logo y colores propios, sin la marca de Loom', 'Logo e cores próprios, sem a marca do Loom'], 'missing'),

    // Privacidad
    row('privacy-levels', 'privacy', ['Who can watch: link, workspace or specific people', 'Quién lo ve: link, workspace o personas puntuales', 'Quem assiste: link, workspace ou pessoas específicas'], 'missing', {
      weight: 2,
      detail: [
        'With a default privacy setting for the workspace',
        'Con una privacidad por defecto para el workspace',
        'Com uma privacidade padrão para o workspace',
      ],
    }),
    row('password-protect', 'privacy', ['Password-protected videos', 'Videos con contraseña', 'Vídeos com senha'], 'missing'),
    row('request-access', 'privacy', ['Request access or ask for an email to watch', 'Pedir acceso o pedir email para ver', 'Pedir acesso ou pedir email para assistir'], 'missing'),
    row('download-restriction', 'privacy', ['Block downloads', 'Bloquear la descarga', 'Bloquear o download'], 'missing'),

    // Interacción
    row('timestamped-comments', 'engagement', ['Time-stamped comments', 'Comentarios con tiempo', 'Comentários com tempo'], 'missing', {
      weight: 2,
      detail: [
        'Shown on the video timeline, with video replies',
        'Aparecen en la línea de tiempo, con respuestas en video',
        'Aparecem na linha do tempo, com respostas em vídeo',
      ],
    }),
    row('emoji-reactions', 'engagement', ['Emoji reactions', 'Reacciones con emoji', 'Reações com emoji'], 'missing'),
    row('transcript-captions', 'engagement', ['Transcript and captions', 'Transcripción y subtítulos', 'Transcrição e legendas'], 'missing', {
      weight: 2,
      detail: ['More than 50 languages', 'Más de 50 idiomas', 'Mais de 50 idiomas'],
    }),
    row('notifications', 'engagement', ['Notifications for views, comments and reactions', 'Avisos de vistas, comentarios y reacciones', 'Avisos de visualizações, comentários e reações'], 'missing'),

    // Analítica
    row('viewer-insights', 'analytics', ['Who watched', 'Quién vio el video', 'Quem assistiu'], 'missing', { weight: 2 }),
    row('engagement-insights', 'analytics', ['Watch time, CTA clicks and export', 'Cuánto vio cada uno, clics y export', 'Quanto cada um assistiu, cliques e exportação'], 'missing'),

    // IA
    row('ai-title-summary', 'ai', ['AI title and summary', 'Título y resumen con IA', 'Título e resumo com IA'], 'missing', { weight: 2 }),
    row('ai-chapters', 'ai', ['AI chapters', 'Capítulos con IA', 'Capítulos com IA'], 'missing'),
    row('ai-workflows', 'ai', ['Turn a video into a doc or a task', 'Del video a un documento o una tarea', 'Do vídeo para um documento ou uma tarefa'], 'missing', {
      detail: [
        'Docs, bug reports and Jira issues from the video',
        'Documentos, reportes de bug e issues de Jira a partir del video',
        'Documentos, relatórios de bug e issues do Jira a partir do vídeo',
      ],
    }),
    row('ai-meeting-notes', 'ai', ['Meeting notes and recap emails', 'Notas y mail de resumen de reuniones', 'Notas e email de resumo de reuniões'], 'missing'),

    // Biblioteca
    row('library-folders', 'library', ['Personal library with folders and archive', 'Biblioteca personal con carpetas y archivo', 'Biblioteca pessoal com pastas e arquivo'], 'missing', { weight: 2 }),
    row('shared-spaces', 'library', ['Shared team spaces', 'Espacios compartidos del equipo', 'Espaços compartilhados da equipe'], 'missing'),
    row('video-search', 'library', ['Search videos', 'Buscar videos', 'Buscar vídeos'], 'missing'),

    // Integraciones
    row('slack', 'integrations', ['Slack previews', 'Vista previa en Slack', 'Prévia no Slack'], 'missing'),
    row('jira-confluence-github', 'integrations', ['Jira, Confluence and GitHub', 'Jira, Confluence y GitHub', 'Jira, Confluence e GitHub'], 'missing'),
    row('gmail', 'integrations', ['Record and insert from Gmail', 'Grabar e insertar desde Gmail', 'Gravar e inserir pelo Gmail'], 'missing'),

    // Administración
    row('members-roles', 'admin', ['Members and roles', 'Miembros y roles', 'Membros e funções'], 'missing'),
    row('sso-scim', 'admin', ['SSO and SCIM', 'SSO y SCIM', 'SSO e SCIM'], 'missing'),
    row('data-retention', 'admin', ['Data retention and content transfer', 'Retención de datos y traspaso de contenido', 'Retenção de dados e transferência de conteúdo'], 'missing'),
  ],
};

export default parity;
