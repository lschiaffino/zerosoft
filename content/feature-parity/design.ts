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
 * Design contra Canva. Fuente: docs/benchmark/design.md (2026-10-29). Primera
 * versión: editor de lienzo con páginas, plantillas en JSON, kit de marca,
 * exportación en el navegador, compartir y comentarios. Los ids son estables.
 */
const parity: ProductParity = {
  competitor: 'Canva',
  lastReviewed: '2026-10-29',
  areas: [
    { id: 'create', label: loc(['Create', 'Crear', 'Criar']) },
    { id: 'editor', label: loc(['Editor', 'Editor', 'Editor']) },
    { id: 'elements', label: loc(['Elements', 'Elementos', 'Elementos']) },
    { id: 'text', label: loc(['Text', 'Texto', 'Texto']) },
    { id: 'images', label: loc(['Images', 'Imágenes', 'Imagens']) },
    { id: 'arrange', label: loc(['Arrange', 'Ordenar', 'Organizar']) },
    { id: 'brand', label: loc(['Brand', 'Marca', 'Marca']) },
    { id: 'export', label: loc(['Export', 'Exportar', 'Exportar']) },
    { id: 'collab', label: loc(['Sharing and comments', 'Compartir y comentar', 'Compartilhar e comentar']) },
    { id: 'ai', label: loc(['AI', 'IA', 'IA']) },
    { id: 'library', label: loc(['Library', 'Biblioteca', 'Biblioteca']) },
    { id: 'integrations', label: loc(['Integrations', 'Integraciones', 'Integrações']) },
    { id: 'admin', label: loc(['Admin', 'Administración', 'Administração']) },
  ],
  rows: [
    // Crear
    row('preset-sizes', 'create', ['Preset and custom sizes', 'Tamaños listos y a medida', 'Tamanhos prontos e personalizados'], 'have', {
      weight: 2,
      detail: [
        'Instagram post (1080×1080), Instagram story (1080×1920), LinkedIn post (1200×627), A4 (794×1123 px), 16:9 presentation (1920×1080), logo (500×500) and custom sizes up to 8000 px',
        'Post de Instagram (1080×1080), historia de Instagram (1080×1920), post de LinkedIn (1200×627), A4 (794×1123 px), presentación 16:9 (1920×1080), logo (500×500) y tamaños a medida de hasta 8000 px',
        'Post do Instagram (1080×1080), story do Instagram (1080×1920), post do LinkedIn (1200×627), A4 (794×1123 px), apresentação 16:9 (1920×1080), logo (500×500) e tamanhos personalizados de até 8000 px',
      ],
    }),
    row('templates', 'create', ['Templates', 'Plantillas', 'Modelos'], 'partial', {
      weight: 2,
      detail: [
        '20 built-in templates across those sizes, made of shapes, text and icons. No stock photos. Canva has hundreds of thousands',
        '20 plantillas incluidas en esos tamaños, hechas con formas, texto e íconos. Sin fotos de stock. Canva tiene cientos de miles',
        '20 modelos incluídos nesses tamanhos, feitos de formas, texto e ícones. Sem fotos de banco. O Canva tem centenas de milhares',
      ],
    }),
    row('workspace-templates', 'create', ['Workspace templates', 'Plantillas del workspace', 'Modelos do workspace'], 'have', {
      detail: ['Save any design as a template for the whole workspace', 'Cualquier diseño se guarda como plantilla para todo el workspace', 'Qualquer design vira modelo para todo o workspace'],
    }),
    row('resize', 'create', ['Resize a design', 'Cambiar el tamaño de un diseño', 'Redimensionar um design'], 'partial', {
      detail: [
        'Resizing to another size scales and centers the content. There is no smart relayout like Magic Switch',
        'Pasar a otro tamaño escala y centra el contenido. No reacomoda los elementos como Magic Switch',
        'Mudar de tamanho escala e centraliza o conteúdo. Não reorganiza os elementos como o Magic Switch',
      ],
    }),

    // Editor
    row('canvas-editing', 'editor', ['Canvas editing', 'Edición en el lienzo', 'Edição na tela'], 'have', {
      weight: 2,
      detail: ['Select, move, resize and rotate with handles, and multi-select', 'Seleccionar, mover, cambiar el tamaño y rotar con manijas, y selección múltiple', 'Selecionar, mover, redimensionar e girar com alças, e seleção múltipla'],
    }),
    row('multi-page', 'editor', ['Multi-page designs', 'Diseños de varias páginas', 'Designs com várias páginas'], 'have', { weight: 2 }),
    row('undo-redo', 'editor', ['Undo and redo', 'Deshacer y rehacer', 'Desfazer e refazer'], 'have'),
    row('copy-paste', 'editor', ['Copy, paste and duplicate', 'Copiar, pegar y duplicar', 'Copiar, colar e duplicar'], 'have', {
      detail: ['Also between designs', 'También entre diseños', 'Também entre designs'],
    }),
    row('shortcuts', 'editor', ['Keyboard shortcuts', 'Atajos de teclado', 'Atalhos de teclado'], 'have'),
    row('zoom-pan', 'editor', ['Zoom and pan', 'Zoom y desplazamiento', 'Zoom e deslocamento'], 'have'),
    row('snapping', 'editor', ['Snapping guides', 'Guías de alineación', 'Guias de alinhamento'], 'have', {
      detail: ['To page edges and centers and to other elements', 'A los bordes y el centro de la página y a otros elementos', 'Às bordas e ao centro da página e a outros elementos'],
    }),
    row('rulers', 'editor', ['Rulers', 'Reglas', 'Réguas'], 'missing'),
    row('present', 'editor', ['Present', 'Presentar', 'Apresentar'], 'have', {
      detail: ['Full-screen presentation of the pages, with the arrow keys', 'Presentación a pantalla completa de las páginas, con las flechas', 'Apresentação em tela cheia das páginas, com as setas'],
    }),

    // Elementos
    row('shapes', 'elements', ['Shapes', 'Formas', 'Formas'], 'have', {
      detail: ['Rectangle, rounded rectangle, circle, triangle, diamond, star and arrow', 'Rectángulo, rectángulo redondeado, círculo, triángulo, rombo, estrella y flecha', 'Retângulo, retângulo arredondado, círculo, triângulo, losango, estrela e seta'],
    }),
    row('lines', 'elements', ['Lines', 'Líneas', 'Linhas'], 'have', {
      detail: ['Solid or dashed, with an optional arrowhead', 'Continuas o punteadas, con punta de flecha opcional', 'Contínuas ou tracejadas, com ponta de seta opcional'],
    }),
    row('icons', 'elements', ['Icons and graphics', 'Íconos y gráficos', 'Ícones e gráficos'], 'partial', {
      detail: ['About 40 built-in line icons. No graphics or stickers library', 'Unos 40 íconos de línea incluidos. Sin biblioteca de gráficos ni stickers', 'Cerca de 40 ícones de linha incluídos. Sem biblioteca de gráficos nem figurinhas'],
    }),
    row('frames', 'elements', ['Frames', 'Marcos', 'Molduras'], 'have', {
      detail: ['Square, rounded and circle frames you fill with an image', 'Marcos cuadrados, redondeados y circulares que se llenan con una imagen', 'Molduras quadradas, arredondadas e circulares que você preenche com uma imagem'],
    }),
    row('grids', 'elements', ['Grids', 'Cuadrículas', 'Grades'], 'partial', {
      detail: [
        'Insert layouts of 2, 3, 4 or 6 frames as a group. The gap is not adjustable as a single element',
        'Inserta diseños de 2, 3, 4 o 6 marcos como grupo. El espacio entre celdas no se ajusta como un solo elemento',
        'Insere layouts de 2, 3, 4 ou 6 molduras como grupo. O espaçamento não se ajusta como um elemento só',
      ],
    }),
    row('charts-tables', 'elements', ['Charts and tables', 'Gráficos y tablas', 'Gráficos e tabelas'], 'missing'),
    row('stock-media', 'elements', ['Stock photos and media', 'Fotos y medios de stock', 'Fotos e mídia de banco'], 'missing', {
      detail: ['No stock library, by choice: nothing with copyrighted assets', 'Sin biblioteca de stock, a propósito: nada con material protegido', 'Sem biblioteca de banco, de propósito: nada com material protegido'],
    }),
    row('video-animation', 'elements', ['Video and animation', 'Video y animación', 'Vídeo e animação'], 'missing'),

    // Texto
    row('text-styling', 'text', ['Text styling', 'Estilo del texto', 'Estilo do texto'], 'have', {
      weight: 2,
      detail: [
        'Font, size, weight, italic, underline, color, alignment, line height, letter spacing and uppercase',
        'Fuente, tamaño, peso, cursiva, subrayado, color, alineación, interlineado, espaciado entre letras y mayúsculas',
        'Fonte, tamanho, peso, itálico, sublinhado, cor, alinhamento, entrelinha, espaçamento entre letras e maiúsculas',
      ],
    }),
    row('fonts', 'text', ['Fonts', 'Fuentes', 'Fontes'], 'partial', {
      detail: ['12 fonts. You cannot upload your own', '12 fuentes. No se pueden subir fuentes propias', '12 fontes. Não dá para enviar fontes próprias'],
    }),
    row('text-effects', 'text', ['Text effects', 'Efectos de texto', 'Efeitos de texto'], 'missing', {
      detail: ['Shadow, outline and curved text', 'Sombra, contorno y texto curvo', 'Sombra, contorno e texto curvo'],
    }),

    // Imágenes
    row('image-upload', 'images', ['Upload images', 'Subir imágenes', 'Enviar imagens'], 'have', {
      weight: 2,
      detail: [
        'PNG, JPG, GIF and WebP up to 4 MB (large photos are reduced in the browser first), through the same upload checks as the rest of the suite. Also paste from the clipboard and drag and drop',
        'PNG, JPG, GIF y WebP de hasta 4 MB (las fotos grandes se achican antes en el navegador), con los mismos controles de subida que el resto de la suite. También pegar desde el portapapeles y arrastrar y soltar',
        'PNG, JPG, GIF e WebP de até 4 MB (fotos grandes são reduzidas antes no navegador), com as mesmas verificações de envio do resto da suíte. Também colar da área de transferência e arrastar e soltar',
      ],
    }),
    row('crop', 'images', ['Crop', 'Recortar', 'Recortar'], 'have'),
    row('image-filters', 'images', ['Filters and adjustments', 'Filtros y ajustes', 'Filtros e ajustes'], 'missing'),
    row('flip', 'images', ['Flip', 'Voltear', 'Espelhar'], 'have'),

    // Ordenar
    row('layers-panel', 'arrange', ['Layers panel', 'Panel de capas', 'Painel de camadas'], 'have'),
    row('group', 'arrange', ['Group and ungroup', 'Agrupar y desagrupar', 'Agrupar e desagrupar'], 'have'),
    row('align-distribute', 'arrange', ['Align and distribute', 'Alinear y distribuir', 'Alinhar e distribuir'], 'have'),
    row('lock', 'arrange', ['Lock elements', 'Bloquear elementos', 'Bloquear elementos'], 'have'),
    row('opacity', 'arrange', ['Transparency', 'Transparencia', 'Transparência'], 'have'),
    row('z-order', 'arrange', ['Bring forward and send back', 'Traer adelante y enviar atrás', 'Trazer para frente e enviar para trás'], 'have'),
    row('background', 'arrange', ['Page background', 'Fondo de la página', 'Fundo da página'], 'have', {
      detail: ['A color or an image per page', 'Un color o una imagen por página', 'Uma cor ou uma imagem por página'],
    }),

    // Marca
    row('brand-kit', 'brand', ['Brand kit', 'Kit de marca', 'Kit de marca'], 'have', {
      weight: 2,
      detail: [
        'One kit per workspace with logos, colors and heading, subheading and body fonts. Admins edit it and everyone applies it from the editor',
        'Un kit por workspace con logos, colores y fuentes de título, subtítulo y cuerpo. Lo editan los admins y lo aplica cualquiera desde el editor',
        'Um kit por workspace com logos, cores e fontes de título, subtítulo e corpo. Os admins editam e qualquer pessoa aplica no editor',
      ],
    }),

    // Exportar
    row('export-png', 'export', ['Download PNG', 'Descargar PNG', 'Baixar PNG'], 'have', {
      weight: 2,
      detail: ['Export runs in the browser', 'La exportación corre en el navegador', 'A exportação roda no navegador'],
    }),
    row('export-jpg', 'export', ['Download JPG', 'Descargar JPG', 'Baixar JPG'], 'have'),
    row('transparent-png', 'export', ['Transparent PNG', 'PNG transparente', 'PNG transparente'], 'have'),
    row('export-pdf', 'export', ['Download PDF', 'Descargar PDF', 'Baixar PDF'], 'partial', {
      detail: [
        'Multi-page PDF where each page is an image: the text is not selectable and there are no bleed or crop marks for print',
        'PDF de varias páginas donde cada página es una imagen: el texto no se puede seleccionar y no hay sangrado ni marcas de corte para imprenta',
        'PDF de várias páginas em que cada página é uma imagem: o texto não é selecionável e não há sangria nem marcas de corte para gráfica',
      ],
    }),
    row('export-scale', 'export', ['Export size', 'Tamaño de exportación', 'Tamanho da exportação'], 'have', {
      detail: ['1x, 2x or 3x', '1x, 2x o 3x', '1x, 2x ou 3x'],
    }),
    row('export-svg', 'export', ['Download SVG', 'Descargar SVG', 'Baixar SVG'], 'missing'),
    row('export-video-gif', 'export', ['Download video or GIF', 'Descargar video o GIF', 'Baixar vídeo ou GIF'], 'missing'),

    // Compartir y comentar
    row('share-workspace', 'collab', ['Share in the workspace', 'Compartir en el workspace', 'Compartilhar no workspace'], 'have', {
      weight: 2,
      detail: ['View or edit, for the whole workspace or for specific people', 'Ver o editar, para todo el workspace o para personas puntuales', 'Ver ou editar, para todo o workspace ou para pessoas específicas'],
    }),
    row('public-link', 'collab', ['Public view link', 'Link público de solo lectura', 'Link público só de visualização'], 'have', {
      detail: ['View only, revocable and not indexed by search engines', 'Solo para ver, revocable y fuera de los buscadores', 'Só para ver, revogável e fora dos buscadores'],
    }),
    row('comments', 'collab', ['Comments on the canvas', 'Comentarios en el lienzo', 'Comentários na tela'], 'have', {
      weight: 2,
      detail: ['Pinned to a spot of the page, with replies, resolve and notifications', 'Fijados en un punto de la página, con respuestas, resolver y avisos', 'Fixados num ponto da página, com respostas, resolver e notificações'],
    }),
    row('presence', 'collab', ['Who is viewing', 'Quién está viendo', 'Quem está vendo'], 'have', {
      detail: ['Who has the design open and on which page', 'Quién tiene el diseño abierto y en qué página', 'Quem está com o design aberto e em qual página'],
    }),
    row('live-coediting', 'collab', ['Real-time co-editing', 'Edición en tiempo real', 'Edição em tempo real'], 'partial', {
      detail: [
        'Saved changes from others show up within a few seconds while you are not editing. If two people save the same version, the second gets a notice and reloads',
        'Los cambios guardados de otros aparecen en unos segundos mientras no estás editando. Si dos guardan la misma versión, al segundo le aparece un aviso y recarga',
        'As alterações salvas de outras pessoas aparecem em poucos segundos enquanto você não está editando. Se duas pessoas salvam a mesma versão, a segunda vê um aviso e recarrega',
      ],
    }),
    row('version-history', 'collab', ['Version history', 'Historial de versiones', 'Histórico de versões'], 'missing'),

    // IA
    row('magic-write', 'ai', ['Write with AI', 'Escribir con IA', 'Escrever com IA'], 'have', {
      detail: [
        'Write from a prompt or rewrite, shorten, expand, make more formal or more casual. Needs AI configured and uses the workspace AI quota',
        'Escribe desde un pedido o reescribe, acorta, alarga, hace más formal o más informal. Necesita IA configurada y usa la cuota de IA del workspace',
        'Escreve a partir de um pedido ou reescreve, encurta, expande, deixa mais formal ou mais casual. Precisa de IA configurada e usa a cota de IA do workspace',
      ],
    }),
    row('background-remover', 'ai', ['Background remover', 'Quitar el fondo', 'Remover o fundo'], 'missing'),
    row('text-to-image', 'ai', ['Generate images from text', 'Generar imágenes desde texto', 'Gerar imagens a partir de texto'], 'missing'),

    // Biblioteca
    row('folders', 'library', ['Folders', 'Carpetas', 'Pastas'], 'have'),
    row('search', 'library', ['Search', 'Búsqueda', 'Busca'], 'have'),
    row('starred', 'library', ['Starred designs', 'Diseños destacados', 'Designs com estrela'], 'have'),
    row('recents', 'library', ['Recent designs', 'Diseños recientes', 'Designs recentes'], 'have'),
    row('trash', 'library', ['Trash', 'Papelera', 'Lixeira'], 'have', {
      detail: ['Restore or delete permanently', 'Restaurar o borrar del todo', 'Restaurar ou excluir de vez'],
    }),
    row('duplicate', 'library', ['Duplicate a design', 'Duplicar un diseño', 'Duplicar um design'], 'have'),

    // Integraciones
    row('docs-embed', 'integrations', ['Embed in Docs', 'Insertar en Docs', 'Inserir no Docs'], 'have', {
      detail: [
        'A /design block in a Docs page shows a live preview that links to the design, checking who can see it',
        'Un bloque /design en una página de Docs muestra una vista previa al día que lleva al diseño, y revisa quién puede verlo',
        'Um bloco /design numa página do Docs mostra uma prévia atualizada que leva ao design, conferindo quem pode vê-lo',
      ],
    }),
    row('board-send', 'integrations', ['Send to a Board', 'Mandar a una pizarra', 'Enviar para um quadro'], 'better', {
      competitorHas: false,
      detail: ['Sends the current page to a Board as an image', 'Manda la página actual a una pizarra de Board como imagen', 'Envia a página atual para um quadro do Board como imagem'],
    }),
    row('email-images', 'integrations', ['Use designs in emails', 'Usar diseños en emails', 'Usar designs em e-mails'], 'missing', {
      detail: ['Using a design as an image in Link or CRM emails', 'Usar un diseño como imagen en emails de Link o del CRM', 'Usar um design como imagem em e-mails do Link ou do CRM'],
    }),
    row('api', 'integrations', ['API', 'API', 'API'], 'partial', {
      detail: ['REST API to list and read designs with the design:read scope. No write API', 'API REST para listar y leer diseños con el scope design:read. Sin API de escritura', 'API REST para listar e ler designs com o escopo design:read. Sem API de escrita'],
    }),

    // Administración
    row('app-access', 'admin', ['Per-app access', 'Acceso por app', 'Acesso por app'], 'have', {
      detail: ['Per-app access in the workspace and API key scopes', 'Acceso por app en el workspace y scopes de las API keys', 'Acesso por app no workspace e escopos das chaves de API'],
    }),
    row('self-host', 'admin', ['Self-host', 'Instalar en tu servidor', 'Hospedar no seu servidor'], 'better', { competitorHas: false }),
    row('mobile-apps', 'admin', ['Mobile apps', 'Apps para el celular', 'Apps para celular'], 'missing'),
  ],
};

export default parity;
