/**
 * Helpers puros del builder de formularios: claves técnicas derivadas de la
 * etiqueta, slug sugerido desde el nombre y en qué pestaña vive cada error de
 * la API (para abrirla y marcarla).
 */

export type BuilderTab = 'fields' | 'design' | 'after' | 'crm';

/** "Nombre y apellido" → "nombre_y_apellido" (sin tildes, máx. 30). */
export function fieldKeyFromLabel(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30) || 'field'
  );
}

/** La clave libre más cercana: base, base_2, base_3… */
export function uniqueFieldKey(fields: Array<{ id: string }>, base: string): string {
  const clean = fieldKeyFromLabel(base);
  let id = clean;
  let n = 2;
  while (fields.some((f) => f.id === id)) id = `${clean}_${n++}`;
  return id;
}

/** "Contacto web (2026)" → "contacto-web-2026": la URL propia sugerida. */
export function slugFromName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const ERROR_TABS: Record<string, BuilderTab> = {
  slug_taken: 'design',
  invalid_slug: 'design',
  invalid_field: 'fields',
  duplicate_field: 'fields',
  missing_options: 'fields',
  invalid_owner: 'crm',
  invalid_list: 'crm',
  invalid_sequence: 'crm',
  invalid_url: 'after',
  invalid_stage: 'crm',
};

export function builderTabForError(code: string): BuilderTab | null {
  return ERROR_TABS[code] ?? null;
}

/** Copy de un form nuevo en el idioma de la persona (el schema trae defaults en inglés). */
export function localizedFormDefaults(copy: {
  submit: string;
  success: string;
  email: string;
  firstName: string;
  lastName: string;
  emailPlaceholder: string;
}) {
  return {
    fields: [
      { id: 'email', type: 'email' as const, label: copy.email, property: 'email', required: true, placeholder: copy.emailPlaceholder },
      { id: 'first_name', type: 'text' as const, label: copy.firstName, property: 'firstName', required: false },
      { id: 'last_name', type: 'text' as const, label: copy.lastName, property: 'lastName', required: false },
    ],
    settings: { submitText: copy.submit, successMessage: copy.success },
  };
}
