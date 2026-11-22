import Foundation

/// The native strings of block 1 in en, es and pt. Block 11 moves every string to
/// desktop/strings.json (shared with the Tauri app); until then they live here, where a test
/// checks that each key has all three languages.
public enum Lang: String, CaseIterable, Sendable {
    case en
    case es
    case pt

    /// The first of the person's preferred languages we have (`Locale.preferredLanguages`,
    /// e.g. "es-AR", "pt-BR"), English otherwise.
    public static func pick(_ preferred: [String]) -> Lang {
        for tag in preferred {
            let base = tag.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? ""
            if let lang = Lang(rawValue: base) { return lang }
        }
        return .en
    }
}

public enum StringKey: String, CaseIterable, Sendable {
    case errorTitle
    case reasonOffline
    case reasonUnreachable
    case reasonTimeout
    case reasonTLS
    case reasonServer
    case reasonBlank
    case reasonCrashed
    case reasonOther
    case reasonCode
    case retry
    case openInBrowser
    case loading
    case ok
    case cancel
    case menuAbout
    case menuHide
    case menuHideOthers
    case menuShowAll
    case menuQuit
    case menuEdit
    case menuUndo
    case menuRedo
    case menuCut
    case menuCopy
    case menuPaste
    case menuSelectAll
    case menuView
    case menuReload
    case menuWindow
    case menuMinimize
    case menuClose
    case menuFile
    case menuNewTab
    case menuNewWindow
    case menuReopenTab
    case menuCloseTab
    case menuCloseWindow
    case menuNextTab
    case menuPrevTab
    case menuZoom
    case menuBack
    case menuForward
    case menuDuplicateTab
    case menuMoveToNewWindow
    case menuCloseOtherTabs
    case menuOpenInNewTab
    case menuOpenInNewWindow
    case menuCopyLink
    case tabSuspended
    case tabRecording
    case tabUnread
    case tabsLabel
    case tabNewTitle
    case menuSettings
    case statusOpen
    case statusUnread
    case statusSignIn
    case statusSignOut
    case settingsTitle
    case secGeneral
    case secTabs
    case secNotifications
    case secVoice
    case secDictionary
    case secHistory
    case secAccount
    case loginItem
    case loginItemHelp
    case loginItemApproval
    case loginItemUnavailable
    case loginItemFailed
    case openLoginItems
    case menuBarItem
    case menuBarItemHelp
    case showOnboarding
    case serverLabel
    case lockdownLabel
    case stateOn
    case stateOff
    case webSettings
    case openWebSettings
    case tabsSuspend
    case tabsSuspendHelp
    case tabsSuspendAfter
    case durMinutes
    case durHours
    case tabsRestore
    case tabsLinks
    case linksTab
    case linksWindow
    case notifHelp
    case notifAllowed
    case notifDenied
    case notifNotDetermined
    case notifTurnOn
    case notifOpenSystem
    case voiceHelp
    case voiceLanguage
    case langAuto
    case voiceCleanup
    case cleanRaw
    case cleanClean
    case cleanFormal
    case cleanPerApp
    case voiceDepth
    case depthLight
    case depthStandard
    case depthThorough
    case voiceAI
    case dictHelp
    case dictKind
    case kindWord
    case kindReplace
    case kindSnippet
    case dictPhrase
    case dictReplacement
    case dictAdd
    case dictDelete
    case dictEmpty
    case dictTeam
    case historyHelp
    case historyEmpty
    case copied
    case accountSignedIn
    case accountSignedOut
    case signIn
    case signOut
    case remoteSignedOut
    case remoteOffline
    case remoteFailed
    case loadingShort
    case saved
    case saveFailed
    case obWelcomeTitle
    case obWelcomeBody
    case obNotifTitle
    case obNotifBody
    case obNotLater
    case obStartupTitle
    case obStartupBody
    case obDoneTitle
    case obDoneBody
    case hudListening
    case hudHandsFree
    case hudHandsFreeHint
    case hudEscHint
    case hudWorking
    case hudSending
    case hudPasted
    case hudCopied
    case hudMicOff
    case hudMicBusy
    case hudMicReady
    case errFailed
    case errOffline
    case errSignedOut
    case errRateLimited
    case errServer
    case errTooLarge
    case errEmpty
    case errOtherServer
    case savedToRetry
    case noRecent
    case statusDictate
    case statusRecording
    case statusDictateStop
    case statusDictateHint
    case statusPasteLast
    case statusRetry
    case statusHistory
    case secPermissions
    case permHelp
    case permMic
    case permMicHelp
    case micAllowed
    case micDenied
    case micNotDetermined
    case micTurnOn
    case permAccess
    case permAccessHelp
    case accessAllowed
    case accessOff
    case accessUnavailable
    case accessAllow
    case accessAfter
    case dictShortcut
    case dictShortcutHelp
    case dictShortcutTaken
    case dictMode
    case modeBoth
    case modeHold
    case modeToggle
    case dictAutoPaste
    case dictAutoPasteHelp
    case dictRestore
    case dictSendApp
    case dictSendAppHelp
    case dictKeep
    case dictKeepHelp
    case dictAccount
    case historyPaste
    case historyPasteHelp
    case pendingTitle
    case pendingHelp
    case pendingSend
    case obDictTitle
    case obDictBody
    case obMicBody
    case obPasteBody
    case obCopyBody
    case next
    case back
    case done
}

public enum Strings {
    static let table: [Lang: [StringKey: String]] = [
        .en: [
            .errorTitle: "zerosoft could not open",
            .reasonOffline: "This Mac is offline. The page opens by itself when the connection is back.",
            .reasonUnreachable: "Could not reach {host}. Check the address or try again in a moment.",
            .reasonTimeout: "The server took too long to answer.",
            .reasonTLS: "The secure connection to the server failed.",
            .reasonServer: "The server answered with an error ({status}).",
            .reasonBlank: "The page loaded but did not draw anything.",
            .reasonCrashed: "The page stopped working twice in a minute.",
            .reasonOther: "The page could not be loaded.",
            .reasonCode: "Reason: {code}",
            .retry: "Retry",
            .openInBrowser: "Open in browser",
            .loading: "Loading zerosoft",
            .ok: "OK",
            .cancel: "Cancel",
            .menuAbout: "About zerosoft",
            .menuHide: "Hide zerosoft",
            .menuHideOthers: "Hide Others",
            .menuShowAll: "Show All",
            .menuQuit: "Quit zerosoft",
            .menuEdit: "Edit",
            .menuUndo: "Undo",
            .menuRedo: "Redo",
            .menuCut: "Cut",
            .menuCopy: "Copy",
            .menuPaste: "Paste",
            .menuSelectAll: "Select All",
            .menuView: "View",
            .menuReload: "Reload",
            .menuWindow: "Window",
            .menuMinimize: "Minimize",
            .menuClose: "Close",
            .menuFile: "File",
            .menuNewTab: "New Tab",
            .menuNewWindow: "New Window",
            .menuReopenTab: "Reopen Closed Tab",
            .menuCloseTab: "Close Tab",
            .menuCloseWindow: "Close Window",
            .menuNextTab: "Show Next Tab",
            .menuPrevTab: "Show Previous Tab",
            .menuZoom: "Zoom",
            .menuBack: "Back",
            .menuForward: "Forward",
            .menuDuplicateTab: "Duplicate Tab",
            .menuMoveToNewWindow: "Move Tab to New Window",
            .menuCloseOtherTabs: "Close Other Tabs",
            .menuOpenInNewTab: "Open in New Tab",
            .menuOpenInNewWindow: "Open in New Window",
            .menuCopyLink: "Copy Link",
            .tabSuspended: "Asleep to save memory. Opens again when you click it.",
            .tabRecording: "Recording",
            .tabUnread: "New activity",
            .tabsLabel: "Tabs",
            .tabNewTitle: "New tab",
            .menuSettings: "Settings…",
            .statusOpen: "Open zerosoft",
            .statusUnread: "{n} new",
            .statusSignIn: "Sign In…",
            .statusSignOut: "Sign Out",
            .settingsTitle: "Settings",
            .secGeneral: "General",
            .secTabs: "Tabs",
            .secNotifications: "Notifications",
            .secVoice: "Dictation",
            .secDictionary: "Dictionary",
            .secHistory: "History",
            .secAccount: "Account",
            .loginItem: "Open zerosoft at login",
            .loginItemHelp: "Off until you turn it on.",
            .loginItemApproval: "Allow zerosoft in System Settings › General › Login Items.",
            .loginItemUnavailable: "macOS cannot add this copy of zerosoft to the login items. Move it to Applications and try again.",
            .loginItemFailed: "Could not change it. Try again.",
            .openLoginItems: "Open Login Items",
            .menuBarItem: "Show zerosoft in the menu bar",
            .menuBarItemHelp: "Open your windows, a new tab or Settings even with every window closed.",
            .showOnboarding: "Show the welcome again",
            .serverLabel: "Server",
            .lockdownLabel: "Lockdown Mode restrictions in pages",
            .stateOn: "On",
            .stateOff: "Off",
            .webSettings: "Your account, workspace and apps have their settings in zerosoft itself.",
            .openWebSettings: "Open those settings in a tab",
            .tabsSuspend: "Put tabs to sleep when they are not used",
            .tabsSuspendHelp: "A tab in pause frees memory and loads again when you click it. Tabs with a call or a recording never pause.",
            .tabsSuspendAfter: "After",
            .durMinutes: "{n} min",
            .durHours: "{n} h",
            .tabsRestore: "Reopen your windows and tabs at launch",
            .tabsLinks: "Cmd-click on a link opens",
            .linksTab: "A tab behind this one",
            .linksWindow: "A new window",
            .notifHelp: "New messages, mentions and reminders while zerosoft is in the background. Click one to open it.",
            .notifAllowed: "Notifications are on.",
            .notifDenied: "Notifications for zerosoft are off in System Settings.",
            .notifNotDetermined: "Notifications are not on yet. macOS asks you once when you turn them on.",
            .notifTurnOn: "Turn on notifications",
            .notifOpenSystem: "Open System Settings",
            .voiceHelp: "Your dictation settings are saved in your account and apply on every device.",
            .voiceLanguage: "Language",
            .langAuto: "Detect automatically",
            .voiceCleanup: "Style",
            .cleanRaw: "As spoken",
            .cleanClean: "Clean",
            .cleanFormal: "Formal",
            .cleanPerApp: "Depends on the app",
            .voiceDepth: "How much to clean",
            .depthLight: "Light",
            .depthStandard: "Standard",
            .depthThorough: "Thorough",
            .voiceAI: "Clean up with AI",
            .dictHelp: "Words dictation should write your way, and what to write when it hears a phrase.",
            .dictKind: "Type",
            .kindWord: "Word",
            .kindReplace: "Replacement",
            .kindSnippet: "Snippet",
            .dictPhrase: "Phrase",
            .dictReplacement: "Writes",
            .dictAdd: "Add",
            .dictDelete: "Delete",
            .dictEmpty: "No words yet.",
            .dictTeam: "Team",
            .historyHelp: "Your last 50 dictations.",
            .historyEmpty: "No dictations yet.",
            .copied: "Copied",
            .accountSignedIn: "Signed in as {email}",
            .accountSignedOut: "Not signed in.",
            .signIn: "Sign in",
            .signOut: "Sign out",
            .remoteSignedOut: "Sign in to see this.",
            .remoteOffline: "Could not reach the server.",
            .remoteFailed: "Something went wrong. Try again.",
            .loadingShort: "Loading…",
            .saved: "Saved",
            .saveFailed: "Not saved. Try again.",
            .obWelcomeTitle: "Welcome to zerosoft",
            .obWelcomeBody: "Your apps in native windows and tabs, an item in the menu bar, notifications with a count on the Dock, and dictation in any app.",
            .obNotifTitle: "Get notified",
            .obNotifBody: "zerosoft can tell you about new messages, mentions and reminders while it is in the background. macOS asks you once, and you can change it in Settings.",
            .obNotLater: "Not now",
            .obStartupTitle: "Start with your Mac",
            .obStartupBody: "Both are optional and can be changed in Settings.",
            .obDoneTitle: "All set",
            .obDoneBody: "Sign in to see your workspace. zerosoft is in the Dock and the menu bar whenever you need it.",
            .hudListening: "Listening",
            .hudHandsFree: "Hands-free",
            .hudHandsFreeHint: "{key} to finish",
            .hudEscHint: "Esc cancels",
            .hudWorking: "Cleaning up",
            .hudSending: "Sending",
            .hudPasted: "Pasted",
            .hudCopied: "Copied. Paste with {key}",
            .hudMicOff: "Microphone access is off",
            .hudMicBusy: "Could not open the microphone",
            .hudMicReady: "Microphone on. Press {key} to dictate",
            .errFailed: "Dictation failed",
            .errOffline: "No connection",
            .errSignedOut: "Sign in to zerosoft to dictate",
            .errRateLimited: "Too many dictations in a row",
            .errServer: "The server did not answer",
            .errTooLarge: "The recording is too long",
            .errEmpty: "Nothing heard",
            .errOtherServer: "Recorded for another server",
            .savedToRetry: "Saved to send again",
            .noRecent: "No dictation to paste yet",
            .statusRecording: "zerosoft: microphone on (dictation)",
            .statusDictate: "Start dictation",
            .statusDictateStop: "Stop dictation",
            .statusDictateHint: "Dictate: hold {key}",
            .statusPasteLast: "Paste last dictation",
            .statusRetry: "Send saved dictations again ({n})",
            .statusHistory: "Dictation history…",
            .secPermissions: "Permissions",
            .permHelp: "What zerosoft may use on this Mac. macOS asks once for each, only when you press its button or first use it.",
            .permMic: "Microphone",
            .permMicHelp: "To record what you dictate, from the shortcut until you let go, tap again or reach 2 minutes.",
            .micAllowed: "The microphone is on.",
            .micDenied: "The microphone is off for zerosoft in System Settings.",
            .micNotDetermined: "Not asked yet. macOS asks the first time you dictate, or now with the button.",
            .micTurnOn: "Turn on the microphone",
            .permAccess: "Accessibility",
            .permAccessHelp: "Only to send the paste keystroke (⌘V), so dictated text lands in the app in front. zerosoft does not read other apps. Dictation works without it: the text is copied and you paste it.",
            .accessAllowed: "Pasting is on.",
            .accessOff: "Not allowed. Dictated text is copied and you paste it with ⌘V.",
            .accessUnavailable: "This version copies dictated text and you paste it with ⌘V.",
            .accessAllow: "Allow pasting",
            .accessAfter: "If you turned zerosoft on in the list, come back here: it is checked again when this window opens.",
            .dictShortcut: "Dictation shortcut",
            .dictShortcutHelp: "Hold it in any app, speak and let go: the clean text goes where the cursor is.",
            .dictShortcutTaken: "Another app already uses this shortcut. Pick another one.",
            .dictMode: "How to dictate",
            .modeBoth: "Hold to talk, or tap once to start and again to finish",
            .modeHold: "Only hold to talk",
            .modeToggle: "Only tap to start and stop",
            .dictAutoPaste: "Paste into the app in front",
            .dictAutoPasteHelp: "Needs Accessibility (Settings › Permissions). Off: the text is copied and you press ⌘V.",
            .dictRestore: "Put back what was on the clipboard after pasting",
            .dictSendApp: "Send the name of the app in front with each dictation",
            .dictSendAppHelp: "The server uses it to pick the tone (email, chat, note) and shows it in your history. Off: zerosoft does not read it.",
            .dictKeep: "Keep dictations that could not be sent",
            .dictKeepHelp: "Saves the audio on this Mac, not encrypted, for up to 7 days so you can send it again. Off: a dictation that fails is lost.",
            .dictAccount: "In your account",
            .historyPaste: "Paste",
            .historyPasteHelp: "Paste puts the text in the app you were using before opening this window.",
            .pendingTitle: "Not sent yet",
            .pendingHelp: "{n} recorded without a connection or a session. Send them again: the text is copied and saved in your history.",
            .pendingSend: "Send again",
            .obDictTitle: "Dictate in any app",
            .obDictBody: "Hold {key} in any app, speak and let go: the clean text goes where the cursor is. A quick tap keeps listening until you tap again, and Esc cancels.",
            .obMicBody: "macOS asks for the microphone the first time you dictate, or now with the button.",
            .obPasteBody: "To paste for you, zerosoft needs Accessibility, only for the paste keystroke. Without it the text is copied and you press ⌘V.",
            .obCopyBody: "The text is copied and you paste it with ⌘V.",
            .next: "Continue",
            .back: "Back",
            .done: "Done",
        ],
        .es: [
            .errorTitle: "zerosoft no pudo abrir",
            .reasonOffline: "Esta Mac no tiene conexión. La página se abre sola cuando vuelva.",
            .reasonUnreachable: "No se pudo llegar a {host}. Revisá la dirección o probá de nuevo en un momento.",
            .reasonTimeout: "El servidor tardó demasiado en responder.",
            .reasonTLS: "Falló la conexión segura con el servidor.",
            .reasonServer: "El servidor respondió con un error ({status}).",
            .reasonBlank: "La página cargó pero no dibujó nada.",
            .reasonCrashed: "La página dejó de funcionar dos veces en un minuto.",
            .reasonOther: "No se pudo cargar la página.",
            .reasonCode: "Motivo: {code}",
            .retry: "Reintentar",
            .openInBrowser: "Abrir en el navegador",
            .loading: "Cargando zerosoft",
            .ok: "Aceptar",
            .cancel: "Cancelar",
            .menuAbout: "Acerca de zerosoft",
            .menuHide: "Ocultar zerosoft",
            .menuHideOthers: "Ocultar otros",
            .menuShowAll: "Mostrar todo",
            .menuQuit: "Salir de zerosoft",
            .menuEdit: "Edición",
            .menuUndo: "Deshacer",
            .menuRedo: "Rehacer",
            .menuCut: "Cortar",
            .menuCopy: "Copiar",
            .menuPaste: "Pegar",
            .menuSelectAll: "Seleccionar todo",
            .menuView: "Visualización",
            .menuReload: "Volver a cargar",
            .menuWindow: "Ventana",
            .menuMinimize: "Minimizar",
            .menuClose: "Cerrar",
            .menuFile: "Archivo",
            .menuNewTab: "Pestaña nueva",
            .menuNewWindow: "Ventana nueva",
            .menuReopenTab: "Volver a abrir la pestaña cerrada",
            .menuCloseTab: "Cerrar pestaña",
            .menuCloseWindow: "Cerrar ventana",
            .menuNextTab: "Pestaña siguiente",
            .menuPrevTab: "Pestaña anterior",
            .menuZoom: "Zoom",
            .menuBack: "Atrás",
            .menuForward: "Adelante",
            .menuDuplicateTab: "Duplicar pestaña",
            .menuMoveToNewWindow: "Mover a una ventana nueva",
            .menuCloseOtherTabs: "Cerrar las otras pestañas",
            .menuOpenInNewTab: "Abrir en pestaña nueva",
            .menuOpenInNewWindow: "Abrir en ventana nueva",
            .menuCopyLink: "Copiar link",
            .tabSuspended: "En pausa para ahorrar memoria. Vuelve a cargar al tocarla.",
            .tabRecording: "Grabando",
            .tabUnread: "Hay novedades",
            .tabsLabel: "Pestañas",
            .tabNewTitle: "Pestaña nueva",
            .menuSettings: "Ajustes…",
            .statusOpen: "Abrir zerosoft",
            .statusUnread: "{n} nuevos",
            .statusSignIn: "Iniciar sesión…",
            .statusSignOut: "Cerrar sesión",
            .settingsTitle: "Ajustes",
            .secGeneral: "General",
            .secTabs: "Pestañas",
            .secNotifications: "Notificaciones",
            .secVoice: "Dictado",
            .secDictionary: "Diccionario",
            .secHistory: "Historial",
            .secAccount: "Cuenta",
            .loginItem: "Abrir zerosoft al iniciar sesión en la Mac",
            .loginItemHelp: "Está apagado hasta que lo prendas.",
            .loginItemApproval: "Permití zerosoft en Ajustes del Sistema › General › Ítems de inicio.",
            .loginItemUnavailable: "macOS no puede sumar esta copia de zerosoft a los ítems de inicio. Movela a Aplicaciones y probá de nuevo.",
            .loginItemFailed: "No se pudo cambiar. Probá de nuevo.",
            .openLoginItems: "Abrir Ítems de inicio",
            .menuBarItem: "Mostrar zerosoft en la barra de menú",
            .menuBarItemHelp: "Abrí tus ventanas, una pestaña nueva o los Ajustes aunque no haya ninguna ventana abierta.",
            .showOnboarding: "Ver la bienvenida otra vez",
            .serverLabel: "Servidor",
            .lockdownLabel: "Restricciones del Modo de Aislamiento en las páginas",
            .stateOn: "Activadas",
            .stateOff: "Desactivadas",
            .webSettings: "Tu cuenta, tu workspace y tus apps tienen sus ajustes en zerosoft.",
            .openWebSettings: "Abrir esos ajustes en una pestaña",
            .tabsSuspend: "Poner en pausa las pestañas que no se usan",
            .tabsSuspendHelp: "Una pestaña en pausa libera memoria y vuelve a cargar al tocarla. Las pestañas con una llamada o una grabación nunca se pausan.",
            .tabsSuspendAfter: "Después de",
            .durMinutes: "{n} min",
            .durHours: "{n} h",
            .tabsRestore: "Volver a abrir tus ventanas y pestañas al abrir la app",
            .tabsLinks: "Cmd-clic en un link abre",
            .linksTab: "Una pestaña detrás de esta",
            .linksWindow: "Una ventana nueva",
            .notifHelp: "Mensajes nuevos, menciones y recordatorios mientras zerosoft está en segundo plano. Tocá uno para abrirlo.",
            .notifAllowed: "Las notificaciones están activadas.",
            .notifDenied: "Las notificaciones de zerosoft están desactivadas en Ajustes del Sistema.",
            .notifNotDetermined: "Las notificaciones todavía no están activadas. macOS te pregunta una vez cuando las activás.",
            .notifTurnOn: "Activar notificaciones",
            .notifOpenSystem: "Abrir Ajustes del Sistema",
            .voiceHelp: "Tus ajustes de dictado se guardan en tu cuenta y valen en todos tus dispositivos.",
            .voiceLanguage: "Idioma",
            .langAuto: "Detectar solo",
            .voiceCleanup: "Estilo",
            .cleanRaw: "Tal cual se dijo",
            .cleanClean: "Limpio",
            .cleanFormal: "Formal",
            .cleanPerApp: "Según la app",
            .voiceDepth: "Cuánto limpiar",
            .depthLight: "Poco",
            .depthStandard: "Normal",
            .depthThorough: "A fondo",
            .voiceAI: "Limpiar con IA",
            .dictHelp: "Palabras que el dictado tiene que escribir a tu manera, y qué escribir cuando escucha una frase.",
            .dictKind: "Tipo",
            .kindWord: "Palabra",
            .kindReplace: "Reemplazo",
            .kindSnippet: "Fragmento",
            .dictPhrase: "Frase",
            .dictReplacement: "Escribe",
            .dictAdd: "Agregar",
            .dictDelete: "Borrar",
            .dictEmpty: "Todavía no hay palabras.",
            .dictTeam: "Equipo",
            .historyHelp: "Tus últimos 50 dictados.",
            .historyEmpty: "Todavía no hay dictados.",
            .copied: "Copiado",
            .accountSignedIn: "Sesión iniciada como {email}",
            .accountSignedOut: "No iniciaste sesión.",
            .signIn: "Iniciar sesión",
            .signOut: "Cerrar sesión",
            .remoteSignedOut: "Iniciá sesión para ver esto.",
            .remoteOffline: "No se pudo llegar al servidor.",
            .remoteFailed: "Algo falló. Probá de nuevo.",
            .loadingShort: "Cargando…",
            .saved: "Guardado",
            .saveFailed: "No se guardó. Probá de nuevo.",
            .obWelcomeTitle: "Te damos la bienvenida a zerosoft",
            .obWelcomeBody: "Tus apps en ventanas y pestañas nativas, un ícono en la barra de menú, notificaciones con el contador en el Dock y dictado en cualquier app.",
            .obNotifTitle: "Enterate a tiempo",
            .obNotifBody: "zerosoft te puede avisar de mensajes nuevos, menciones y recordatorios mientras está en segundo plano. macOS te pregunta una vez, y lo podés cambiar en Ajustes.",
            .obNotLater: "Ahora no",
            .obStartupTitle: "Empezar con tu Mac",
            .obStartupBody: "Las dos son opcionales y se cambian en Ajustes.",
            .obDoneTitle: "Listo",
            .obDoneBody: "Iniciá sesión para ver tu workspace. zerosoft está en el Dock y en la barra de menú cuando lo necesites.",
            .hudListening: "Escuchando",
            .hudHandsFree: "Manos libres",
            .hudHandsFreeHint: "{key} para terminar",
            .hudEscHint: "Esc cancela",
            .hudWorking: "Limpiando",
            .hudSending: "Mandando",
            .hudPasted: "Pegado",
            .hudCopied: "Copiado. Pegalo con {key}",
            .hudMicOff: "El micrófono no tiene permiso",
            .hudMicBusy: "No se pudo abrir el micrófono",
            .hudMicReady: "Micrófono activado. Tocá {key} para dictar",
            .errFailed: "No se pudo dictar",
            .errOffline: "Sin conexión",
            .errSignedOut: "Iniciá sesión en zerosoft para dictar",
            .errRateLimited: "Demasiados dictados seguidos",
            .errServer: "El servidor no respondió",
            .errTooLarge: "La grabación es demasiado larga",
            .errEmpty: "No se escuchó nada",
            .errOtherServer: "Grabado para otro servidor",
            .savedToRetry: "Guardado para mandar de nuevo",
            .noRecent: "Todavía no hay un dictado para pegar",
            .statusRecording: "zerosoft: micrófono abierto (dictado)",
            .statusDictate: "Empezar a dictar",
            .statusDictateStop: "Terminar el dictado",
            .statusDictateHint: "Dictar: mantené {key}",
            .statusPasteLast: "Pegar el último dictado",
            .statusRetry: "Mandar de nuevo los dictados guardados ({n})",
            .statusHistory: "Historial de dictados…",
            .secPermissions: "Permisos",
            .permHelp: "Lo que zerosoft puede usar en esta Mac. macOS pregunta una vez por cada uno, solo cuando tocás su botón o lo usás por primera vez.",
            .permMic: "Micrófono",
            .permMicHelp: "Para grabar lo que dictás, desde el atajo hasta que lo soltás, lo tocás de nuevo o pasan 2 minutos.",
            .micAllowed: "El micrófono está activado.",
            .micDenied: "El micrófono de zerosoft está desactivado en Ajustes del Sistema.",
            .micNotDetermined: "Todavía no se pidió. macOS pregunta la primera vez que dictás, o ahora con el botón.",
            .micTurnOn: "Activar el micrófono",
            .permAccess: "Accesibilidad",
            .permAccessHelp: "Solo para mandar la tecla de pegar (⌘V), así el texto dictado cae en la app de adelante. zerosoft no lee otras apps. El dictado anda sin este permiso: el texto queda copiado y lo pegás vos.",
            .accessAllowed: "Pegar está activado.",
            .accessOff: "Sin permiso. El texto dictado queda copiado y lo pegás con ⌘V.",
            .accessUnavailable: "Esta versión copia el texto dictado y lo pegás con ⌘V.",
            .accessAllow: "Permitir pegar",
            .accessAfter: "Si activaste zerosoft en la lista, volvé acá: se revisa de nuevo cuando se abre esta ventana.",
            .dictShortcut: "Atajo de dictado",
            .dictShortcutHelp: "Mantenelo en cualquier app, hablá y soltá: el texto limpio va donde está el cursor.",
            .dictShortcutTaken: "Otra app ya usa este atajo. Elegí otro.",
            .dictMode: "Cómo dictar",
            .modeBoth: "Mantener para hablar, o un toque para empezar y otro para terminar",
            .modeHold: "Solo mantener para hablar",
            .modeToggle: "Solo un toque para empezar y otro para terminar",
            .dictAutoPaste: "Pegar en la app de adelante",
            .dictAutoPasteHelp: "Necesita Accesibilidad (Ajustes › Permisos). Apagado: el texto queda copiado y tocás ⌘V.",
            .dictRestore: "Devolver lo que había en el portapapeles después de pegar",
            .dictSendApp: "Mandar con cada dictado el nombre de la app de adelante",
            .dictSendAppHelp: "El servidor lo usa para elegir el tono (email, chat, nota) y lo muestra en tu historial. Apagado: zerosoft no lo lee.",
            .dictKeep: "Guardar los dictados que no se pudieron enviar",
            .dictKeepHelp: "Guarda el audio en esta Mac, sin cifrar, hasta 7 días para que lo puedas mandar de nuevo. Apagado: un dictado que falla se pierde.",
            .dictAccount: "En tu cuenta",
            .historyPaste: "Pegar",
            .historyPasteHelp: "Pegar pone el texto en la app que estabas usando antes de abrir esta ventana.",
            .pendingTitle: "Sin mandar",
            .pendingHelp: "{n} grabados sin conexión o sin sesión. Mandalos de nuevo: el texto queda copiado y guardado en tu historial.",
            .pendingSend: "Mandar de nuevo",
            .obDictTitle: "Dictá en cualquier app",
            .obDictBody: "Mantené {key} en cualquier app, hablá y soltá: el texto limpio va donde está el cursor. Un toque corto sigue escuchando hasta el próximo toque, y Esc cancela.",
            .obMicBody: "macOS pide el micrófono la primera vez que dictás, o ahora con el botón.",
            .obPasteBody: "Para pegar por vos, zerosoft necesita Accesibilidad, solo para la tecla de pegar. Sin eso el texto queda copiado y tocás ⌘V.",
            .obCopyBody: "El texto queda copiado y lo pegás con ⌘V.",
            .next: "Continuar",
            .back: "Atrás",
            .done: "Listo",
        ],
        .pt: [
            .errorTitle: "O zerosoft não conseguiu abrir",
            .reasonOffline: "Este Mac está sem conexão. A página abre sozinha quando a conexão voltar.",
            .reasonUnreachable: "Não foi possível chegar a {host}. Confira o endereço ou tente de novo em instantes.",
            .reasonTimeout: "O servidor demorou demais para responder.",
            .reasonTLS: "A conexão segura com o servidor falhou.",
            .reasonServer: "O servidor respondeu com um erro ({status}).",
            .reasonBlank: "A página carregou, mas não desenhou nada.",
            .reasonCrashed: "A página parou de funcionar duas vezes em um minuto.",
            .reasonOther: "Não foi possível carregar a página.",
            .reasonCode: "Motivo: {code}",
            .retry: "Tentar de novo",
            .openInBrowser: "Abrir no navegador",
            .loading: "Carregando o zerosoft",
            .ok: "OK",
            .cancel: "Cancelar",
            .menuAbout: "Sobre o zerosoft",
            .menuHide: "Ocultar zerosoft",
            .menuHideOthers: "Ocultar Outros",
            .menuShowAll: "Mostrar Tudo",
            .menuQuit: "Encerrar zerosoft",
            .menuEdit: "Editar",
            .menuUndo: "Desfazer",
            .menuRedo: "Refazer",
            .menuCut: "Recortar",
            .menuCopy: "Copiar",
            .menuPaste: "Colar",
            .menuSelectAll: "Selecionar Tudo",
            .menuView: "Visualizar",
            .menuReload: "Recarregar",
            .menuWindow: "Janela",
            .menuMinimize: "Minimizar",
            .menuClose: "Fechar",
            .menuFile: "Arquivo",
            .menuNewTab: "Nova aba",
            .menuNewWindow: "Nova janela",
            .menuReopenTab: "Reabrir aba fechada",
            .menuCloseTab: "Fechar aba",
            .menuCloseWindow: "Fechar janela",
            .menuNextTab: "Próxima aba",
            .menuPrevTab: "Aba anterior",
            .menuZoom: "Zoom",
            .menuBack: "Voltar",
            .menuForward: "Avançar",
            .menuDuplicateTab: "Duplicar aba",
            .menuMoveToNewWindow: "Mover para uma nova janela",
            .menuCloseOtherTabs: "Fechar as outras abas",
            .menuOpenInNewTab: "Abrir em nova aba",
            .menuOpenInNewWindow: "Abrir em nova janela",
            .menuCopyLink: "Copiar link",
            .tabSuspended: "Em pausa para economizar memória. Carrega de novo quando você clica.",
            .tabRecording: "Gravando",
            .tabUnread: "Há novidades",
            .tabsLabel: "Abas",
            .tabNewTitle: "Nova aba",
            .menuSettings: "Ajustes…",
            .statusOpen: "Abrir o zerosoft",
            .statusUnread: "{n} novos",
            .statusSignIn: "Entrar…",
            .statusSignOut: "Sair",
            .settingsTitle: "Ajustes",
            .secGeneral: "Geral",
            .secTabs: "Abas",
            .secNotifications: "Notificações",
            .secVoice: "Ditado",
            .secDictionary: "Dicionário",
            .secHistory: "Histórico",
            .secAccount: "Conta",
            .loginItem: "Abrir o zerosoft ao iniciar sessão no Mac",
            .loginItemHelp: "Fica desligado até você ligar.",
            .loginItemApproval: "Permita o zerosoft em Ajustes do Sistema › Geral › Itens de Início.",
            .loginItemUnavailable: "O macOS não consegue adicionar esta cópia do zerosoft aos itens de início. Mova para Aplicativos e tente de novo.",
            .loginItemFailed: "Não foi possível mudar. Tente de novo.",
            .openLoginItems: "Abrir Itens de Início",
            .menuBarItem: "Mostrar o zerosoft na barra de menus",
            .menuBarItemHelp: "Abra suas janelas, uma nova aba ou os Ajustes mesmo com todas as janelas fechadas.",
            .showOnboarding: "Ver as boas-vindas de novo",
            .serverLabel: "Servidor",
            .lockdownLabel: "Restrições do Modo de Isolamento nas páginas",
            .stateOn: "Ativadas",
            .stateOff: "Desativadas",
            .webSettings: "Sua conta, seu workspace e seus apps têm os ajustes no próprio zerosoft.",
            .openWebSettings: "Abrir esses ajustes em uma aba",
            .tabsSuspend: "Pausar as abas que não estão em uso",
            .tabsSuspendHelp: "Uma aba pausada libera memória e carrega de novo quando você clica. Abas com uma chamada ou gravação nunca pausam.",
            .tabsSuspendAfter: "Depois de",
            .durMinutes: "{n} min",
            .durHours: "{n} h",
            .tabsRestore: "Reabrir suas janelas e abas ao abrir o app",
            .tabsLinks: "Cmd-clique em um link abre",
            .linksTab: "Uma aba atrás desta",
            .linksWindow: "Uma nova janela",
            .notifHelp: "Mensagens novas, menções e lembretes enquanto o zerosoft está em segundo plano. Clique em um para abrir.",
            .notifAllowed: "As notificações estão ativadas.",
            .notifDenied: "As notificações do zerosoft estão desativadas nos Ajustes do Sistema.",
            .notifNotDetermined: "As notificações ainda não estão ativadas. O macOS pergunta uma vez quando você ativa.",
            .notifTurnOn: "Ativar notificações",
            .notifOpenSystem: "Abrir Ajustes do Sistema",
            .voiceHelp: "Seus ajustes de ditado ficam na sua conta e valem em todos os dispositivos.",
            .voiceLanguage: "Idioma",
            .langAuto: "Detectar automaticamente",
            .voiceCleanup: "Estilo",
            .cleanRaw: "Como foi dito",
            .cleanClean: "Limpo",
            .cleanFormal: "Formal",
            .cleanPerApp: "Depende do app",
            .voiceDepth: "Quanto limpar",
            .depthLight: "Pouco",
            .depthStandard: "Normal",
            .depthThorough: "A fundo",
            .voiceAI: "Limpar com IA",
            .dictHelp: "Palavras que o ditado deve escrever do seu jeito, e o que escrever quando ouve uma frase.",
            .dictKind: "Tipo",
            .kindWord: "Palavra",
            .kindReplace: "Substituição",
            .kindSnippet: "Trecho",
            .dictPhrase: "Frase",
            .dictReplacement: "Escreve",
            .dictAdd: "Adicionar",
            .dictDelete: "Excluir",
            .dictEmpty: "Ainda não há palavras.",
            .dictTeam: "Equipe",
            .historyHelp: "Seus últimos 50 ditados.",
            .historyEmpty: "Ainda não há ditados.",
            .copied: "Copiado",
            .accountSignedIn: "Conectado como {email}",
            .accountSignedOut: "Você não entrou.",
            .signIn: "Entrar",
            .signOut: "Sair",
            .remoteSignedOut: "Entre para ver isto.",
            .remoteOffline: "Não foi possível chegar ao servidor.",
            .remoteFailed: "Algo deu errado. Tente de novo.",
            .loadingShort: "Carregando…",
            .saved: "Salvo",
            .saveFailed: "Não foi salvo. Tente de novo.",
            .obWelcomeTitle: "Boas-vindas ao zerosoft",
            .obWelcomeBody: "Seus apps em janelas e abas nativas, um ícone na barra de menus, notificações com o contador no Dock e ditado em qualquer app.",
            .obNotifTitle: "Fique sabendo na hora",
            .obNotifBody: "O zerosoft pode avisar sobre mensagens novas, menções e lembretes enquanto está em segundo plano. O macOS pergunta uma vez, e você pode mudar nos Ajustes.",
            .obNotLater: "Agora não",
            .obStartupTitle: "Começar com o seu Mac",
            .obStartupBody: "As duas são opcionais e podem ser mudadas nos Ajustes.",
            .obDoneTitle: "Tudo pronto",
            .obDoneBody: "Entre para ver seu workspace. O zerosoft fica no Dock e na barra de menus quando você precisar.",
            .hudListening: "Ouvindo",
            .hudHandsFree: "Mãos livres",
            .hudHandsFreeHint: "{key} para terminar",
            .hudEscHint: "Esc cancela",
            .hudWorking: "Limpando",
            .hudSending: "Enviando",
            .hudPasted: "Colado",
            .hudCopied: "Copiado. Cole com {key}",
            .hudMicOff: "O microfone está sem permissão",
            .hudMicBusy: "Não foi possível abrir o microfone",
            .hudMicReady: "Microfone ativado. Pressione {key} para ditar",
            .errFailed: "Não foi possível ditar",
            .errOffline: "Sem conexão",
            .errSignedOut: "Entre no zerosoft para ditar",
            .errRateLimited: "Muitos ditados seguidos",
            .errServer: "O servidor não respondeu",
            .errTooLarge: "A gravação é longa demais",
            .errEmpty: "Nada foi ouvido",
            .errOtherServer: "Gravado para outro servidor",
            .savedToRetry: "Guardado para enviar de novo",
            .noRecent: "Ainda não há ditado para colar",
            .statusRecording: "zerosoft: microfone aberto (ditado)",
            .statusDictate: "Começar a ditar",
            .statusDictateStop: "Terminar o ditado",
            .statusDictateHint: "Ditar: segure {key}",
            .statusPasteLast: "Colar o último ditado",
            .statusRetry: "Enviar de novo os ditados guardados ({n})",
            .statusHistory: "Histórico de ditados…",
            .secPermissions: "Permissões",
            .permHelp: "O que o zerosoft pode usar neste Mac. O macOS pergunta uma vez por cada um, só quando você aperta o botão ou usa pela primeira vez.",
            .permMic: "Microfone",
            .permMicHelp: "Para gravar o que você dita, do atalho até você soltar, tocar de novo ou chegar a 2 minutos.",
            .micAllowed: "O microfone está ativado.",
            .micDenied: "O microfone do zerosoft está desativado nos Ajustes do Sistema.",
            .micNotDetermined: "Ainda não foi pedido. O macOS pergunta na primeira vez que você dita, ou agora com o botão.",
            .micTurnOn: "Ativar o microfone",
            .permAccess: "Acessibilidade",
            .permAccessHelp: "Só para enviar a tecla de colar (⌘V), para o texto ditado cair no app da frente. O zerosoft não lê outros apps. O ditado funciona sem ela: o texto fica copiado e você cola.",
            .accessAllowed: "Colar está ativado.",
            .accessOff: "Sem permissão. O texto ditado fica copiado e você cola com ⌘V.",
            .accessUnavailable: "Esta versão copia o texto ditado e você cola com ⌘V.",
            .accessAllow: "Permitir colar",
            .accessAfter: "Se você ativou o zerosoft na lista, volte aqui: é verificado de novo quando esta janela abre.",
            .dictShortcut: "Atalho de ditado",
            .dictShortcutHelp: "Segure em qualquer app, fale e solte: o texto limpo vai onde está o cursor.",
            .dictShortcutTaken: "Outro app já usa este atalho. Escolha outro.",
            .dictMode: "Como ditar",
            .modeBoth: "Segurar para falar, ou um toque para começar e outro para terminar",
            .modeHold: "Só segurar para falar",
            .modeToggle: "Só um toque para começar e outro para terminar",
            .dictAutoPaste: "Colar no app da frente",
            .dictAutoPasteHelp: "Precisa de Acessibilidade (Ajustes › Permissões). Desligado: o texto fica copiado e você aperta ⌘V.",
            .dictRestore: "Devolver o que havia na área de transferência depois de colar",
            .dictSendApp: "Enviar com cada ditado o nome do app da frente",
            .dictSendAppHelp: "O servidor usa para escolher o tom (email, chat, nota) e mostra no seu histórico. Desligado: o zerosoft não lê.",
            .dictKeep: "Guardar os ditados que não puderam ser enviados",
            .dictKeepHelp: "Guarda o áudio neste Mac, sem criptografia, por até 7 dias para você enviar de novo. Desligado: um ditado que falha se perde.",
            .dictAccount: "Na sua conta",
            .historyPaste: "Colar",
            .historyPasteHelp: "Colar coloca o texto no app que você usava antes de abrir esta janela.",
            .pendingTitle: "Não enviados",
            .pendingHelp: "{n} gravados sem conexão ou sem sessão. Envie de novo: o texto fica copiado e salvo no seu histórico.",
            .pendingSend: "Enviar de novo",
            .obDictTitle: "Dite em qualquer app",
            .obDictBody: "Segure {key} em qualquer app, fale e solte: o texto limpo vai onde está o cursor. Um toque curto continua ouvindo até o próximo toque, e Esc cancela.",
            .obMicBody: "O macOS pede o microfone na primeira vez que você dita, ou agora com o botão.",
            .obPasteBody: "Para colar por você, o zerosoft precisa de Acessibilidade, só para a tecla de colar. Sem isso o texto fica copiado e você aperta ⌘V.",
            .obCopyBody: "O texto fica copiado e você cola com ⌘V.",
            .next: "Continuar",
            .back: "Voltar",
            .done: "Concluir",
        ],
    ]

    public static func text(_ key: StringKey, _ lang: Lang, _ vars: [String: String] = [:]) -> String {
        var s = table[lang]?[key] ?? table[.en]?[key] ?? key.rawValue
        for (name, value) in vars { s = s.replacingOccurrences(of: "{\(name)}", with: value) }
        return s
    }

    /// The sentence under the error title for a failure. `server` is the configured origin.
    public static func message(for failure: LoadFailure, _ lang: Lang, server: String) -> String {
        switch failure {
        case .offline: return text(.reasonOffline, lang)
        case .unreachable:
            let host = URL(string: server)?.host ?? server
            return text(.reasonUnreachable, lang, ["host": host])
        case .timeout: return text(.reasonTimeout, lang)
        case .secureConnection: return text(.reasonTLS, lang)
        case let .server(status): return text(.reasonServer, lang, ["status": String(status)])
        case .blank: return text(.reasonBlank, lang)
        case .crashed: return text(.reasonCrashed, lang)
        case .other: return text(.reasonOther, lang)
        }
    }
}
