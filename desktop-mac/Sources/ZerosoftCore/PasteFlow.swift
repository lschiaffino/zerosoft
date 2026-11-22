import Foundation

// Putting dictated text into the app in front (clipboard.rs), with the system behind a protocol
// so the rules are tested without a pasteboard:
//
// 1. Only when the paste keystroke may be posted: what was on the clipboard is saved.
// 2. The text goes on the clipboard (marked transient and concealed, this Mac only) and
//    Command+V is posted.
// 3. A moment later (the target app reads the clipboard while it handles the key) the saved
//    contents come back, but only if the clipboard still holds our text: if the person copied
//    something else in between, that stays.
//
// Without the keystroke (the Store build's copy-only mode, the switch off, or no Accessibility
// approval) the text is only copied and the clipboard is never read.

/// The pasteboard as the paste flow sees it.
@MainActor
public protocol ClipboardPort: AnyObject {
    associatedtype Snapshot
    /// Everything on the clipboard now, to put back later.
    func snapshot() -> Snapshot?
    func isEmpty(_ snapshot: Snapshot) -> Bool
    /// Writes the text. Returns the clipboard's change count after the write, nil if it failed.
    func write(_ text: String) -> Int?
    /// The change count now: equal to what `write` returned means the text is still there.
    func changeCount() -> Int
    func restore(_ snapshot: Snapshot) -> Bool
    func clear()
}

public enum PasteResult: String, Sendable {
    /// Command+V was posted to the app in front.
    case pasted
    /// The text is on the clipboard; the person pastes it.
    case copied
    /// Not even the clipboard could be written.
    case failed
}

public enum PasteFlow {
    /// How long the target app gets to read the clipboard before it is put back
    /// (privacy facts `clipboardRestoreMs`).
    public static let settleMs = 450

    /// Copies `text` and, when `tap` is given, posts the paste keystroke with it. Returns what
    /// happened and whether the old clipboard came back. `wait` sleeps (injected for the tests).
    @MainActor
    public static func run<C: ClipboardPort>(
        _ board: C, text: String, tap: (() -> Bool)?, restore: Bool,
        wait: @Sendable (Int) async -> Void
    ) async -> (PasteResult, restored: Bool) {
        guard let tap else {
            return (board.write(text) == nil ? .failed : .copied, false)
        }
        let saved = restore ? board.snapshot() : nil
        guard let mark = board.write(text) else { return (.failed, false) }
        guard tap() else { return (.copied, false) }
        guard let saved else { return (.pasted, false) }
        await wait(settleMs)
        guard board.changeCount() == mark else { return (.pasted, false) }
        if board.isEmpty(saved) {
            board.clear()
            return (.pasted, true)
        }
        return (.pasted, board.restore(saved))
    }
}

/// Whether the app may post the paste keystroke: the build allows it (the `ZSAutoPaste` flag in
/// Info.plist, decision 7.1), the person's switch is on and macOS approved it
/// (CGPreflightPostEventAccess, Privacy & Security › Accessibility).
public enum PasteAccess: String, Sendable {
    /// Approved: dictated text is pasted.
    case allowed
    /// Not approved yet, or turned off in System Settings. macOS has no "not asked" answer for
    /// this permission, so the button asks once and then opens System Settings.
    case notAllowed
    /// This build only copies (the flag is off, for example a Store build after review).
    case unavailable

    public static func of(buildAllows: Bool, approved: Bool) -> PasteAccess {
        guard buildAllows else { return .unavailable }
        return approved ? .allowed : .notAllowed
    }

    /// The keystroke is posted only with everything allowed.
    public static func mayPaste(buildAllows: Bool, switchOn: Bool, approved: Bool) -> Bool {
        buildAllows && switchOn && approved
    }
}
