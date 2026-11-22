import AppKit

/// The menu bar item (block 5 of docs/desktop-swift.md, section 4.2): an `NSStatusItem` with an
/// AppKit menu built from `StatusMenuItem.items` each time it opens, so it reflects the session
/// and the count of new items. Dictation (start or stop, paste last, the saved dictations and
/// history) joined in block 6; while the microphone is open the icon changes and the tooltip
/// says so. Block 7: while a meeting records or the computer's audio is captured, the icon is a
/// red dot, the menu starts with what is capturing (open, stop) and the item shows even when
/// Settings › General hides it (guideline 2.5.14).
@MainActor
final class StatusItemController: NSObject, NSMenuDelegate {
    private var item: NSStatusItem?
    private let lang: Lang
    /// From the badge poll: nil until the first answer.
    var signedIn: Bool?
    var unread = 0

    var onOpen: () -> Void = {}
    var onNewTab: () -> Void = {}
    var onNewWindow: () -> Void = {}
    var onSettings: () -> Void = {}
    var onSignIn: () -> Void = {}
    var onSignOut: () -> Void = {}
    /// Dictation (block 6): its state when the menu opens, and its actions.
    var dictation: () -> DictationMenuState? = { nil }
    var shortcutLabel: () -> String = { "" }
    var onDictate: () -> Void = {}
    var onPasteLast: () -> Void = {}
    var onRetry: () -> Void = {}
    var onHistory: () -> Void = {}
    /// Meetings (block 7).
    var onOpenRecording: () -> Void = {}
    var onStopRecording: () -> Void = {}
    var onStopSystemAudio: () -> Void = {}
    private var capture = CaptureState()
    /// Settings › General's switch; a capture shows the item whatever it says.
    private var wanted = true

    init(lang: Lang) {
        self.lang = lang
    }

    var isShown: Bool { item != nil }

    /// Settings › General's switch.
    func setShown(_ shown: Bool) {
        wanted = shown
        sync()
    }

    /// What captures now: the icon, the tooltip, the first items, and whether the item must show.
    func setCapture(_ new: CaptureState) {
        guard new != capture else { return }
        capture = new
        sync()
        drawIcon()
    }

    private func sync() {
        let shown = wanted || capture.forcesMenuBarItem
        if shown, item == nil {
            let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
            if let button = item.button {
                button.setAccessibilityIdentifier("zs-status-item")
            }
            let menu = NSMenu()
            menu.delegate = self
            menu.autoenablesItems = false
            item.menu = menu
            self.item = item
            drawIcon()
        } else if !shown, let item {
            NSStatusBar.system.removeStatusItem(item)
            self.item = nil
        }
    }

    /// The icon and tooltip say what records (guideline 2.5.14): a red dot for a meeting or the
    /// computer's audio, the microphone for a dictation.
    private func drawIcon() {
        guard let button = item?.button else { return }
        let tip = capture.statusKey.map { Strings.text($0, lang) } ?? "zerosoft"
        let image: NSImage?
        if capture.forcesMenuBarItem {
            let red = NSImage.SymbolConfiguration(paletteColors: [.systemRed])
            image = NSImage(systemSymbolName: "record.circle.fill", accessibilityDescription: tip)?.withSymbolConfiguration(red)
            image?.isTemplate = false
        } else {
            image = NSImage(systemSymbolName: capture.dictation ? "mic.circle.fill" : "z.square", accessibilityDescription: tip)
            image?.isTemplate = true
        }
        button.image = image
        button.setAccessibilityLabel(tip)
        button.toolTip = tip
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let t = { (key: StringKey) in Strings.text(key, self.lang) }
        let state = dictation()
        for entry in StatusMenuItem.items(signedIn: signedIn, unread: unread, dictation: state, capture: capture) {
            switch entry {
            case .separator:
                menu.addItem(.separator())
            case let .capturing(now):
                let item = add(menu, t(now.meeting ? .meetRecording : .meetCapturing), "capturing", #selector(openRecording(_:)))
                item.isEnabled = false
            case .openRecording:
                add(menu, t(.statusOpenRecording), "open-recording", #selector(openRecording(_:)))
            case .stopRecording:
                add(menu, t(.statusStopRecording), "stop-recording", #selector(stopRecording(_:)))
            case .stopSystemAudio:
                add(menu, t(.statusStopSystemAudio), "stop-sysaudio", #selector(stopSystemAudio(_:)))
            case let .dictate(recording):
                let item = add(menu, t(recording ? .statusDictateStop : .statusDictate), "dictate", #selector(dictate(_:)))
                item.isEnabled = state?.phase != .working
            case .dictateHint:
                let item = add(menu, Strings.text(.statusDictateHint, lang, ["key": shortcutLabel()]), "dictate-hint", #selector(dictate(_:)))
                item.isEnabled = false
            case .pasteLast:
                let item = add(menu, t(.statusPasteLast), "paste-last", #selector(pasteLast(_:)))
                item.keyEquivalent = "v"
                item.keyEquivalentModifierMask = [.control, .command]
            case let .retry(n):
                add(menu, Strings.text(.statusRetry, lang, ["n": String(n)]), "retry", #selector(retry(_:)))
            case .history:
                add(menu, t(.statusHistory), "history", #selector(history(_:)))
            case .open:
                add(menu, t(.statusOpen), "open", #selector(open(_:)))
            case .newTab:
                add(menu, t(.menuNewTab), "new-tab", #selector(newTab(_:)))
            case .newWindow:
                add(menu, t(.menuNewWindow), "new-window", #selector(newWindow(_:)))
            case let .unread(n):
                // Opens the app, where the items are.
                add(menu, Strings.text(.statusUnread, lang, ["n": String(n)]), "unread", #selector(open(_:)))
            case .settings:
                add(menu, t(.menuSettings), "settings", #selector(settings(_:)), key: ",")
            case .signIn:
                add(menu, t(.statusSignIn), "sign-in", #selector(signIn(_:)))
            case .signOut:
                add(menu, t(.statusSignOut), "sign-out", #selector(signOut(_:)))
            case .quit:
                let quit = menu.addItem(withTitle: t(.menuQuit), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
                quit.setAccessibilityIdentifier("zs-status-quit")
            }
        }
    }

    @discardableResult
    private func add(_ menu: NSMenu, _ title: String, _ id: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let entry = menu.addItem(withTitle: title, action: action, keyEquivalent: key)
        entry.target = self
        entry.setAccessibilityIdentifier("zs-status-\(id)")
        return entry
    }

    @objc private func dictate(_ sender: Any?) { onDictate() }
    @objc private func pasteLast(_ sender: Any?) { onPasteLast() }
    @objc private func retry(_ sender: Any?) { onRetry() }
    @objc private func history(_ sender: Any?) { onHistory() }
    @objc private func openRecording(_ sender: Any?) { onOpenRecording() }
    @objc private func stopRecording(_ sender: Any?) { onStopRecording() }
    @objc private func stopSystemAudio(_ sender: Any?) { onStopSystemAudio() }

    @objc private func open(_ sender: Any?) { onOpen() }
    @objc private func newTab(_ sender: Any?) { onNewTab() }
    @objc private func newWindow(_ sender: Any?) { onNewWindow() }
    @objc private func settings(_ sender: Any?) { onSettings() }
    @objc private func signIn(_ sender: Any?) { onSignIn() }
    @objc private func signOut(_ sender: Any?) { onSignOut() }
}
