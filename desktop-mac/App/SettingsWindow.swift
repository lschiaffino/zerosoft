import AppKit
import SwiftUI

/// The native Settings window (block 5 of docs/desktop-swift.md, section 4.2): SwiftUI in an
/// AppKit window, opened from the app menu (Cmd+,), the menu bar item and the page
/// (`openSettings()` of the bridge). One window; opening it again brings it to the front.
@MainActor
final class SettingsWindowController: NSWindowController, NSWindowDelegate {
    private let model: SettingsModel
    private let selection: SettingsSelection

    init(model: SettingsModel) {
        self.model = model
        selection = SettingsSelection()
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 720, height: 500),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = model.t(.settingsTitle)
        window.identifier = NSUserInterfaceItemIdentifier("zs-settings")
        window.setAccessibilityIdentifier("zs-settings")
        window.minSize = NSSize(width: 620, height: 420)
        window.isReleasedWhenClosed = false
        window.tabbingMode = .disallowed
        window.contentViewController = NSHostingController(rootView: SettingsView(model: model, selection: selection))
        window.center()
        super.init(window: window)
        window.delegate = self
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ section: SettingsSection? = nil) {
        if let section { selection.section = section }
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
        Task { await model.refreshSystemState() }
    }
}

@MainActor
final class SettingsSelection: ObservableObject {
    @Published var section: SettingsSection = .general
}

extension SettingsSection {
    var titleKey: StringKey {
        switch self {
        case .general: return .secGeneral
        case .tabs: return .secTabs
        case .meetings: return .secMeetings
        case .permissions: return .secPermissions
        case .voice: return .secVoice
        case .dictionary: return .secDictionary
        case .history: return .secHistory
        case .account: return .secAccount
        }
    }

    var symbol: String {
        switch self {
        case .general: return "gearshape"
        case .tabs: return "square.on.square"
        case .meetings: return "record.circle"
        case .permissions: return "hand.raised"
        case .voice: return "mic"
        case .dictionary: return "character.book.closed"
        case .history: return "clock"
        case .account: return "person.crop.circle"
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: SettingsModel
    @ObservedObject var selection: SettingsSelection

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(SettingsSection.allCases, id: \.self) { section in
                    SidebarRow(title: model.t(section.titleKey), symbol: section.symbol, selected: selection.section == section) {
                        selection.section = section
                    }
                    .accessibilityIdentifier("zs-settings-\(section.rawValue)")
                }
                Spacer()
            }
            .padding(10)
            .frame(width: 180)
            .frame(maxHeight: .infinity)
            .background(Color(nsColor: .windowBackgroundColor).opacity(0.6))
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(model.t(selection.section.titleKey)).font(.title2).bold()
                    content
                }
                .frame(maxWidth: 520, alignment: .leading)
                .padding(24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .id(selection.section)
        }
        .frame(minWidth: 620, minHeight: 420)
    }

    @ViewBuilder private var content: some View {
        switch selection.section {
        case .general: GeneralSection(model: model)
        case .tabs: TabsSection(model: model)
        case .meetings: MeetingsSection(model: model)
        case .permissions: PermissionsSection(model: model)
        case .voice: VoiceSection(model: model)
        case .dictionary: DictionarySection(model: model)
        case .history: HistorySection(model: model)
        case .account: AccountSection(model: model)
        }
    }
}

private struct SidebarRow: View {
    let title: String
    let symbol: String
    let selected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: symbol).frame(width: 18)
                Text(title)
                Spacer(minLength: 0)
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 8)
            .contentShape(Rectangle())
            .background(RoundedRectangle(cornerRadius: 5).fill(selected ? Color.accentColor.opacity(0.18) : Color.clear))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Help text under a control.
private struct Help: View {
    let text: String
    init(_ text: String) { self.text = text }
    var body: some View {
        Text(text).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }
}

/// The state of a server section that has no data.
private struct RemoteNote<T: Equatable & Sendable>: View {
    let model: SettingsModel
    let state: Remote<T>?
    let retry: () -> Void

    var body: some View {
        switch state {
        case nil:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text(model.t(.loadingShort)).foregroundStyle(.secondary)
            }
        case .signedOut?:
            VStack(alignment: .leading, spacing: 8) {
                Text(model.t(.remoteSignedOut)).accessibilityIdentifier("zs-remote-state")
                Button(model.t(.signIn)) { model.signIn() }
                    .accessibilityIdentifier("zs-remote-signin")
            }
        case .offline?, .failed?:
            VStack(alignment: .leading, spacing: 8) {
                Text(model.t(state == .offline ? .remoteOffline : .remoteFailed)).accessibilityIdentifier("zs-remote-state")
                Button(model.t(.retry), action: retry)
            }
        case .ok?:
            EmptyView()
        }
    }
}

// MARK: General

private struct GeneralSection: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Toggle(model.t(.loginItem), isOn: Binding(get: { model.loginItem.isOn }, set: { model.setLoginItem($0) }))
                    .disabled(model.loginItem == .unavailable)
                    .accessibilityIdentifier("zs-set-loginitem")
                switch model.loginItem {
                case .needsApproval:
                    Help(model.t(.loginItemApproval))
                    Button(model.t(.openLoginItems)) { model.loginItems.openSystemSettings() }
                case .unavailable:
                    Help(model.t(.loginItemUnavailable))
                default:
                    Help(model.t(.loginItemHelp))
                }
                if model.loginItemFailed { Help(model.t(.loginItemFailed)) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Toggle(model.t(.menuBarItem), isOn: Binding(get: { model.settings.menuBarItem }, set: { on in model.update { $0.menuBarItem = on } }))
                    .accessibilityIdentifier("zs-set-menubar")
                Help(model.t(.menuBarItemHelp))
            }
            Divider()
            LabeledRow(label: model.t(.serverLabel), value: model.server)
            LabeledRow(label: model.t(.lockdownLabel), value: model.t(model.lockdown ? .stateOn : .stateOff))
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Help(model.t(.webSettings))
                HStack {
                    Button(model.t(.openWebSettings)) { model.onOpenWebSettings() }
                        .accessibilityIdentifier("zs-set-web")
                    Button(model.t(.showOnboarding)) { model.onShowOnboarding() }
                        .accessibilityIdentifier("zs-set-onboarding")
                }
            }
        }
    }
}

private struct LabeledRow: View {
    let label: String
    let value: String
    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).foregroundStyle(.secondary)
            Spacer()
            Text(value).textSelection(.enabled).multilineTextAlignment(.trailing)
        }
    }
}

// MARK: Tabs

private struct TabsSection: View {
    @ObservedObject var model: SettingsModel

    private func duration(_ minutes: Int) -> String {
        minutes >= 60 && minutes % 60 == 0
            ? model.t(.durHours, ["n": String(minutes / 60)])
            : model.t(.durMinutes, ["n": String(minutes)])
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Toggle(model.t(.tabsSuspend), isOn: $model.prefs.suspend)
                    .accessibilityIdentifier("zs-set-suspend")
                Picker(model.t(.tabsSuspendAfter), selection: $model.prefs.suspendMinutes) {
                    ForEach(TabPrefs.suspendChoices, id: \.self) { Text(duration($0)).tag($0) }
                }
                .pickerStyle(.menu)
                .frame(maxWidth: 260)
                .disabled(!model.prefs.suspend)
                .accessibilityIdentifier("zs-set-suspend-minutes")
                Help(model.t(.tabsSuspendHelp))
            }
            Toggle(model.t(.tabsRestore), isOn: $model.prefs.restore)
                .accessibilityIdentifier("zs-set-restore")
            VStack(alignment: .leading, spacing: 6) {
                Text(model.t(.tabsLinks))
                Picker(model.t(.tabsLinks), selection: $model.prefs.links) {
                    Text(model.t(.linksTab)).tag(LinkTarget.tab)
                    Text(model.t(.linksWindow)).tag(LinkTarget.window)
                }
                .pickerStyle(.radioGroup)
                .labelsHidden()
                .accessibilityIdentifier("zs-set-links")
            }
        }
    }
}

// MARK: Meetings

/// The floating indicator and the computer's audio (block 7), what records now, and Voice's
/// meetings in a tab. The meetings themselves live in the page.
private struct MeetingsSection: View {
    @ObservedObject var model: SettingsModel

    private func toggle(_ key: WritableKeyPath<AppSettings, Bool>) -> Binding<Bool> {
        Binding(get: { model.settings[keyPath: key] }, set: { on in model.update { $0[keyPath: key] = on } })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Help(model.t(.meetIntro))
            HStack(spacing: 10) {
                Circle().fill(model.captureNow.forcesMenuBarItem ? Color.red : Color.secondary.opacity(0.4))
                    .frame(width: 8, height: 8)
                    .accessibilityHidden(true)
                Text(model.t(stateKey)).accessibilityIdentifier("zs-set-meeting-state")
                if model.captureNow.forcesMenuBarItem {
                    Button(model.t(.meetStop)) { model.onStopRecording() }
                        .accessibilityIdentifier("zs-set-meeting-stop")
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Toggle(model.t(.meetIndicator), isOn: toggle(\.recordingIndicator))
                    .accessibilityIdentifier("zs-set-indicator")
                Help(model.t(.meetIndicatorHelp))
            }
            VStack(alignment: .leading, spacing: 4) {
                Toggle(model.t(.meetSysAudio), isOn: toggle(\.allowSystemAudio))
                    .disabled(!model.systemAudioPossible)
                    .accessibilityIdentifier("zs-set-sysaudio")
                Help(model.t(model.lockdown ? .meetSysAudioLockdown : .meetSysAudioHelp))
            }
            Button(model.t(.meetOpenVoice)) { model.onOpenVoice() }
                .accessibilityIdentifier("zs-set-open-voice")
        }
    }

    private var stateKey: StringKey {
        if model.captureNow.meeting { return .meetRecording }
        if model.captureNow.systemAudio { return .meetCapturing }
        return .meetIdle
    }
}

// MARK: Permissions

/// Notifications, the microphone, Accessibility (paste), the computer's audio and Screen
/// Recording, each with why it is used, its state and one button. A system prompt shows only from
/// that button (or the first dictation, or the first meeting capture).
private struct PermissionsSection: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            Help(model.t(.permHelp))
            row(title: model.t(.secNotifications), help: model.t(.notifHelp)) {
                Text(model.t(notificationKey)).accessibilityIdentifier("zs-set-notif-state")
                switch model.notifications.buttonAction {
                case .ask:
                    Button(model.t(.notifTurnOn)) { model.notificationButton() }
                        .accessibilityIdentifier("zs-set-notif")
                case .openSystemSettings:
                    Button(model.t(.notifOpenSystem)) { model.notificationButton() }
                        .accessibilityIdentifier("zs-set-notif")
                case .none:
                    EmptyView()
                }
            }
            Divider()
            row(title: model.t(.permMic), help: model.t(.permMicHelp)) {
                Text(model.t(micKey)).accessibilityIdentifier("zs-set-mic-state")
                switch model.microphone.buttonAction {
                case .ask:
                    Button(model.t(.micTurnOn)) { model.microphoneButton() }
                        .accessibilityIdentifier("zs-set-mic")
                case .openSystemSettings:
                    Button(model.t(.notifOpenSystem)) { model.microphoneButton() }
                        .accessibilityIdentifier("zs-set-mic")
                case .none:
                    EmptyView()
                }
            }
            Divider()
            row(title: model.t(.permAccess), help: model.t(.permAccessHelp)) {
                switch model.pasteAccess {
                case .allowed:
                    Text(model.t(.accessAllowed)).accessibilityIdentifier("zs-set-paste-state")
                case .notAllowed:
                    Text(model.t(.accessOff)).accessibilityIdentifier("zs-set-paste-state")
                    Button(model.t(.accessAllow)) { model.pasteButton() }
                        .accessibilityIdentifier("zs-set-paste")
                    Help(model.t(.accessAfter))
                case .unavailable:
                    Text(model.t(.accessUnavailable)).accessibilityIdentifier("zs-set-paste-state")
                }
            }
            // Block 7: the computer's audio for meetings, and Screen Recording behind it on
            // macOS 13 to 14.1. Audio taps have no state macOS reports, so their row explains
            // when macOS asks and where to change it.
            Divider()
            row(title: model.t(.permAudio), help: model.t(.permAudioHelp)) {
                if model.capture.backend == .processTap {
                    Text(model.t(.permAudioTap)).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("zs-set-audio-state")
                    Button(model.t(.notifOpenSystem)) { model.capture.openAudioSettings() }
                        .accessibilityIdentifier("zs-set-audio")
                } else {
                    Text(model.t(.permAudioViaScreen)).fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("zs-set-audio-state")
                }
            }
            Divider()
            row(title: model.t(.permScreen), help: model.t(.permScreenHelp)) {
                Text(model.t(model.screenAccess ? .screenAllowed : .screenOff)).accessibilityIdentifier("zs-set-screen-state")
                if !model.screenAccess {
                    Button(model.t(.screenAllow)) { model.screenButton() }
                        .accessibilityIdentifier("zs-set-screen")
                    Help(model.t(.screenAfter))
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            // Back from System Settings: show what changed there.
            model.refreshDictationAccess()
        }
    }

    private func row<Content: View>(title: String, help: String, @ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.headline)
            Help(help)
            content()
        }
    }

    private var notificationKey: StringKey {
        switch model.notifications {
        case .allowed: return .notifAllowed
        case .denied: return .notifDenied
        case .notDetermined: return .notifNotDetermined
        }
    }

    private var micKey: StringKey {
        switch model.microphone {
        case .allowed: return .micAllowed
        case .denied: return .micDenied
        case .notDetermined: return .micNotDetermined
        }
    }
}

// MARK: Dictation (this Mac)

/// The dictation switches kept on this Mac (settings.json): the shortcut, how it is held, and
/// what happens with the text.
private struct DictationControls: View {
    @ObservedObject var model: SettingsModel

    private func toggle(_ key: WritableKeyPath<AppSettings, Bool>) -> Binding<Bool> {
        Binding(get: { model.settings[keyPath: key] }, set: { on in model.update { $0[keyPath: key] = on } })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Picker(model.t(.dictShortcut), selection: Binding(get: { model.settings.shortcut }, set: { k in model.update { $0.shortcut = k } })) {
                    ForEach(DictationShortcut.choices, id: \.self) { Text($0.label).tag($0) }
                }
                .frame(maxWidth: 320)
                .accessibilityIdentifier("zs-dict-shortcut")
                if model.shortcutTaken {
                    Text(model.t(.dictShortcutTaken)).font(.callout).foregroundStyle(.red)
                        .accessibilityIdentifier("zs-dict-shortcut-taken")
                } else {
                    if model.shortcutLabel != model.settings.shortcut.label {
                        Help(model.t(.dictShortcutFallback, ["key": model.shortcutLabel]))
                            .accessibilityIdentifier("zs-dict-shortcut-fallback")
                    }
                    Help(model.t(.dictShortcutHelp))
                }
            }
            Picker(model.t(.dictMode), selection: Binding(get: { model.settings.mode }, set: { m in model.update { $0.mode = m } })) {
                Text(model.t(.modeBoth)).tag(DictationMode.both)
                Text(model.t(.modeHold)).tag(DictationMode.hold)
                Text(model.t(.modeToggle)).tag(DictationMode.toggle)
            }
            .pickerStyle(.radioGroup)
            .accessibilityIdentifier("zs-dict-mode")
            if model.pasteAccess != .unavailable {
                VStack(alignment: .leading, spacing: 4) {
                    Toggle(model.t(.dictAutoPaste), isOn: toggle(\.autoPaste))
                        .accessibilityIdentifier("zs-dict-autopaste")
                    Help(model.t(.dictAutoPasteHelp))
                }
                Toggle(model.t(.dictRestore), isOn: toggle(\.restoreClipboard))
                    .disabled(!model.settings.autoPaste)
                    .accessibilityIdentifier("zs-dict-restore")
            }
            VStack(alignment: .leading, spacing: 4) {
                Toggle(model.t(.dictSendApp), isOn: toggle(\.sendAppName))
                    .accessibilityIdentifier("zs-dict-sendapp")
                Help(model.t(.dictSendAppHelp))
            }
            VStack(alignment: .leading, spacing: 4) {
                Toggle(model.t(.dictKeep), isOn: toggle(\.keepFailedDictations))
                    .accessibilityIdentifier("zs-dict-keep")
                Help(model.t(.dictKeepHelp))
            }
        }
        .task { model.dictationChanged() }
    }
}

// MARK: Voice

private struct VoiceSection: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            DictationControls(model: model)
            Divider()
            Text(model.t(.dictAccount)).font(.headline)
            Help(model.t(.voiceHelp))
            if case let .ok(voice)? = model.voice {
                form(voice)
            } else {
                RemoteNote(model: model, state: model.voice) { Task { await model.loadVoice() } }
            }
        }
        .task(id: model.generation) { await model.loadVoice() }
    }

    private func binding<V>(_ voice: VoiceSettings, _ key: WritableKeyPath<VoiceSettings, V>) -> Binding<V> {
        Binding(get: { voice[keyPath: key] }, set: { value in
            var changed = voice
            changed[keyPath: key] = value
            model.saveVoice(changed)
        })
    }

    @ViewBuilder private func form(_ voice: VoiceSettings) -> some View {
        let languages = VoiceSettings.languages.contains(voice.language) ? VoiceSettings.languages : VoiceSettings.languages + [voice.language]
        Picker(model.t(.voiceLanguage), selection: binding(voice, \.language)) {
            ForEach(languages, id: \.self) { code in
                Text(code == "auto" ? model.t(.langAuto) : Locale(identifier: model.lang.rawValue).localizedString(forLanguageCode: code)?.capitalized ?? code).tag(code)
            }
        }
        .frame(maxWidth: 320)
        .accessibilityIdentifier("zs-voice-language")
        Picker(model.t(.voiceCleanup), selection: binding(voice, \.cleanupMode)) {
            Text(model.t(.cleanPerApp)).tag(CleanupMode.perApp)
            Text(model.t(.cleanClean)).tag(CleanupMode.clean)
            Text(model.t(.cleanFormal)).tag(CleanupMode.formal)
            Text(model.t(.cleanRaw)).tag(CleanupMode.raw)
        }
        .frame(maxWidth: 320)
        .accessibilityIdentifier("zs-voice-cleanup")
        Picker(model.t(.voiceDepth), selection: binding(voice, \.cleanupDepth)) {
            Text(model.t(.depthLight)).tag(CleanupDepth.light)
            Text(model.t(.depthStandard)).tag(CleanupDepth.standard)
            Text(model.t(.depthThorough)).tag(CleanupDepth.thorough)
        }
        .frame(maxWidth: 320)
        .accessibilityIdentifier("zs-voice-depth")
        Toggle(model.t(.voiceAI), isOn: binding(voice, \.aiCleanup))
            .accessibilityIdentifier("zs-voice-ai")
        switch model.voiceSave {
        case true?: Text(model.t(.saved)).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("zs-voice-saved")
        case false?: Text(model.t(.saveFailed)).font(.callout).foregroundStyle(.red).accessibilityIdentifier("zs-voice-saved")
        case nil: EmptyView()
        }
    }
}

// MARK: Dictionary

private struct DictionarySection: View {
    @ObservedObject var model: SettingsModel
    @State private var kind: DictionaryKind = .word
    @State private var phrase = ""
    @State private var replacement = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Help(model.t(.dictHelp))
            if case let .ok(list)? = model.dictionary {
                let entries = list.entries
                add
                if model.dictionaryFailed { Text(model.t(.remoteFailed)).foregroundStyle(.red).font(.callout) }
                if entries.isEmpty {
                    Text(model.t(.dictEmpty)).foregroundStyle(.secondary).accessibilityIdentifier("zs-dict-empty")
                } else {
                    VStack(spacing: 0) {
                        ForEach(entries) { entry in
                            row(entry, canDelete: list.canDelete(entry))
                            if entry.id != entries.last?.id { Divider() }
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor)))
                }
            } else {
                RemoteNote(model: model, state: model.dictionary) { Task { await model.loadDictionary() } }
            }
        }
        .task(id: model.generation) { await model.loadDictionary() }
    }

    private var add: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker(model.t(.dictKind), selection: $kind) {
                Text(model.t(.kindWord)).tag(DictionaryKind.word)
                Text(model.t(.kindReplace)).tag(DictionaryKind.replace)
                Text(model.t(.kindSnippet)).tag(DictionaryKind.snippet)
            }
            .pickerStyle(.menu)
            .frame(maxWidth: 260)
            .accessibilityIdentifier("zs-dict-kind")
            HStack {
                TextField(model.t(.dictPhrase), text: $phrase)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("zs-dict-phrase")
                if kind != .word {
                    TextField(model.t(.dictReplacement), text: $replacement)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("zs-dict-replacement")
                }
                Button(model.t(.dictAdd)) {
                    let (k, p, r) = (kind, phrase, replacement)
                    Task {
                        // Cleared only once the server has it: a refusal keeps what was typed.
                        if await model.addEntry(kind: k, phrase: p, replacement: r), phrase == p, replacement == r {
                            phrase = ""
                            replacement = ""
                        }
                    }
                }
                .disabled(DictionaryEntry.addBody(kind: kind, phrase: phrase, replacement: replacement) == nil)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("zs-dict-add")
            }
        }
    }

    private func row(_ entry: DictionaryEntry, canDelete: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(entry.phrase).lineLimit(2)
            if entry.kind != .word {
                Image(systemName: "arrow.right").foregroundStyle(.secondary).accessibilityHidden(true)
                Text(entry.replacement).lineLimit(2).foregroundStyle(.secondary)
            }
            if entry.shared {
                Text(model.t(.dictTeam)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            if canDelete {
                Button(model.t(.dictDelete)) { model.deleteEntry(entry.id) }
                    .accessibilityIdentifier("zs-dict-delete-\(entry.id)")
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("zs-dict-entry-\(entry.id)")
    }
}

// MARK: History

private struct HistorySection: View {
    @ObservedObject var model: SettingsModel
    @State private var copied: String?
    @State private var pasted: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if model.pending > 0 {
                VStack(alignment: .leading, spacing: 6) {
                    Text(model.t(.pendingTitle)).font(.headline)
                    Help(model.t(.pendingHelp, ["n": String(model.pending)]))
                    Button(model.t(.pendingSend)) { model.retryPending() }
                        .accessibilityIdentifier("zs-history-retry")
                }
                Divider()
            }
            Help(model.t(.historyHelp))
            if model.pasteAccess == .allowed && model.settings.autoPaste { Help(model.t(.historyPasteHelp)) }
            if case let .ok(items)? = model.history {
                if items.isEmpty {
                    Text(model.t(.historyEmpty)).foregroundStyle(.secondary)
                } else {
                    VStack(spacing: 0) {
                        ForEach(items) { item in
                            row(item)
                            if item.id != items.last?.id { Divider() }
                        }
                    }
                    .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color(nsColor: .separatorColor)))
                }
            } else {
                RemoteNote(model: model, state: model.history) { Task { await model.loadHistory() } }
            }
        }
        .task(id: model.generation) {
            model.dictationChanged()
            await model.loadHistory()
        }
    }

    private func meta(_ item: HistoryItem) -> String {
        var parts: [String] = []
        if let date = item.startedAt {
            let f = RelativeDateTimeFormatter()
            f.locale = Locale(identifier: model.lang.rawValue)
            parts.append(f.localizedString(for: date, relativeTo: Date()))
        }
        if item.durationMs > 0 {
            let s = item.durationMs / 1000
            parts.append(String(format: "%d:%02d", s / 60, s % 60))
        }
        return parts.joined(separator: " · ")
    }

    private func row(_ item: HistoryItem) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text(item.text).lineLimit(3).textSelection(.enabled)
                Text(meta(item)).font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Button(pasted == item.id ? model.t(.hudPasted) : model.t(.historyPaste)) {
                Task {
                    if await model.pasteFromHistory(item.text) == .pasted { pasted = item.id }
                }
            }
            .accessibilityIdentifier("zs-history-paste-\(item.id)")
            Button(copied == item.id ? model.t(.copied) : model.t(.menuCopy)) {
                model.copy(item.text)
                copied = item.id
            }
            .accessibilityIdentifier("zs-history-copy-\(item.id)")
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 10)
    }
}

// MARK: Account

private struct AccountSection: View {
    @ObservedObject var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch model.account {
            case let .ok(info)?:
                if !info.name.isEmpty { Text(info.name).font(.headline) }
                Text(model.t(.accountSignedIn, ["email": info.email])).accessibilityIdentifier("zs-account-state")
                Button(model.t(.signOut)) { model.signOut() }
                    .accessibilityIdentifier("zs-account-signout")
            case .signedOut?:
                Text(model.t(.accountSignedOut)).accessibilityIdentifier("zs-account-state")
                Button(model.t(.signIn)) { model.signIn() }
                    .accessibilityIdentifier("zs-account-signin")
            default:
                RemoteNote(model: model, state: model.account) { Task { await model.loadAccount() } }
            }
        }
        .task(id: model.generation) { await model.loadAccount() }
    }
}
