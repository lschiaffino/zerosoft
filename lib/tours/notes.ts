import type { TourDef } from './index';

/**
 * Tour de Notes (como Evernote). Textos en common.json › tour.notes.
 * Notes es de cada persona (compartir es por nota o libreta): no hay pasos de
 * equipo ni pregunta "sola o con un equipo".
 * Anclajes `data-tour`:
 *   notes-new        components/notes/NotesApp.tsx (Nueva nota del lateral; en el teléfono, el + de la lista)
 *   notes-notebooks  components/notes/NotesApp.tsx (Libretas en el lateral de Notes)
 *   notes-search     components/notes/NotesApp.tsx (buscador de la lista)
 *   notes-item       components/notes/NotesApp.tsx (cada nota de la lista; gana la primera)
 *   notes-note-bar   components/notes/NoteEditorPane.tsx (barra de la nota: libreta, grabar, fijar, recordatorio, compartir)
 *   notes-tags       components/notes/NoteEditorPane.tsx (etiquetas de la nota)
 * En el teléfono se ve un panel por vez (lateral, lista o nota): el paso de
 * libretas se saltea y los de la nota aparecen después de abrir una. Sin
 * notas, abrir una y los pasos de la nota se saltean.
 */
export const NOTES_TOUR = {
  key: 'notes',
  startPath: '/app/notes',
  paths: ['/app/notes'],
  steps: [
    { id: 'intro' },
    { id: 'newNote', targets: ['notes-new'] },
    { id: 'notebooks', targets: ['notes-notebooks'] },
    { id: 'search', targets: ['notes-search'] },
    { id: 'openNote', targets: ['notes-item'], advanceOn: 'click' },
    { id: 'noteBar', targets: ['notes-note-bar'] },
    { id: 'tags', targets: ['notes-tags'] },
    { id: 'shortcuts' },
    { id: 'done' },
  ],
} as const satisfies TourDef;
