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
