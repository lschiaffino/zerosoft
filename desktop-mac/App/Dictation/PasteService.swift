import AppKit
import Carbon.HIToolbox

/// The general pasteboard for the paste flow (PasteFlow in ZerosoftCore). Text the app puts there
/// is marked transient and concealed (clipboard managers that follow nspasteboard.org do not keep
/// it) and stays on this Mac (no Universal Clipboard), as the Tauri app's `set_private_text`.
@MainActor
final class SystemPasteboard: ClipboardPort {
    typealias Snapshot = [[NSPasteboard.PasteboardType: Data]]
    private let board = NSPasteboard.general

    func snapshot() -> Snapshot? {
        (board.pasteboardItems ?? []).map { item in
            var types: [NSPasteboard.PasteboardType: Data] = [:]
            for t in item.types {
                if let d = item.data(forType: t) { types[t] = d }
            }
            return types
        }
    }

    func isEmpty(_ snapshot: Snapshot) -> Bool {
        snapshot.allSatisfy(\.isEmpty)
    }

    func write(_ text: String) -> Int? {
        board.prepareForNewContents(with: .currentHostOnly)
        guard board.setString(text, forType: .string) else { return nil }
        board.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.TransientType"))
        board.setData(Data(), forType: NSPasteboard.PasteboardType("org.nspasteboard.ConcealedType"))
        return board.changeCount
    }

    func changeCount() -> Int { board.changeCount }

    func restore(_ snapshot: Snapshot) -> Bool {
        board.clearContents()
        let items = snapshot.map { types -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (t, d) in types { item.setData(d, forType: t) }
            return item
        }
        return board.writeObjects(items)
    }

    func clear() { board.clearContents() }
}

/// Pasting into the app in front: Command+V posted with CGEvent, which macOS allows a sandboxed
/// app once the person turned it on in Privacy & Security › Accessibility
/// (CGPreflightPostEventAccess / CGRequestPostEventAccess). No Accessibility API (AX) is used:
/// the app never reads another app's windows or text.
@MainActor
protocol PastePermission: AnyObject {
    /// The build may post the paste keystroke at all (`ZSAutoPaste` in Info.plist, decision 7.1).
    var buildAllows: Bool { get }
    func approved() -> Bool
    /// Asks macOS (its prompt shows once); later presses open System Settings.
    func request()
    func openSystemSettings()
    /// Posts Command+V. False when the event could not be made.
    func postPaste() -> Bool
}

@MainActor
final class SystemPastePermission: PastePermission {
    let buildAllows: Bool
    private var asked = false

    init(buildAllows: Bool) {
        self.buildAllows = buildAllows
    }

    /// Info.plist `ZSAutoPaste` (from the ZS_AUTO_PASTE build setting).
    static var flag: Bool {
        (Bundle.main.object(forInfoDictionaryKey: "ZSAutoPaste") as? String).map { $0 == "YES" || $0 == "1" } ?? false
    }

    func approved() -> Bool {
        buildAllows && CGPreflightPostEventAccess()
    }

    func request() {
        guard buildAllows, !approved() else { return }
        if asked {
            openSystemSettings()
        } else {
            asked = true
            _ = CGRequestPostEventAccess()
        }
    }

    func openSystemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    func postPaste() -> Bool {
        guard approved() else { return false }
        let code = Self.keyCodeForV()
        let source = CGEventSource(stateID: .combinedSessionState)
        guard let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else { return false }
        // Command, flagged like the left Command key (NX_DEVICELCMDKEYMASK), as a real press.
        let flags = CGEventFlags(rawValue: CGEventFlags.maskCommand.rawValue | 0x08)
        down.flags = flags
        up.flags = flags
        down.post(tap: .cgSessionEventTap)
        usleep(8000)
        up.post(tap: .cgSessionEventTap)
        return true
    }

    /// The key that types "v" in the current keyboard layout (ANSI V when none does).
    static func keyCodeForV() -> CGKeyCode {
        let ansiV = CGKeyCode(kVK_ANSI_V)
        guard let source = TISCopyCurrentKeyboardLayoutInputSource()?.takeRetainedValue(),
              let raw = TISGetInputSourceProperty(source, kTISPropertyUnicodeKeyLayoutData) else { return ansiV }
        let data = Unmanaged<CFData>.fromOpaque(raw).takeUnretainedValue() as Data
        return data.withUnsafeBytes { bytes -> CGKeyCode in
            guard let layout = bytes.baseAddress?.assumingMemoryBound(to: UCKeyboardLayout.self) else { return ansiV }
            for code in 0 ..< 128 {
                var dead: UInt32 = 0
                var length = 0
                var chars = [UniChar](repeating: 0, count: 4)
                let status = UCKeyTranslate(
                    layout, UInt16(code), UInt16(kUCKeyActionDisplay), 0, UInt32(LMGetKbdType()),
                    OptionBits(kUCKeyTranslateNoDeadKeysMask), &dead, chars.count, &length, &chars
                )
                if status == noErr, length == 1, chars[0] == UniChar(118) { return CGKeyCode(code) }
            }
            return ansiV
        }
    }
}

#if DEBUG
/// UI tests only: the Accessibility approval and the keystroke without the system (CI cannot
/// approve the app, and a posted Command+V would land in whatever the runner has in front).
/// `-ZSPasteAllowed YES` starts approved; the first request approves. Each "keystroke" records
/// what the clipboard held at that moment, so a test can check the text was there.
@MainActor
final class FakePastePermission: PastePermission {
    let buildAllows: Bool
    private var allowed: Bool
    private(set) var asked = 0
    private(set) var keys = 0
    /// The clipboard's text when the last keystroke was "posted".
    private(set) var clipboardAtKey: String?
    var onChange: (() -> Void)?

    init(buildAllows: Bool, allowed: Bool) {
        self.buildAllows = buildAllows
        self.allowed = allowed
    }

    func approved() -> Bool { buildAllows && allowed }

    func request() {
        asked += 1
        if buildAllows { allowed = true }
        onChange?()
    }

    func openSystemSettings() {}

    func postPaste() -> Bool {
        keys += 1
        clipboardAtKey = NSPasteboard.general.string(forType: .string)
        onChange?()
        return true
    }
}
#endif
