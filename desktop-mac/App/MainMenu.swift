import AppKit

/// App, Edit, View and Window menus. The Edit menu is what makes Cmd+C / Cmd+V work in the page.
@MainActor
enum MainMenu {
    static func build(lang: Lang, target: AnyObject) -> NSMenu {
        let t = { (key: StringKey) in Strings.text(key, lang) }
        let main = NSMenu()

        let app = submenu(in: main, title: "zerosoft")
        app.addItem(withTitle: t(.menuAbout), action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: t(.menuHide), action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let others = app.addItem(withTitle: t(.menuHideOthers), action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        others.keyEquivalentModifierMask = [.command, .option]
        app.addItem(withTitle: t(.menuShowAll), action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: t(.menuQuit), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        let edit = submenu(in: main, title: t(.menuEdit))
        edit.addItem(withTitle: t(.menuUndo), action: Selector(("undo:")), keyEquivalent: "z")
        let redo = edit.addItem(withTitle: t(.menuRedo), action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(.separator())
        edit.addItem(withTitle: t(.menuCut), action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: t(.menuCopy), action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: t(.menuPaste), action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: t(.menuSelectAll), action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        let view = submenu(in: main, title: t(.menuView))
        let reload = view.addItem(withTitle: t(.menuReload), action: #selector(AppDelegate.reloadPage(_:)), keyEquivalent: "r")
        reload.target = target

        let window = submenu(in: main, title: t(.menuWindow))
        window.addItem(withTitle: t(.menuMinimize), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: t(.menuClose), action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        NSApp.windowsMenu = window
        return main
    }

    private static func submenu(in main: NSMenu, title: String) -> NSMenu {
        let item = main.addItem(withTitle: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        item.submenu = menu
        return menu
    }
}
