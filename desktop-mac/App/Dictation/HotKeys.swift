import Carbon.HIToolbox

/// Global shortcuts with Carbon's `RegisterEventHotKey` (docs/desktop-swift.md, section 2.2):
/// it needs no permission in the App Sandbox, unlike `NSEvent.addGlobalMonitorForEvents`, which
/// needs Accessibility and is not used. The app learns about its own shortcuts and nothing else:
/// no other key reaches it.
@MainActor
final class HotKeys {
    enum Key: UInt32, CaseIterable {
        case dictation = 1
        /// Registered only while a dictation records.
        case escape = 2
        case pasteLast = 3
    }

    /// A shortcut went down (`true`) or up.
    var onKey: (Key, Bool) -> Void = { _, _ in }

    private var refs: [Key: EventHotKeyRef] = [:]
    private var handler: EventHandlerRef?
    /// 'zsft'
    nonisolated private static let signature: OSType = 0x7A73_6674

    init() {
        var specs = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, user in
            guard let event, let user else { return OSStatus(eventNotHandledErr) }
            var id = EventHotKeyID()
            let status = GetEventParameter(
                event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID),
                nil, MemoryLayout<EventHotKeyID>.size, nil, &id
            )
            guard status == noErr, id.signature == HotKeys.signature else { return OSStatus(eventNotHandledErr) }
            let pressed = GetEventKind(event) == UInt32(kEventHotKeyPressed)
            let keys = Unmanaged<HotKeys>.fromOpaque(user).takeUnretainedValue()
            // Carbon delivers application events on the main thread.
            MainActor.assumeIsolated { keys.fire(id.id, pressed) }
            return noErr
        }, specs.count, &specs, me, &handler)
    }

    private func fire(_ raw: UInt32, _ pressed: Bool) {
        guard let key = Key(rawValue: raw), refs[key] != nil else { return }
        onKey(key, pressed)
    }

    /// Registers `shortcut` for `key` (replacing what it had). False when the system refused it,
    /// usually because another app holds the same shortcut.
    @discardableResult
    func register(_ key: Key, _ shortcut: DictationShortcut) -> Bool {
        unregister(key)
        var ref: EventHotKeyRef?
        let id = EventHotKeyID(signature: Self.signature, id: key.rawValue)
        let status = RegisterEventHotKey(shortcut.keyCode, shortcut.modifiers, id, GetApplicationEventTarget(), 0, &ref)
        guard status == noErr, let ref else { return false }
        refs[key] = ref
        return true
    }

    func unregister(_ key: Key) {
        if let ref = refs.removeValue(forKey: key) { UnregisterEventHotKey(ref) }
    }

    func isRegistered(_ key: Key) -> Bool { refs[key] != nil }
}
