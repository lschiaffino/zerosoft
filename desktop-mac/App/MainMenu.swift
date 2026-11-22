import AppKit

/// App, File, Edit, View and Window menus. The Edit menu is what makes Cmd+C / Cmd+V work in the
/// page. File and Window carry the tab shortcuts of docs/desktop-tabs.md (the Tauri app's menu in
/// tray.rs): Cmd+T, Cmd+N, Cmd+Shift+T, Cmd+W, Cmd+Shift+W, Ctrl+Tab, Ctrl+Shift+Tab,
/// Cmd+Shift+[ ], Cmd+1...Cmd+9. While the page has the keyboard, the bridge script handles the
/// last four first (as in the Tauri app); the menu covers the rest of the time.
@MainActor
enum MainMenu {
    static func build(lang: Lang, tabs: TabsController) -> NSMenu {
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

        let file = submenu(in: main, title: t(.menuFile))
        item(file, t(.menuNewTab), #selector(TabsController.newTab(_:)), "t", tabs)
        item(file, t(.menuNewWindow), #selector(TabsController.newWindowAction(_:)), "n", tabs)
        file.addItem(.separator())
        item(file, t(.menuReopenTab), #selector(TabsController.reopenClosedTab(_:)), "t", tabs, [.command, .shift])
        file.addItem(.separator())
        item(file, t(.menuCloseTab), #selector(TabsController.closeTabAction(_:)), "w", tabs)
        item(file, t(.menuCloseWindow), #selector(TabsController.closeWindowAction(_:)), "w", tabs, [.command, .shift])

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
        item(view, t(.menuReload), #selector(TabsController.reloadPage(_:)), "r", tabs)
        item(view, t(.menuBack), #selector(TabsController.goBack(_:)), "[", tabs)
        item(view, t(.menuForward), #selector(TabsController.goForward(_:)), "]", tabs)

        let window = submenu(in: main, title: t(.menuWindow))
        window.addItem(withTitle: t(.menuMinimize), action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        window.addItem(withTitle: t(.menuZoom), action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        window.addItem(.separator())
        item(window, t(.menuNextTab), #selector(TabsController.nextTab(_:)), "\t", tabs, [.control])
        item(window, t(.menuPrevTab), #selector(TabsController.previousTab(_:)), "\t", tabs, [.control, .shift])
        // Hidden items that keep their shortcut: Cmd+Shift+] and Cmd+Shift+[, Cmd+1...Cmd+9.
        let next = item(window, t(.menuNextTab), #selector(TabsController.nextTab(_:)), "]", tabs, [.command, .shift])
        next.isHidden = true
        next.allowsKeyEquivalentWhenHidden = true
        let prev = item(window, t(.menuPrevTab), #selector(TabsController.previousTab(_:)), "[", tabs, [.command, .shift])
        prev.isHidden = true
        prev.allowsKeyEquivalentWhenHidden = true
        for n in 1 ... 9 {
            let select = item(window, "\(n)", #selector(TabsController.selectTabByNumber(_:)), "\(n)", tabs)
            select.tag = n
            select.isHidden = true
            select.allowsKeyEquivalentWhenHidden = true
        }
        window.addItem(.separator())
        // macOS adds the list of open windows below (each titled after its tab in front).
        NSApp.windowsMenu = window
        return main
    }

    @discardableResult
    private static func item(
        _ menu: NSMenu, _ title: String, _ action: Selector, _ key: String, _ target: AnyObject,
        _ modifiers: NSEvent.ModifierFlags = [.command]
    ) -> NSMenuItem {
        let item = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }

    private static func submenu(in main: NSMenu, title: String) -> NSMenu {
        let item = main.addItem(withTitle: title, action: nil, keyEquivalent: "")
        let menu = NSMenu(title: title)
        item.submenu = menu
        return menu
    }
}
