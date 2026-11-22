import AppKit
import os
import WebKit

/// Where the app's settings live: settings.json next to session.json (SessionStore writes it
/// atomically, readable only by the user). Switches only, see AppSettings.
extension SessionStore {
    static func settings(testing: Bool) -> SessionStore {
        let session = standard(testing: testing).url.deletingLastPathComponent()
        return SessionStore(url: session.appendingPathComponent(testing ? "settings-uitest.json" : "settings.json"))
    }
}

/// The Settings window's requests (SettingsEndpoint) with the web views' session, as the Tauri
/// app's settings commands do. Nothing here logs a request, a header or a body.
@MainActor
final class SettingsRemote {
    private static let log = Logger(subsystem: "ai.zerosoft.mac", category: "settings")
    private let server: String
    private let http: NativeHTTP

    init(server: String, http: NativeHTTP) {
        self.server = server
        self.http = http
    }

    func call<T>(_ endpoint: SettingsEndpoint, body: Data? = nil, _ parse: (Data) -> T?) async -> Remote<T> {
        guard let request = endpoint.request(server: server, body: body) else { return .failed }
        let answer = await http.send(request, withSession: true)
        return Remote.from(status: answer?.status, body: answer?.body, parse)
    }

    /// next-auth's sign-out (auth.rs `server_sign_out`): the CSRF token and its cookie, then the
    /// POST that also ends the session on the server, so the token is worthless even if it was
    /// copied. The session cookies are deleted from the web views' store whatever the server
    /// answered.
    func signOut() async {
        await serverSignOut()
        await deleteSessionCookies()
    }

    private func serverSignOut() async {
        guard let csrf = SettingsEndpoint.csrf.request(server: server),
              let first = await http.exchange(csrf, withSession: true), first.status == 200,
              let token = SignOut.csrfToken(first.body),
              let post = SettingsEndpoint.signOut.request(server: server, body: SignOut.form(token: token), form: true) else {
            Self.log.notice("sign-out on the server skipped")
            return
        }
        let done = await http.exchange(post, withSession: true, extra: first.cookies)
        if done?.status != 200 { Self.log.notice("sign-out on the server failed") }
    }

    private func deleteSessionCookies() async {
        let host = URL(string: server)?.host?.lowercased() ?? ""
        let store = WKWebsiteDataStore.default().httpCookieStore
        for cookie in await store.allCookies() where LoginFlow.isSessionCookie(name: cookie.name, domain: cookie.domain, host: host) {
            await store.deleteCookie(cookie)
        }
    }
}

/// What the Settings window and the onboarding show and change. The app's switches go to
/// settings.json, the tab preferences to session.json (through the tabs controller), the login
/// item to the system; what comes from the server stays in memory.
@MainActor
final class SettingsModel: ObservableObject {
    let lang: Lang
    let server: String
    let lockdown: Bool
    private let store: SessionStore
    private let remote: SettingsRemote
    let loginItems: LoginItemService
    let permission: NotificationPermission

    @Published private(set) var settings: AppSettings
    @Published var prefs = TabPrefs() {
        didSet { if prefs != oldValue { onPrefs(prefs) } }
    }
    @Published private(set) var loginItem: LoginItemState = .disabled
    @Published private(set) var loginItemFailed = false
    @Published private(set) var notifications: NotificationAccess = .notDetermined
    /// nil while loading.
    @Published private(set) var account: Remote<AccountInfo>?
    @Published private(set) var voice: Remote<VoiceSettings>?
    @Published private(set) var voiceSave: Bool?
    @Published private(set) var dictionary: Remote<DictionaryList>?
    @Published private(set) var dictionaryFailed = false
    @Published private(set) var history: Remote<[HistoryItem]>?
    /// Bumped when the session changes (sign-in or sign-out from anywhere): the visible server
    /// section loads again (`.task(id:)`).
    @Published private(set) var generation = 0

    /// Wired by the app delegate.
    var onSettings: (AppSettings) -> Void = { _ in }
    var onPrefs: (TabPrefs) -> Void = { _ in }
    var onSignIn: () -> Void = {}
    var onSignedOut: () -> Void = {}
    var onOpenWebSettings: () -> Void = {}
    var onShowOnboarding: () -> Void = {}
    /// UI tests: each request the window made, by endpoint fact.
    var onRequest: ((String) -> Void)?

    init(lang: Lang, server: String, lockdown: Bool, store: SessionStore, remote: SettingsRemote,
         loginItems: LoginItemService, permission: NotificationPermission) {
        self.lang = lang
        self.server = server
        self.lockdown = lockdown
        self.store = store
        self.remote = remote
        self.loginItems = loginItems
        self.permission = permission
        settings = AppSettings.decode(store.read())
        loginItem = loginItems.state
    }

    func t(_ key: StringKey, _ vars: [String: String] = [:]) -> String {
        Strings.text(key, lang, vars)
    }

    // MARK: App switches

    func update(_ change: (inout AppSettings) -> Void) {
        var s = settings
        change(&s)
        guard s != settings else { return }
        settings = s
        store.write(s.encoded())
        onSettings(s)
    }

    func setLoginItem(_ on: Bool) {
        loginItemFailed = !loginItems.set(on)
        loginItem = loginItems.state
    }

    func refreshSystemState() async {
        loginItem = loginItems.state
        notifications = await permission.current()
    }

    /// The "Turn on notifications" button: the only place the system prompt comes from.
    func notificationButton() {
        switch notifications.buttonAction {
        case .ask:
            Task {
                notifications = await permission.request()
            }
        case .openSystemSettings:
            permission.openSystemSettings()
        case .none:
            break
        }
    }

    // MARK: Server sections

    private func record(_ endpoint: SettingsEndpoint) {
        onRequest?(endpoint.fact)
    }

    /// A sign-in or sign-out: the account and the visible section load again.
    func sessionChanged() {
        generation += 1
        Task { await loadAccount() }
    }

    func loadAccount() async {
        record(.account)
        account = await remote.call(.account, AccountInfo.parse)
    }

    func loadVoice() async {
        voice = nil
        record(.voiceSettings)
        voice = await remote.call(.voiceSettings, VoiceSettings.parse)
    }

    func saveVoice(_ new: VoiceSettings) {
        guard case let .ok(old)? = voice, let body = new.patch(from: old) else { return }
        voice = .ok(new)
        voiceSave = nil
        Task {
            record(.saveVoiceSettings)
            let answer = await remote.call(.saveVoiceSettings, body: body, VoiceSettings.parse)
            if case let .ok(saved) = answer {
                voice = .ok(saved)
                voiceSave = true
            } else {
                // What the server has now (a later change may have been saved meanwhile).
                voiceSave = false
                let fresh = await remote.call(.voiceSettings, VoiceSettings.parse)
                if case .ok = fresh { voice = fresh }
            }
        }
    }

    func loadDictionary() async {
        dictionary = nil
        dictionaryFailed = false
        record(.dictionary)
        dictionary = await remote.call(.dictionary, DictionaryList.parse)
    }

    /// Returns true once the server added the entry (the window clears its fields only then).
    func addEntry(kind: DictionaryKind, phrase: String, replacement: String) async -> Bool {
        guard let body = DictionaryEntry.addBody(kind: kind, phrase: phrase, replacement: replacement) else { return false }
        dictionaryFailed = false
        record(.addDictionaryEntry)
        let added = await remote.call(.addDictionaryEntry, body: body, DictionaryEntry.parseAdded)
        guard case .ok = added else {
            dictionaryFailed = true
            return false
        }
        await loadDictionary()
        return true
    }

    func deleteEntry(_ id: String) {
        guard DictionaryEntry.validID(id) else { return }
        Task {
            record(.deleteDictionaryEntry(id))
            let done: Remote<Bool> = await remote.call(.deleteDictionaryEntry(id)) { _ in true }
            if case .ok = done {
                if case var .ok(list)? = dictionary {
                    list.entries.removeAll { $0.id == id }
                    dictionary = .ok(list)
                }
            } else {
                dictionaryFailed = true
            }
        }
    }

    func loadHistory() async {
        history = nil
        record(.history)
        history = await remote.call(.history, HistoryItem.parseList)
    }

    func copy(_ text: String) {
        let board = NSPasteboard.general
        board.clearContents()
        board.setString(text, forType: .string)
    }

    func signIn() {
        onSignIn()
    }

    func signOut() {
        Task {
            record(.signOut)
            await remote.signOut()
            account = .signedOut
            voice = .signedOut
            dictionary = .signedOut
            history = .signedOut
            onSignedOut()
            sessionChanged()
        }
    }
}
