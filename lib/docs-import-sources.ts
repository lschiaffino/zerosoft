/** Fuentes del import de Docs (las usan la página del servidor y el panel del cliente). */
export const IMPORT_SOURCES = ['notion', 'confluence', 'gdocs', 'word', 'evernote', 'files'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
