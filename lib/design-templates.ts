/**
 * Plantillas de Design que vienen con la app: 20, en JSON armado en código,
 * con formas, texto, íconos propios y marcos vacíos para las fotos (sin
 * imágenes ni assets de terceros). Los textos van en en/es/pt.
 */
import {
  newId,
  presetSize,
  type Align,
  type DesignDoc,
  type DesignElement,
  type DesignPresetKey,
  type FontKey,
  type Mask,
  type ShapeKind,
} from './design-model';

type L = [en: string, es: string, pt: string];
export type TemplateLocale = 'en' | 'es' | 'pt';

interface TextOpts {
  font?: FontKey;
  size?: number;
  weight?: number;
  color?: string;
  align?: Align;
  lineHeight?: number;
  letterSpacing?: number;
  italic?: boolean;
  uppercase?: boolean;
  opacity?: number;
}

interface PageSpec {
  bg: string;
  els: DesignElement[];
}

export interface DesignTemplate {
  id: string;
  preset: DesignPresetKey;
  name: L;
  build: (lang: TemplateLocale) => PageSpec[];
}

const base = () => ({ id: newId('e'), rotation: 0, opacity: 1 });
const idx: Record<TemplateLocale, 0 | 1 | 2> = { en: 0, es: 1, pt: 2 };

function makeKit(lang: TemplateLocale) {
  const tx = (s: string | L) => (typeof s === 'string' ? s : s[idx[lang]]);
  return {
    text(x: number, y: number, w: number, s: string | L, o: TextOpts = {}): DesignElement {
      const text = tx(s);
      const size = o.size ?? 32;
      const lineHeight = o.lineHeight ?? 1.25;
      return {
        ...base(),
        type: 'text',
        x,
        y,
        w,
        h: Math.max(1, text.split('\n').length) * size * lineHeight,
        opacity: o.opacity ?? 1,
        text,
        font: o.font ?? 'inter',
        size,
        weight: o.weight ?? 400,
        italic: o.italic,
        uppercase: o.uppercase,
        color: o.color ?? '#111111',
        align: o.align ?? 'left',
        lineHeight,
        letterSpacing: o.letterSpacing ?? 0,
      };
    },
    shape(shape: ShapeKind, x: number, y: number, w: number, h: number, fill: string, o: { stroke?: string; strokeWidth?: number; radius?: number; opacity?: number; rotation?: number } = {}): DesignElement {
      return {
        ...base(),
        type: 'shape',
        shape,
        x,
        y,
        w,
        h,
        fill,
        stroke: o.stroke ?? 'transparent',
        strokeWidth: o.strokeWidth ?? 0,
        radius: o.radius ?? 0,
        opacity: o.opacity ?? 1,
        rotation: o.rotation ?? 0,
      };
    },
    line(x: number, y: number, w: number, stroke: string, strokeWidth: number, o: { dash?: 'solid' | 'dashed' | 'dotted'; arrowEnd?: boolean } = {}): DesignElement {
      return { ...base(), type: 'line', x, y: y - strokeWidth / 2, w, h: strokeWidth, stroke, strokeWidth, dash: o.dash ?? 'solid', arrowEnd: o.arrowEnd };
    },
    icon(x: number, y: number, size: number, icon: string, color: string, strokeWidth = 1.8): DesignElement {
      return { ...base(), type: 'icon', x, y, w: size, h: size, icon, color, strokeWidth };
    },
    frame(x: number, y: number, w: number, h: number, mask: Mask = 'none'): DesignElement {
      return { ...base(), type: 'image', x, y, w, h, src: null, natW: w, natH: h, crop: { x: 0, y: 0, w: 1, h: 1 }, mask };
    },
  };
}

type Kit = ReturnType<typeof makeKit>;
const T = (preset: DesignPresetKey, id: string, name: L, pages: (k: Kit) => PageSpec[]): DesignTemplate => ({
  id,
  preset,
  name,
  build: (lang) => pages(makeKit(lang)),
});

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  // ---------- Instagram post (1080×1080) ----------
  T('instagram-post', 'ig-sale', ['Summer sale', 'Liquidación de verano', 'Liquidação de verão'], (k) => [
    {
      bg: '#ff5b3a',
      els: [
        k.shape('ellipse', 740, -140, 540, 540, '#ffb199', { opacity: 0.6 }),
        k.shape('ellipse', -160, 700, 560, 560, '#ffd166', { opacity: 0.85 }),
        k.text(90, 170, 900, ['SUMMER\nSALE', 'GRAN\nVENTA', 'GRANDE\nVENDA'], { font: 'bebas', size: 210, color: '#ffffff', lineHeight: 0.92, letterSpacing: 4 }),
        k.text(90, 600, 860, ['Up to 40% off everything in store', 'Hasta 40% de descuento en toda la tienda', 'Até 40% de desconto em toda a loja'], { size: 44, weight: 500, color: '#ffffff' }),
        k.shape('rect', 90, 760, 360, 96, '#1b1b1b', { radius: 6 }),
        k.text(90, 788, 360, ['SHOP NOW', 'COMPRAR', 'COMPRAR'], { font: 'montserrat', size: 32, weight: 700, color: '#ffffff', align: 'center', letterSpacing: 4 }),
        k.text(90, 960, 900, 'yourstore.com', { size: 28, color: '#ffffff', opacity: 0.85 }),
      ],
    },
  ]),
  T('instagram-post', 'ig-quote', ['Quote card', 'Tarjeta con cita', 'Cartão de citação'], (k) => [
    {
      bg: '#f6efe4',
      els: [
        k.icon(90, 110, 120, 'quote', '#c2703d', 1.4),
        k.text(90, 280, 900, ['Simplicity is the ultimate sophistication.', 'La simplicidad es la máxima sofisticación.', 'A simplicidade é o último grau de sofisticação.'], {
          font: 'playfair',
          size: 76,
          weight: 500,
          italic: true,
          color: '#2b2118',
          lineHeight: 1.2,
        }),
        k.line(90, 720, 120, '#c2703d', 4),
        k.text(90, 760, 900, 'Leonardo da Vinci', { font: 'montserrat', size: 34, weight: 600, color: '#2b2118' }),
        k.text(90, 960, 900, '@yourbrand', { size: 26, color: '#7a6a58' }),
      ],
    },
  ]),
  T('instagram-post', 'ig-event', ['Event announcement', 'Anuncio de evento', 'Anúncio de evento'], (k) => [
    {
      bg: '#14213d',
      els: [
        k.shape('rect', 90, 90, 200, 230, '#fca311'),
        k.text(90, 112, 200, ['JUN', 'JUN', 'JUN'], { font: 'montserrat', size: 40, weight: 700, color: '#14213d', align: 'center', letterSpacing: 6 }),
        k.text(90, 160, 200, '24', { font: 'bebas', size: 130, color: '#14213d', align: 'center', lineHeight: 1 }),
        k.text(90, 400, 900, ['Design meetup\nand open studio', 'Encuentro de diseño\ny estudio abierto', 'Encontro de design\ne estúdio aberto'], {
          font: 'montserrat',
          size: 84,
          weight: 800,
          color: '#ffffff',
          lineHeight: 1.05,
        }),
        k.text(90, 640, 860, ['Talks, portfolio reviews and coffee. Bring a friend.', 'Charlas, revisión de portfolios y café. Traé a alguien.', 'Palestras, revisão de portfólios e café. Traga alguém.'], {
          size: 36,
          color: '#e5e5e5',
          lineHeight: 1.35,
        }),
        k.icon(90, 860, 56, 'map-pin', '#fca311'),
        k.text(170, 868, 800, ['Studio 4, Main Street', 'Estudio 4, Calle Principal', 'Estúdio 4, Rua Principal'], { size: 34, color: '#ffffff' }),
      ],
    },
  ]),
  T('instagram-post', 'ig-tips', ['Three tips', 'Tres consejos', 'Três dicas'], (k) => {
    const tips: Array<[L, L]> = [
      [
        ['Keep a fixed schedule', 'Horario fijo', 'Horário fixo'],
        ['Same time to bed and up, weekends too', 'Misma hora para acostarte y levantarte, también el finde', 'Mesma hora para dormir e acordar, inclusive no fim de semana'],
      ],
      [
        ['Dim the screens', 'Menos pantallas', 'Menos telas'],
        ['No phone in the last hour before bed', 'Nada de celular en la última hora', 'Nada de celular na última hora'],
      ],
      [
        ['A cool, dark room', 'Cuarto fresco y oscuro', 'Quarto fresco e escuro'],
        ['Around 18 °C and no light', 'Unos 18 °C y sin luz', 'Uns 18 °C e sem luz'],
      ],
    ];
    return [
      {
        bg: '#ffffff',
        els: [
          k.shape('rect', 0, 0, 1080, 260, '#2a9d8f'),
          k.text(90, 88, 900, ['3 tips for better sleep', '3 consejos para dormir mejor', '3 dicas para dormir melhor'], { font: 'montserrat', size: 64, weight: 800, color: '#ffffff' }),
          ...tips.flatMap(([title, sub], i) => {
            const y = 340 + i * 220;
            return [
              k.shape('ellipse', 90, y, 120, 120, '#e9f5f3'),
              k.text(90, y + 22, 120, String(i + 1), { font: 'bebas', size: 76, color: '#2a9d8f', align: 'center', lineHeight: 1 }),
              k.text(250, y + 6, 740, title, { font: 'montserrat', size: 40, weight: 700, color: '#1d3557' }),
              k.text(250, y + 64, 740, sub, { size: 30, color: '#5c677d' }),
            ];
          }),
          k.text(90, 1000, 900, '@yourbrand', { size: 26, color: '#5c677d' }),
        ],
      },
    ];
  }),
  T('instagram-post', 'ig-launch', ['Product launch', 'Lanzamiento', 'Lançamento'], (k) => [
    {
      bg: '#0f0e17',
      els: [
        k.frame(600, 170, 420, 420, 'circle'),
        k.shape('ellipse', 570, 140, 480, 480, 'transparent', { stroke: '#ff8906', strokeWidth: 6 }),
        k.shape('rect', 90, 140, 150, 56, '#ff8906'),
        k.text(90, 150, 150, ['NEW', 'NUEVO', 'NOVO'], { font: 'montserrat', size: 28, weight: 800, color: '#0f0e17', align: 'center', letterSpacing: 4 }),
        k.text(90, 640, 900, ['Meet the\nnew collection', 'Conocé la\nnueva colección', 'Conheça a\nnova coleção'], { font: 'dmserif', size: 104, color: '#fffffe', lineHeight: 1 }),
        k.text(90, 880, 760, ['Available online and in stores from Friday.', 'En la web y en las tiendas desde el viernes.', 'No site e nas lojas a partir de sexta.'], { size: 34, color: '#a7a9be' }),
        k.icon(900, 870, 90, 'sparkle', '#ff8906', 1.6),
      ],
    },
  ]),

  // ---------- Instagram story (1080×1920) ----------
  T('instagram-story', 'story-poll', ['This or that', 'Esto o aquello', 'Isso ou aquilo'], (k) => [
    {
      bg: '#fdf0d5',
      els: [
        k.text(90, 200, 900, ['This or that?', '¿Esto o aquello?', 'Isso ou aquilo?'], { font: 'dmserif', size: 120, color: '#003049', align: 'center' }),
        k.shape('rect', 90, 460, 900, 560, '#669bbc', { radius: 24 }),
        k.text(90, 690, 900, ['Coffee', 'Café', 'Café'], { font: 'montserrat', size: 96, weight: 800, color: '#ffffff', align: 'center' }),
        k.text(90, 1050, 900, ['or', 'o', 'ou'], { font: 'playfair', size: 70, italic: true, color: '#780000', align: 'center' }),
        k.shape('rect', 90, 1180, 900, 560, '#c1121f', { radius: 24 }),
        k.text(90, 1410, 900, ['Tea', 'Té', 'Chá'], { font: 'montserrat', size: 96, weight: 800, color: '#ffffff', align: 'center' }),
      ],
    },
  ]),
  T('instagram-story', 'story-hiring', ["We're hiring", 'Búsqueda abierta', 'Estamos contratando'], (k) => {
    const roles: L[] = [
      ['Product designer', 'Diseñadora de producto', 'Designer de produto'],
      ['Frontend engineer', 'Ingeniero frontend', 'Engenheira frontend'],
      ['Customer success lead', 'Líder de atención al cliente', 'Líder de sucesso do cliente'],
    ];
    return [
      {
        bg: '#1d3557',
        els: [
          k.text(90, 260, 900, ["WE'RE\nHIRING", 'BUSCAMOS\nGENTE', 'ESTAMOS\nCONTRATANDO'], { font: 'bebas', size: 230, color: '#f1faee', lineHeight: 0.9 }),
          k.shape('rect', 90, 820, 900, 4, '#e63946'),
          ...roles.flatMap((r, i) => [k.icon(90, 900 + i * 110, 64, 'check-circle', '#e63946'), k.text(180, 906 + i * 110, 800, r, { size: 48, weight: 600, color: '#f1faee' })]),
          k.shape('rect', 90, 1560, 900, 140, '#e63946', { radius: 8 }),
          k.text(90, 1604, 900, ['Apply at yoursite.com/jobs', 'Postulate en tusitio.com/empleos', 'Candidate-se em seusite.com/vagas'], { font: 'montserrat', size: 40, weight: 700, color: '#ffffff', align: 'center' }),
        ],
      },
    ];
  }),
  T('instagram-story', 'story-photo', ['Photo story', 'Historia con foto', 'Story com foto'], (k) => [
    {
      bg: '#ffffff',
      els: [
        k.frame(90, 180, 900, 1200, 'rounded'),
        k.text(90, 1450, 900, ['Weekend in the mountains', 'Fin de semana en la montaña', 'Fim de semana nas montanhas'], { font: 'playfair', size: 80, color: '#222222', lineHeight: 1.1 }),
        k.text(90, 1660, 760, ['Swipe up for the full story', 'Deslizá para ver la historia completa', 'Deslize para ver a história completa'], { size: 36, color: '#777777' }),
        k.icon(910, 1650, 64, 'arrow-up-right', '#222222'),
      ],
    },
  ]),

  // ---------- LinkedIn (1200×627) ----------
  T('linkedin-post', 'li-hiring', ['Job opening', 'Búsqueda laboral', 'Vaga aberta'], (k) => [
    {
      bg: '#ffffff',
      els: [
        k.shape('rect', 0, 0, 420, 627, '#2b59c3'),
        k.icon(110, 210, 200, 'briefcase', '#ffffff', 1.2),
        k.text(500, 120, 620, ["We're hiring a", 'Buscamos', 'Estamos contratando'], { size: 40, weight: 500, color: '#555555' }),
        k.text(500, 180, 640, ['Senior Product Designer', 'Diseñadora de Producto Senior', 'Designer de Produto Sênior'], { font: 'montserrat', size: 62, weight: 800, color: '#111111', lineHeight: 1.1 }),
        k.text(500, 380, 620, ['Remote · Full time', 'Remoto · Tiempo completo', 'Remoto · Tempo integral'], { size: 34, weight: 600, color: '#2b59c3' }),
        k.text(500, 470, 620, ['Apply at yoursite.com/jobs', 'Postulate en tusitio.com/empleos', 'Candidate-se em seusite.com/vagas'], { size: 30, color: '#555555' }),
      ],
    },
  ]),
  T('linkedin-post', 'li-webinar', ['Webinar', 'Webinar', 'Webinar'], (k) => [
    {
      bg: '#111827',
      els: [
        k.text(80, 90, 700, ['FREE WEBINAR', 'WEBINAR GRATUITO', 'WEBINAR GRATUITO'], { font: 'montserrat', size: 28, weight: 700, color: '#fbbf24', letterSpacing: 6 }),
        k.text(80, 150, 700, ['How to plan a product launch', 'Cómo planear un lanzamiento', 'Como planejar um lançamento'], { font: 'montserrat', size: 60, weight: 800, color: '#ffffff', lineHeight: 1.1 }),
        k.icon(80, 410, 44, 'calendar', '#fbbf24'),
        k.text(140, 414, 560, ['Thursday, 5 PM', 'Jueves, 17 h', 'Quinta, 17h'], { size: 32, color: '#ffffff' }),
        k.icon(80, 480, 44, 'clock', '#fbbf24'),
        k.text(140, 484, 560, ['45 minutes + Q&A', '45 minutos + preguntas', '45 minutos + perguntas'], { size: 32, color: '#ffffff' }),
        k.frame(840, 110, 280, 280, 'circle'),
        k.text(790, 420, 380, 'Ana García', { size: 34, weight: 700, color: '#ffffff', align: 'center' }),
        k.text(790, 470, 380, ['Head of Marketing', 'Directora de Marketing', 'Diretora de Marketing'], { size: 26, color: '#9ca3af', align: 'center' }),
      ],
    },
  ]),
  T('linkedin-post', 'li-milestone', ['Anniversary', 'Aniversario', 'Aniversário'], (k) => [
    {
      bg: '#fef3c7',
      els: [
        k.shape('star', 120, 70, 90, 90, '#fbbf24'),
        k.shape('star', 1000, 430, 70, 70, '#fbbf24'),
        k.text(80, 110, 1040, ['1 year', '1 año', '1 ano'], { font: 'bebas', size: 220, color: '#b45309', align: 'center', lineHeight: 1 }),
        k.text(160, 360, 880, ['Thank you to every customer and every teammate who made it possible.', 'Gracias a cada cliente y a cada persona del equipo que lo hizo posible.', 'Obrigado a cada cliente e a cada pessoa do time que tornou isso possível.'], {
          size: 38,
          color: '#78350f',
          align: 'center',
          lineHeight: 1.3,
        }),
        k.icon(560, 500, 80, 'heart', '#b45309'),
      ],
    },
  ]),

  // ---------- A4 (794×1123) ----------
  T('a4', 'a4-flyer', ['Event flyer', 'Folleto de evento', 'Folheto de evento'], (k) => {
    const rows: Array<[string, L]> = [
      ['calendar', ['Saturday, 3 PM', 'Sábado, 15 h', 'Sábado, 15h']],
      ['map-pin', ['Community Center, 12 Park Ave', 'Centro Comunitario, Av. del Parque 12', 'Centro Comunitário, Av. do Parque 12']],
      ['tag', ['Free entry', 'Entrada libre', 'Entrada gratuita']],
    ];
    return [
      {
        bg: '#fff7ed',
        els: [
          k.shape('rect', 0, 0, 794, 420, '#ea580c'),
          k.text(60, 90, 674, ['OPEN\nHOUSE', 'PUERTAS\nABIERTAS', 'PORTAS\nABERTAS'], { font: 'bebas', size: 150, color: '#ffffff', lineHeight: 0.9 }),
          k.text(60, 460, 674, ['Join us for an afternoon of music, food and games for the whole family.', 'Vení a pasar una tarde de música, comida y juegos para toda la familia.', 'Venha passar uma tarde de música, comida e jogos para toda a família.'], {
            size: 26,
            color: '#431407',
            lineHeight: 1.4,
          }),
          ...rows.flatMap(([icon, label], i) => [k.icon(60, 640 + i * 80, 40, icon, '#ea580c'), k.text(120, 644 + i * 80, 600, label, { size: 26, weight: 600, color: '#431407' })]),
          k.shape('rect', 60, 960, 674, 90, '#431407'),
          k.text(60, 987, 674, 'yoursite.com/openhouse', { font: 'montserrat', size: 28, weight: 700, color: '#ffffff', align: 'center' }),
        ],
      },
    ];
  }),
  T('a4', 'a4-menu', ['Café menu', 'Menú de café', 'Cardápio de café'], (k) => {
    const sections: Array<[L, Array<[L, string]>]> = [
      [
        ['COFFEE', 'CAFÉ', 'CAFÉ'],
        [
          [['Espresso', 'Espresso', 'Espresso'], '2.50'],
          [['Flat white', 'Flat white', 'Flat white'], '3.80'],
          [['Cappuccino', 'Capuchino', 'Cappuccino'], '3.50'],
          [['Cold brew', 'Cold brew', 'Cold brew'], '4.00'],
        ],
      ],
      [
        ['BAKERY', 'PANADERÍA', 'PADARIA'],
        [
          [['Croissant', 'Medialuna', 'Croissant'], '2.90'],
          [['Banana bread', 'Budín de banana', 'Bolo de banana'], '3.20'],
          [['Cinnamon roll', 'Rol de canela', 'Rolinho de canela'], '3.60'],
        ],
      ],
      [
        ['BREAKFAST', 'DESAYUNO', 'CAFÉ DA MANHÃ'],
        [
          [['Avocado toast', 'Tostada con palta', 'Torrada com abacate'], '7.50'],
          [['Granola bowl', 'Bowl de granola', 'Tigela de granola'], '6.00'],
        ],
      ],
    ];
    const els: DesignElement[] = [
      k.text(60, 70, 674, ['Café Menu', 'Menú', 'Cardápio'], { font: 'dmserif', size: 80, color: '#fafaf9', align: 'center' }),
      k.line(297, 190, 200, '#d6a35c', 2),
    ];
    let y = 240;
    for (const [title, items] of sections) {
      els.push(k.text(60, y, 674, title, { font: 'montserrat', size: 22, weight: 700, color: '#d6a35c', letterSpacing: 6 }));
      y += 50;
      for (const [name, price] of items) {
        els.push(k.text(60, y, 480, name, { font: 'lora', size: 26, color: '#fafaf9' }));
        els.push(k.text(494, y, 240, price, { font: 'lora', size: 26, color: '#fafaf9', align: 'right' }));
        y += 52;
      }
      y += 40;
    }
    els.push(k.text(60, 1050, 674, ['Open every day, 8 AM to 6 PM', 'Abierto todos los días, de 8 a 18 h', 'Aberto todos os dias, das 8h às 18h'], { size: 20, color: '#a8a29e', align: 'center' }));
    return [{ bg: '#1c1917', els }];
  }),
  T('a4', 'a4-resume', ['Résumé', 'Currículum', 'Currículo'], (k) => [
    {
      bg: '#ffffff',
      els: [
        k.shape('rect', 0, 0, 250, 1123, '#f1f5f9'),
        k.frame(45, 60, 160, 160, 'circle'),
        k.text(40, 250, 180, ['CONTACT', 'CONTACTO', 'CONTATO'], { font: 'montserrat', size: 16, weight: 700, color: '#0f172a', letterSpacing: 3 }),
        k.text(40, 285, 190, 'you@email.com\n+1 555 0100\nyoursite.com', { size: 15, color: '#334155', lineHeight: 1.7 }),
        k.text(40, 420, 180, ['SKILLS', 'HABILIDADES', 'HABILIDADES'], { font: 'montserrat', size: 16, weight: 700, color: '#0f172a', letterSpacing: 3 }),
        k.text(40, 455, 190, ['Brand design\nTypography\nUser research\nPrototyping', 'Diseño de marca\nTipografía\nInvestigación\nPrototipos', 'Design de marca\nTipografia\nPesquisa\nProtótipos'], {
          size: 15,
          color: '#334155',
          lineHeight: 1.7,
        }),
        k.text(290, 70, 460, 'Alex Morgan', { font: 'montserrat', size: 52, weight: 800, color: '#0f172a' }),
        k.text(290, 140, 460, ['Product designer', 'Diseñador de producto', 'Designer de produto'], { size: 24, color: '#0369a1' }),
        k.text(290, 210, 460, ['EXPERIENCE', 'EXPERIENCIA', 'EXPERIÊNCIA'], { font: 'montserrat', size: 16, weight: 700, color: '#0f172a', letterSpacing: 3 }),
        k.text(290, 250, 460, ['Senior designer · Studio North', 'Diseñador senior · Studio North', 'Designer sênior · Studio North'], { size: 19, weight: 700, color: '#0f172a' }),
        k.text(290, 280, 460, ['2022 to today', '2022 a hoy', '2022 até hoje'], { size: 15, color: '#64748b' }),
        k.text(290, 308, 460, ['Led the redesign of the main product and built the design system used by four teams.', 'Lideró el rediseño del producto principal y armó el sistema de diseño que usan cuatro equipos.', 'Liderou o redesenho do produto principal e criou o sistema de design usado por quatro times.'], {
          size: 16,
          color: '#334155',
          lineHeight: 1.5,
        }),
        k.text(290, 420, 460, ['Designer · Brightside Agency', 'Diseñador · Brightside Agency', 'Designer · Brightside Agency'], { size: 19, weight: 700, color: '#0f172a' }),
        k.text(290, 450, 460, '2019 – 2022', { size: 15, color: '#64748b' }),
        k.text(290, 478, 460, ['Campaigns, websites and packaging for retail and food brands.', 'Campañas, sitios web y packaging para marcas de retail y comida.', 'Campanhas, sites e embalagens para marcas de varejo e comida.'], {
          size: 16,
          color: '#334155',
          lineHeight: 1.5,
        }),
        k.text(290, 600, 460, ['EDUCATION', 'FORMACIÓN', 'FORMAÇÃO'], { font: 'montserrat', size: 16, weight: 700, color: '#0f172a', letterSpacing: 3 }),
        k.text(290, 640, 460, ['BA in Graphic Design · City University', 'Lic. en Diseño Gráfico · Universidad de la Ciudad', 'Bacharelado em Design Gráfico · Universidade da Cidade'], { size: 19, weight: 700, color: '#0f172a' }),
        k.text(290, 670, 460, '2015 – 2019', { size: 15, color: '#64748b' }),
      ],
    },
  ]),

  // ---------- Presentación 16:9 (1920×1080) ----------
  T('presentation', 'deck-pitch', ['Pitch deck', 'Presentación para inversores', 'Apresentação para investidores'], (k) => {
    const cols: Array<[string, L, L]> = [
      ['bulb', ['The idea', 'La idea', 'A ideia'], ['What you noticed that nobody else solved.', 'Lo que viste que nadie resolvió.', 'O que você viu que ninguém resolveu.']],
      ['zap', ['How it works', 'Cómo funciona', 'Como funciona'], ['The product in one or two sentences.', 'El producto en una o dos oraciones.', 'O produto em uma ou duas frases.']],
      ['users', ['Who it is for', 'Para quién es', 'Para quem é'], ['The first customers and why they care.', 'Los primeros clientes y por qué les importa.', 'Os primeiros clientes e por que se importam.']],
    ];
    return [
      {
        bg: '#0b132b',
        els: [
          k.text(120, 360, 1600, ['Your company name', 'El nombre de tu empresa', 'O nome da sua empresa'], { font: 'montserrat', size: 120, weight: 800, color: '#ffffff' }),
          k.text(120, 540, 1400, ['A one-line description of what you do and for whom.', 'Una línea que diga qué hacés y para quién.', 'Uma linha que diga o que você faz e para quem.'], { size: 48, color: '#c4cbd8' }),
          k.shape('rect', 120, 780, 120, 12, '#5bc0be'),
          k.text(120, 830, 1200, ['Investor update · 2026', 'Novedades para inversores · 2026', 'Atualização para investidores · 2026'], { size: 32, color: '#5bc0be' }),
        ],
      },
      {
        bg: '#ffffff',
        els: [
          k.text(120, 120, 1680, ['The problem and our answer', 'El problema y nuestra respuesta', 'O problema e nossa resposta'], { font: 'montserrat', size: 72, weight: 800, color: '#0b132b' }),
          ...cols.flatMap(([icon, title, desc], i) => {
            const x = 120 + i * 570;
            return [
              k.icon(x, 380, 96, icon, '#5bc0be', 1.6),
              k.text(x, 520, 500, title, { font: 'montserrat', size: 40, weight: 700, color: '#0b132b' }),
              k.text(x, 590, 500, desc, { size: 30, color: '#4a5568', lineHeight: 1.4 }),
            ];
          }),
        ],
      },
      {
        bg: '#5bc0be',
        els: [
          k.text(120, 380, 1680, ['Thank you', 'Gracias', 'Obrigado'], { font: 'montserrat', size: 140, weight: 800, color: '#0b132b', align: 'center' }),
          k.text(120, 620, 1680, 'hello@yourcompany.com', { size: 44, color: '#0b132b', align: 'center' }),
        ],
      },
    ];
  }),
  T('presentation', 'deck-report', ['Quarterly report', 'Informe trimestral', 'Relatório trimestral'], (k) => {
    const kpis: Array<[string, L]> = [
      ['120', ['New customers', 'Clientes nuevos', 'Clientes novos']],
      ['8.4%', ['Conversion rate', 'Tasa de conversión', 'Taxa de conversão']],
      ['36', ['Campaigns shipped', 'Campañas lanzadas', 'Campanhas lançadas']],
    ];
    const agenda: L[] = [
      ['Results of the quarter', 'Resultados del trimestre', 'Resultados do trimestre'],
      ['What worked and what did not', 'Qué funcionó y qué no', 'O que funcionou e o que não'],
      ['Plan for next quarter', 'Plan para el próximo trimestre', 'Plano para o próximo trimestre'],
      ['Questions', 'Preguntas', 'Perguntas'],
    ];
    return [
      {
        bg: '#f8fafc',
        els: [
          k.shape('rect', 0, 0, 24, 1080, '#6366f1'),
          k.text(140, 130, 1600, ['Quarterly report', 'Informe trimestral', 'Relatório trimestral'], { font: 'montserrat', size: 96, weight: 800, color: '#0f172a' }),
          k.text(140, 280, 1600, ['Q3 · Marketing team', 'T3 · Equipo de marketing', 'T3 · Time de marketing'], { size: 40, color: '#6366f1' }),
          ...kpis.flatMap(([value, label], i) => {
            const x = 140 + i * 560;
            return [
              k.shape('rect', x, 520, 520, 360, '#ffffff', { stroke: '#e2e8f0', strokeWidth: 2, radius: 8 }),
              k.text(x + 50, 580, 420, value, { font: 'bebas', size: 140, color: '#0f172a', lineHeight: 1 }),
              k.text(x + 50, 760, 420, label, { size: 30, color: '#64748b' }),
            ];
          }),
        ],
      },
      {
        bg: '#ffffff',
        els: [
          k.text(140, 120, 1600, ['Agenda', 'Agenda', 'Agenda'], { font: 'montserrat', size: 80, weight: 800, color: '#0f172a' }),
          ...agenda.flatMap((item, i) => {
            const y = 330 + i * 160;
            return [
              k.text(140, y, 140, String(i + 1).padStart(2, '0'), { font: 'bebas', size: 90, color: '#6366f1', lineHeight: 1 }),
              k.text(300, y + 20, 1400, item, { size: 48, color: '#0f172a' }),
              k.line(140, y + 120, 1640, '#e2e8f0', 2),
            ];
          }),
        ],
      },
    ];
  }),
  T('presentation', 'deck-minimal', ['Minimal deck', 'Presentación minimalista', 'Apresentação minimalista'], (k) => [
    {
      bg: '#fafaf9',
      els: [
        k.text(160, 400, 1600, ['Minimal title', 'Título minimalista', 'Título minimalista'], { font: 'playfair', size: 140, color: '#1c1917' }),
        k.line(160, 640, 240, '#1c1917', 3),
        k.text(160, 690, 1400, ['Subtitle or presenter name', 'Subtítulo o nombre de quien presenta', 'Subtítulo ou nome de quem apresenta'], { size: 40, color: '#57534e' }),
      ],
    },
    {
      bg: '#1c1917',
      els: [
        k.text(160, 120, 400, '01', { font: 'bebas', size: 200, color: '#a8a29e', lineHeight: 1 }),
        k.text(160, 420, 1400, ['Section title goes here', 'El título de la sección va acá', 'O título da seção vai aqui'], { font: 'playfair', size: 110, color: '#fafaf9', lineHeight: 1.1 }),
        k.text(160, 680, 1200, ['A short line that sets up what comes next.', 'Una línea corta que anticipe lo que sigue.', 'Uma linha curta que antecipe o que vem depois.'], { size: 40, color: '#d6d3d1' }),
      ],
    },
  ]),

  // ---------- Logo (500×500) ----------
  T('logo', 'logo-badge', ['Round badge', 'Insignia redonda', 'Selo redondo'], (k) => [
    {
      bg: '#ffffff',
      els: [
        k.shape('ellipse', 50, 50, 400, 400, '#264653'),
        k.shape('ellipse', 72, 72, 356, 356, 'transparent', { stroke: '#e9c46a', strokeWidth: 4 }),
        k.text(50, 160, 400, 'AB', { font: 'playfair', size: 130, color: '#e9c46a', align: 'center', lineHeight: 1 }),
        k.text(50, 320, 400, 'STUDIO', { font: 'montserrat', size: 26, weight: 700, color: '#ffffff', align: 'center', letterSpacing: 8 }),
      ],
    },
  ]),
  T('logo', 'logo-wordmark', ['Wordmark', 'Logotipo', 'Logotipo'], (k) => [
    {
      bg: '#ffffff',
      els: [
        k.icon(50, 190, 120, 'leaf', '#2d6a4f', 1.6),
        k.text(190, 196, 290, 'verde', { font: 'montserrat', size: 84, weight: 800, color: '#1b4332', lineHeight: 1 }),
        k.text(195, 296, 290, 'GARDEN CO.', { size: 22, weight: 600, color: '#2d6a4f', letterSpacing: 5 }),
      ],
    },
  ]),
  T('logo', 'logo-monogram', ['Monogram', 'Monograma', 'Monograma'], (k) => [
    {
      bg: '#111111',
      els: [
        k.shape('rect', 100, 100, 300, 300, 'transparent', { stroke: '#ffffff', strokeWidth: 6 }),
        k.text(100, 150, 300, 'M', { font: 'bebas', size: 220, color: '#ffffff', align: 'center', lineHeight: 1 }),
        k.shape('diamond', 230, 380, 40, 40, '#f2c94c'),
      ],
    },
  ]),
];

export function findTemplate(id: string): DesignTemplate | undefined {
  return DESIGN_TEMPLATES.find((t) => t.id === id);
}

/** El diseño de una plantilla, con ids nuevos, en el idioma pedido. */
export function templateDoc(t: DesignTemplate, lang: string): DesignDoc {
  const size = presetSize(t.preset)!;
  const l: TemplateLocale = lang === 'es' || lang === 'pt' ? lang : 'en';
  return {
    v: 1,
    width: size.w,
    height: size.h,
    pages: t.build(l).map((p) => ({ id: newId('p'), background: { color: p.bg, image: null }, elements: p.els })),
  };
}

export function templateName(t: DesignTemplate, lang: string): string {
  return t.name[lang === 'es' ? 1 : lang === 'pt' ? 2 : 0];
}
