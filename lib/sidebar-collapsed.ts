// Estado colapsado del sidebar del shell (localStorage). Lo leen AppSidebar
// y un script inline del layout de la app, que pone la clase antes del primer
// paint: si no, en Notes (que arranca colapsado) el contenido saltaba a la
// izquierda al hidratar (layout shift).

export const STORAGE_COLLAPSED = 'zs-side-collapsed';

/** Ruta (sin idioma) que ya trae su propia columna de navegación. */
const DENSE_NOTES = /^\/app\/notes\/?$/;

/**
 * Rutas que ya traen su propia columna de navegación (Notes: libretas · lista ·
 * nota). Ahí el sidebar arranca colapsado y recuerda su estado aparte.
 */
export function denseRoute(pathname: string): string | null {
  return DENSE_NOTES.test(pathname) ? 'notes' : null;
}

export function storageKey(dense: string | null): string {
  return dense ? `${STORAGE_COLLAPSED}-${dense}` : STORAGE_COLLAPSED;
}

/** Colapsado según lo guardado; sin nada guardado, solo en las rutas densas. */
export function collapsedFrom(stored: string | null, dense: string | null): boolean {
  return stored == null ? dense != null : stored === '1';
}

/**
 * Script inline, primer hijo de .app-frame: misma regla que collapsedFrom con
 * el path de la URL (sin el prefijo de idioma).
 */
export const SIDEBAR_COLLAPSED_SCRIPT =
  "try{var p=location.pathname.replace(/^\\/[a-z]{2}(?=\\/)/,''),d=" +
  `${DENSE_NOTES.toString()}.test(p)?'notes':null,` +
  `v=localStorage.getItem('${STORAGE_COLLAPSED}'+(d?'-'+d:''));` +
  "if(v==null?d!=null:v==='1')document.currentScript.parentElement.classList.add('sidebar-collapsed')}catch(e){}";
