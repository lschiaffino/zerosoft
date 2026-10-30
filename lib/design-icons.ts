/**
 * Íconos de línea de Design (propios, sin assets de terceros). Cada uno es un
 * trazo SVG en una grilla de 24×24 que se dibuja con stroke: lo usan el SVG
 * del editor y canvas (Path2D) al exportar.
 */

const circle = (cx: number, cy: number, r: number) => `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0`;

export const DESIGN_ICONS: Record<string, string> = {
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  'check-circle': `${circle(12, 12, 9)} M8 12.5l3 3 5-6`,
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  'arrow-right': 'M4 12h15M13 6l6 6-6 6',
  'arrow-up-right': 'M7 17L17 7M9 7h8v8',
  'arrow-down': 'M12 4v15M6 13l6 6 6-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  'map-pin': `M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z ${circle(12, 10, 2.5)}`,
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
  clock: `${circle(12, 12, 9)} M12 7v5l3.5 2`,
  user: `${circle(12, 8, 4)} M4 21a8 8 0 0 1 16 0`,
  users: `${circle(9, 8, 3.5)} M2.5 20a6.5 6.5 0 0 1 13 0 M16 4.5a3.5 3.5 0 0 1 0 7 M18 13.5a6.5 6.5 0 0 1 3.5 6.5`,
  home: 'M3 11l9-7 9 7 M5 9.5V20h5v-6h4v6h5V9.5',
  search: `${circle(10.5, 10.5, 6.5)} M15.5 15.5L21 21`,
  bell: 'M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15z M10 21h4',
  camera: `M3 7h4l2-3h6l2 3h4v13H3z ${circle(12, 13, 4)}`,
  image: `M3 4h18v16H3z ${circle(8.5, 9, 1.8)} M21 16l-5-5-9 9`,
  music: `M9 18V5l11-2v13 ${circle(6.5, 18, 2.5)} ${circle(17.5, 16, 2.5)}`,
  play: `${circle(12, 12, 9)} M10 8.5v7l6-3.5z`,
  gift: 'M3 9h18v4H3z M5 13v8h14v-8 M12 9v12 M12 9S10.5 4 8 4a2.5 2.5 0 0 0 0 5 M12 9s1.5-5 4-5a2.5 2.5 0 0 1 0 5',
  bag: 'M5 8h14l-1 13H6z M9 8V6a3 3 0 0 1 6 0v2',
  cart: `M3 4h2.5l2.2 11h10.6L20.5 7H6.6 ${circle(9, 19.5, 1.5)} ${circle(17, 19.5, 1.5)}`,
  tag: `M3 12V3h9l9 9-9 9z ${circle(7.5, 7.5, 1.5)}`,
  chat: 'M4 5h16v11H9l-5 4z',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  sun: `${circle(12, 12, 4)} M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8`,
  moon: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  leaf: 'M5 19C5 10 10 5 20 4c0 9-5 15-13 15z M5 19l8-8',
  coffee: 'M4 8h13v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z M17 10h1.5a2.5 2.5 0 0 1 0 5H17 M8 2.5v3M12 2.5v3',
  globe: `${circle(12, 12, 9)} M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18`,
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  rocket: `M12 15l-3-3c1.5-5 5-8.5 11-9-.5 6-4 9.5-8 12z M9 12l-4 1-2 3 4 .5 M12 15l-1 4-3 2-.5-4 ${circle(15, 9, 1.5)}`,
  bulb: 'M9 18h6 M10 21h4 M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z',
  trophy: 'M7 4h10v5a5 5 0 0 1-10 0z M7 6H4a3 3 0 0 0 3 4 M17 6h3a3 3 0 0 1-3 4 M12 14v4 M8 21h8 M9 18h6',
  chart: 'M4 20h16 M7 16v-5 M12 16V7 M17 16v-8',
  trend: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
  smile: `${circle(12, 12, 9)} M8 14.5a5 5 0 0 0 8 0 M9 9.5h.01 M15 9.5h.01`,
  flag: 'M5 21V4 M5 4h12l-2 4 2 4H5',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  download: 'M12 4v11 M7 10l5 5 5-5 M4 20h16',
  quote: 'M5 11h5v7H4v-5c0-4 2-6 5-7 M14 11h5v7h-6v-5c0-4 2-6 5-7',
  megaphone: 'M3 10v4h3l9 5V5L6 10z M18 9a4 4 0 0 1 0 6 M6 14l1 5h2.5l-1-5',
  briefcase: 'M3 7h18v13H3z M8 7V4h8v3 M3 12h18',
  zap: 'M13 2L4 14h7l-1 8 9-12h-7z',
};

export const DESIGN_ICON_NAMES = Object.keys(DESIGN_ICONS);

export function iconPath(name: string): string | null {
  return Object.prototype.hasOwnProperty.call(DESIGN_ICONS, name) ? DESIGN_ICONS[name] : null;
}
