import { isAdminEmail } from './feedback';
import { isWorkspaceAdmin, type SessionUser } from './session';
import { settingsRegistry, settingVisible, type SettingDef, type SettingsLocale } from './settings-registry';
import { buildSettingsIndex, registryFiles, SETTINGS_LOCALES, type MessagesByLocale } from './settings-search-index';
import { searchSettings, type SettingsSearchItem } from './settings-search';
import { userCanUseApp } from './workspace';

let messagesCache: Promise<MessagesByLocale> | null = null;

/** Los mensajes de los tres idiomas que usa el registro (una vez por proceso). */
function registryMessages(defs: SettingDef[]): Promise<MessagesByLocale> {
  messagesCache ??= (async () => {
    const files = registryFiles(defs);
    const out = { en: {}, es: {}, pt: {} } as MessagesByLocale;
    await Promise.all(
      SETTINGS_LOCALES.flatMap((locale) =>
        files.map(async (file) => {
          try {
            out[locale][file] = (await import(`../messages/${locale}/${file}.json`)).default;
          } catch {
            out[locale][file] = {};
          }
        }),
      ),
    );
    return out;
  })();
  return messagesCache;
}

function asLocale(locale: string): SettingsLocale {
  return (SETTINGS_LOCALES as string[]).includes(locale) ? (locale as SettingsLocale) : 'en';
}

/**
 * El índice de la búsqueda de Ajustes para una persona: solo lo que puede
 * abrir (rol del workspace, apps que tiene, Admin para ADMIN_EMAILS), con los
 * textos en su idioma y las palabras de los otros dos. Server-only.
 */
export async function settingsSearchIndex(user: SessionUser, locale: string): Promise<SettingsSearchItem[]> {
  const defs = settingsRegistry();
  const viewer = {
    role: user.role ?? 'owner',
    admin: isWorkspaceAdmin(user),
    staff: isAdminEmail(user.actingUser?.email ?? user.email),
    canUse: (app: Parameters<typeof userCanUseApp>[1]) => userCanUseApp(user, app),
  };
  const visible = defs.filter((d) => settingVisible(d, viewer));
  const messages = await registryMessages(defs);
  return buildSettingsIndex(visible, { locale: asLocale(locale), messages, workspace: user.workspace?.name ?? user.team?.name ?? '' });
}

/**
 * Los mejores ajustes puntuales para ⌘K. Las páginas de cada sección y de cada
 * app ya están en la paleta ("Ajustes: Apariencia", "Ajustes de Lines").
 */
export async function searchSettingsFor(user: SessionUser, locale: string, q: string, limit = 6): Promise<SettingsSearchItem[]> {
  const index = (await settingsSearchIndex(user, locale)).filter((i) => !i.id.startsWith('section-') && !i.id.startsWith('product-'));
  return searchSettings(index, q, limit).map((h) => h.item);
}
