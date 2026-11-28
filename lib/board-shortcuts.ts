/**
 * Atajos propios de Board (los que agregamos encima de Excalidraw). La hoja del
 * editor los lista; los textos viven en messages/<locale>/board.json bajo
 * `shortcuts.items.<id>`. Cada alternativa de teclas es una combinación.
 */
export interface BoardShortcut {
  id: string;
  /** Alternativas: cada una es una combinación (teclas que se pulsan juntas). */
  keys: string[][];
}

export interface BoardShortcutGroup {
  id: 'stickies' | 'canvas' | 'present';
  items: BoardShortcut[];
}

export const BOARD_SHORTCUTS: BoardShortcutGroup[] = [
  {
    id: 'stickies',
    items: [
      { id: 'newSticky', keys: [['N']] },
      { id: 'nextRight', keys: [['Tab']] },
      { id: 'nextBelow', keys: [['Shift', 'Tab']] },
      { id: 'nextDirection', keys: [['Alt', '←'], ['Alt', '→'], ['Alt', '↑'], ['Alt', '↓']] },
    ],
  },
  {
    id: 'canvas',
    items: [
      { id: 'minimap', keys: [['M']] },
      { id: 'stopFollowing', keys: [['Esc']] },
    ],
  },
  {
    id: 'present',
    items: [
      { id: 'nextSlide', keys: [['→'], ['Space'], ['Enter']] },
      { id: 'prevSlide', keys: [['←'], ['Backspace']] },
      { id: 'firstLast', keys: [['Home'], ['End']] },
      { id: 'exitPresent', keys: [['Esc']] },
    ],
  },
];
