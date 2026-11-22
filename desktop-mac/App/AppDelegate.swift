import AppKit
import WebKit

/// Windows with tabs, each tab a web view of the server with the navigation policy and the load
/// watchdog (blocks 1, 2 and 4 of docs/desktop-swift.md); Google sign-in, `zerosoft://` links,
/// notifications and the Dock badge (block 3); the menu bar item, the Settings window, the
/// onboarding and the login item (block 5); dictation in any app (block 6); meetings: the
/// computer's audio, the recording indicator and the menu bar dot (block 7); Rec's floating bar,
/// camera bubble and shortcuts (block 8). The app's own
/// requests go only to the server: the token exchange, the badge poll, the Settings window's
/// and the dictation's (NativeHTTP).
@main
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var tabs: TabsController!
    private var auth: AuthController!
    private var notifier: Notifier!
    private var model: SettingsModel!
    private let statusItem: StatusItemController
    private var settingsWindow: SettingsWindowController?
    private var onboarding: OnboardingWindowController?
    private var dictation: DictationController!
    private var meetings: MeetingsController!
    private var rec: RecController!
    /// The onboarding opens after the first window (`-ZSOnboarding YES` forces it in a test).
    private var showOnboarding = false
    private var server = Server.defaultOrigin
    /// The tabs exist (a link that arrives before waits in `launchLink`).
    private var started = false
    /// A link that arrived before the windows existed (the app was launched by it).
    private var launchLink: URL?
    /// UI tests: what each deep link did.
    private var onDeepLink: ((String) -> Void)?
    private let lang = Lang.pick(Locale.preferredLanguages)
    /// The page of the first window when there is no saved session.
    private var firstPath = TabSession.home

    override init() {
        statusItem = StatusItemController(lang: Lang.pick(Locale.preferredLanguages))
        super.init()
    }
    #if DEBUG
    private var testPanel: TestPanel?
    #endif

    static func main() {
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let defaults = UserDefaults.standard
        let server = Server.resolve(defaults.string(forKey: Server.defaultsKey))
        self.server = server
        let lockdown = LockdownSetting(raw: defaults.string(forKey: LockdownSetting.defaultsKey))
        // No macOS window tabs: the app has its own strip.
        NSWindow.allowsAutomaticWindowTabbing = false

        var openExternal: (URL) -> Void = { NSWorkspace.shared.open($0) }
        var testing = false
        #if DEBUG
        testing = defaults.bool(forKey: "ZSUITest")
        if testing {
            let panel = TestPanel()
            testPanel = panel
            // UI tests: record what would open in the browser instead of launching it.
            openExternal = { [weak panel] url in panel?.external(url) }
        }
        #endif
        // Meetings (block 7): nothing here asks for a permission either; Screen Recording and the
        // computer's audio are asked for on the first capture or from their Settings button.
        let systemCapture = SystemCapturePermissions()
        var capture: CapturePermissions = systemCapture
        var makeSystemAudio: () -> SystemAudioSource? = { systemCapture.makeSource() }
        #if DEBUG
        var fakeCapture: FakeCapturePermissions?
        if testing {
            // CI cannot grant Screen Recording or system audio recording, or answer the prompts.
            let access = FakeCapturePermissions.Access(rawValue: defaults.string(forKey: "ZSSystemAudio") ?? "") ?? .ask
            let backend: SystemAudioBackend = defaults.string(forKey: "ZSSystemAudioBackend") == "screen" ? .screenCapture : .processTap
            let fake = FakeCapturePermissions(audio: access, backend: backend)
            fakeCapture = fake
            capture = fake
            makeSystemAudio = { FakeSystemAudioSource(permissions: fake) }
        }
        #endif
        // Rec (block 8): the camera is asked for on first use (a page's camera, Rec's bubble) or
        // from Settings › Permissions, never here.
        var cameraPermission: CameraPermission = SystemCameraPermission()
        var makeCameraPreview: () -> CameraPreview = { SystemCameraPreview() }
        #if DEBUG
        var fakeCamera: FakeCameraPermission?
        var fakePreview: FakeCameraPreview?
        if testing {
            // CI has no camera and cannot answer the prompt.
            let raw = defaults.string(forKey: "ZSCamera")
            let fake = FakeCameraPermission(raw == "allowed" ? .allowed : raw == "denied" ? .denied : .notDetermined)
            let preview = FakeCameraPreview(works: !defaults.bool(forKey: "ZSCameraMissing"))
            fakeCamera = fake
            fakePreview = preview
            cameraPermission = fake
            makeCameraPreview = { preview }
        }
        #endif
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
        let info = BridgeInfo(version: version, store: Self.storeBuild, lockdown: lockdown, systemAudio: capture.backend != .none)
        let lang = self.lang
        let http = NativeHTTP(server: server)
        let auth = AuthController(server: server, lang: lang, http: http)
        let notifier = Notifier(server: server, http: http)
        self.auth = auth
        self.notifier = notifier

        let store = SessionStore.standard(testing: testing)
        let tabs = TabsController(server: server, lang: lang, store: store) {
            WebController(server: server, lockdown: lockdown, info: info, lang: lang, openExternal: openExternal)
        }
        self.tabs = tabs
        tabs.configure = { [weak auth, weak notifier, weak self] web in
            // The sign-in sheet goes on the window of the tab that asked for it.
            web.onStartLogin = { [weak web] in
                auth?.window = web?.webView.window
                auth?.begin()
            }
            web.onNotify = { title, body in notifier?.pageNotification(title: title, body: body) }
            // Only the tab in front of the window in front, while the app is in front: a page in
            // a background tab cannot pull the app over other apps.
            web.onOpenSettings = { [weak web] in
                guard let self, let web, NSApp.isActive, self.tabs.activeWeb === web else { return }
                self.openSettings(nil)
            }
        }
        auth.onSignedIn = { [weak tabs, weak notifier, weak self] in
            tabs?.signedIn()
            notifier?.restart()
            self?.model?.sessionChanged()
        }
        notifier.openPath = { [weak tabs] url in tabs?.navigateActive(url) }
        notifier.onUnread = { [weak tabs] products in tabs?.setUnread(products) }

        // Settings, onboarding, menu bar item (block 5).
        let settingsStore = SessionStore.settings(testing: testing)
        var loginItems: LoginItemService = SystemLoginItem()
        var permission: NotificationPermission = SystemNotificationPermission()
        // Dictation (block 6): nothing here asks for a permission; the microphone prompt waits
        // for the first dictation or its button, Accessibility for its button.
        var mic: MicrophonePermission = SystemMicrophonePermission()
        var paste: PastePermission = SystemPastePermission(buildAllows: SystemPastePermission.flag)
        var makeSource: () -> AudioSource = { EngineCapture() }
        var pendingDir = SessionStore.standard(testing: false).url.deletingLastPathComponent().appendingPathComponent("pending", isDirectory: true)
        #if DEBUG
        var fakeLogin: FakeLoginItem?
        var fakePermission: FakeNotificationPermission?
        var fakeMic: FakeMicrophonePermission?
        var fakePaste: FakePastePermission?
        if testing {
            if !defaults.bool(forKey: "ZSKeepSettings") { settingsStore.remove() }
            let login = FakeLoginItem(on: false)
            let ask = FakeNotificationPermission()
            fakeLogin = login
            fakePermission = ask
            loginItems = login
            permission = ask
            // CI has no microphone, cannot answer the prompts and must not post keystrokes.
            let micAccess: MicrophoneAccess = defaults.bool(forKey: "ZSMicAllowed") ? .allowed : defaults.bool(forKey: "ZSMicDenied") ? .denied : .notDetermined
            let m = FakeMicrophonePermission(micAccess)
            let p = FakePastePermission(buildAllows: !defaults.bool(forKey: "ZSCopyOnly"), allowed: defaults.bool(forKey: "ZSPasteAllowed"))
            fakeMic = m
            fakePaste = p
            mic = m
            paste = p
            makeSource = { FakeAudioSource() }
            pendingDir = pendingDir.deletingLastPathComponent().appendingPathComponent("pending-uitest", isDirectory: true)
            if !defaults.bool(forKey: "ZSKeepPending") { try? FileManager.default.removeItem(at: pendingDir) }
        }
        #endif
        let model = SettingsModel(
            lang: lang, server: server, lockdown: info.lockdown, store: settingsStore,
            remote: SettingsRemote(server: server, http: http), loginItems: loginItems, permission: permission,
            mic: mic, paste: paste, capture: capture, camera: cameraPermission
        )
        self.model = model
        #if DEBUG
        // UI tests: a shortcut other than the default (Option-only shortcuts are a known
        // problem on macOS 15, section 2.2), set as if chosen in Settings.
        if testing, let name = defaults.string(forKey: "ZSTestShortcut"), let shortcut = DictationShortcut.named(name) {
            model.update { $0.shortcut = shortcut }
        }
        #endif
        // Dictation's own client: a long dictation with AI cleanup can keep the server quiet for
        // most of its 60 seconds, longer than the other requests' idle timeout.
        let dictation = DictationController(
            server: server, lang: lang, http: NativeHTTP(server: server, timeout: 75), store: PendingStore(dir: pendingDir), settings: model.settings,
            mic: mic, paste: paste, makeSource: makeSource
        )
        self.dictation = dictation
        let systemAudio = SystemAudioController(makeSource: makeSystemAudio)
        systemAudio.available = { [weak model] in
            SystemAudioRules.available(allowed: model?.settings.allowSystemAudio ?? false, lockdown: info.lockdown, backend: capture.backend)
        }
        let meetings = MeetingsController(server: server, lang: lang, tabs: tabs, systemAudio: systemAudio)
        self.meetings = meetings
        let rec = RecController(lang: lang, tabs: tabs, camera: makeCameraPreview(), cameraPermission: cameraPermission)
        self.rec = rec
        tabs.configureTab = { [weak meetings, weak rec] id, web in
            meetings?.wire(web, tab: id)
            rec?.wire(web, tab: id)
            web.mediaInUse = { [weak tabs] in
                guard let tabs else { return false }
                return tabs.tabInUse(id) || tabs.keepAlive(id)
            }
            // A new document or an ended web process: its Rec recording is over too.
            let gone = web.onDocumentGone
            web.onDocumentGone = { [weak rec] in
                gone?()
                rec?.tabGone(id)
            }
        }
        // The meetings controller set these; Rec joins them.
        let keepAlive = tabs.keepAlive
        tabs.keepAlive = { [weak rec] id in keepAlive(id) || rec?.records(id) == true }
        let tabGone = tabs.onTabGone
        tabs.onTabGone = { [weak rec] id in
            tabGone(id)
            rec?.tabGone(id)
        }
        let frontChange = tabs.onFrontChange
        tabs.onFrontChange = { [weak rec] in
            frontChange()
            rec?.frontChanged()
        }
        meetings.recTabs = { [weak rec] in rec?.sessions.marked ?? [] }
        // The bar marks the computer's audio only when its own recording captures it.
        meetings.recBar = { [weak rec, weak systemAudio] in
            guard let owner = systemAudio?.owner else { return false }
            return rec?.hasBar(owner) == true
        }
        rec.onCameraAsked = { [weak model] in model?.refreshDictationAccess() }
        rec.onChange = { [weak meetings] in meetings?.recChanged() }
        meetings.indicator.saved = { [weak model] in model?.settings.indicatorPosition }
        meetings.onMoved = { [weak model] p in model?.update { $0.indicatorPosition = p } }
        meetings.onCapture = { [weak self] in self?.captureChanged() }
        meetings.apply(model.settings)
        model.onPrefs = { [weak tabs] prefs in tabs?.setPrefs(prefs) }
        model.onSettings = { [weak self] settings in
            self?.statusItem.setShown(settings.menuBarItem)
            self?.dictation.apply(settings)
            self?.meetings.apply(settings)
        }
        dictation.onChange = { [weak self] in
            guard let self else { return }
            self.captureChanged()
            self.model.dictationChanged()
        }
        statusItem.onOpenRecording = { [weak meetings] in meetings?.open() }
        statusItem.onStopRecording = { [weak meetings] in meetings?.stop() }
        statusItem.onStopSystemAudio = { [weak systemAudio] in systemAudio?.stop(.user) }
        statusItem.onOpenRec = { [weak rec] in rec?.open() }
        // Finish: the page stops and uploads; the computer's audio it captured stops right away.
        let finishRec = { [weak rec, weak systemAudio] in
            guard let rec, let owner = rec.sessions.owner else { return }
            rec.finish()
            if systemAudio?.owner == owner { systemAudio?.stop(.user) }
        }
        statusItem.onStopRec = finishRec
        model.onStopRecording = { [weak meetings] in
            meetings?.stop()
            finishRec()
        }
        model.onOpenVoice = { [weak tabs, server] in
            NSApp.activate(ignoringOtherApps: true)
            if let url = URL(string: server + "/app/voice/meetings") { tabs?.navigateActive(url) }
        }
        statusItem.dictation = { [weak dictation] in dictation?.menuState }
        statusItem.shortcutLabel = { [weak dictation] in dictation?.shortcut.label ?? "" }
        statusItem.onDictate = { [weak dictation] in dictation?.toggleFromMenu() }
        statusItem.onPasteLast = { [weak dictation] in dictation?.pasteLast() }
        statusItem.onRetry = { [weak dictation] in dictation?.retryPending() }
        statusItem.onHistory = { [weak self] in self?.openSettings(section: .history) }
        model.onSignIn = { [weak self] in self?.signIn() }
        model.onSignedOut = { [weak tabs, weak notifier] in
            tabs?.signedIn()
            notifier?.restart()
        }
        model.onOpenWebSettings = { [weak tabs, server] in
            if let url = URL(string: server + "/app/settings") { tabs?.navigateActive(url) }
        }
        model.onShowOnboarding = { [weak self] in self?.openOnboarding() }
        notifier.onSession = { [weak self] signedIn, total in
            self?.statusItem.signedIn = signedIn
            self?.statusItem.unread = total
        }
        statusItem.onOpen = { [weak tabs] in
            NSApp.activate(ignoringOtherApps: true)
            tabs?.showLast()
        }
        statusItem.onNewTab = { [weak tabs] in
            NSApp.activate(ignoringOtherApps: true)
            tabs?.newTab(nil)
        }
        statusItem.onNewWindow = { [weak tabs] in
            NSApp.activate(ignoringOtherApps: true)
            tabs?.newWindowAction(nil)
        }
        statusItem.onSettings = { [weak self] in self?.openSettings(nil) }
        statusItem.onSignIn = { [weak self] in self?.signIn() }
        statusItem.onSignOut = { [weak model] in model?.signOut() }
        statusItem.setShown(model.settings.menuBarItem)
        showOnboarding = OnboardingStep.shouldShow(model.settings, testing: testing, forced: defaults.bool(forKey: "ZSOnboarding"))
        #if DEBUG
        if testing, let panel = testPanel {
            let configure = tabs.configure
            tabs.configure = { [weak panel] web in
                configure(web)
                panel?.watch(web)
            }
            panel.watch(auth: auth, notifier: notifier)
            if let fakeLogin, let fakePermission {
                panel.watch(settings: model, login: fakeLogin, permission: fakePermission)
                let onSettings = model.onSettings
                model.onSettings = { [weak panel, weak dictation] settings in
                    onSettings(settings)
                    panel?.set("zs-test-settings", settings.summary)
                    panel?.set("zs-test-dictset", dictation?.settings.dictationSummary ?? "none")
                }
            }
            if let fakeMic, let fakePaste {
                panel.watch(dictation: dictation, mic: fakeMic, paste: fakePaste)
            }
            if let fakeCamera, let fakePreview {
                panel.watch(rec: rec, camera: fakeCamera, preview: fakePreview)
            }
            if let fakeCapture {
                panel.watch(meetings: meetings, capture: fakeCapture, statusItem: statusItem)
                let onSettings = model.onSettings
                model.onSettings = { [weak panel] settings in
                    onSettings(settings)
                    panel?.set("zs-test-meetset", settings.meetingsSummary)
                }
                panel.set("zs-test-meetset", model.settings.meetingsSummary)
            }
            onDeepLink = { [weak panel] what in panel?.deepLink(what) }
            var saves = 0
            tabs.onChange = { [weak panel] session in
                panel?.set("zs-test-tabs", "tabs \(session.summary) end")
                panel?.set("zs-test-prefs", session.prefs.summary)
            }
            tabs.onSaved = { [weak panel] in
                saves += 1
                panel?.set("zs-test-session", "saved \(saves)")
            }
            notifier.useSystemCenter = false
            auth.testBrowser = TestBrowser.follow
            // Each test starts with no session file unless it asks to keep one (the relaunch
            // test), or hands one over to check what a restore accepts.
            if !defaults.bool(forKey: "ZSKeepSession") { store.remove() }
            if let given = defaults.string(forKey: "ZSTestSession").flatMap({ Data(base64Encoded: $0) }) { store.write(given) }
            // The fixture's main page is the server root; a fresh session opens it instead of
            // the home page.
            if let path = defaults.string(forKey: "ZSStartPath") { firstPath = path }
        }
        #endif

        model.dictation = dictation
        dictation.start()
        NSApp.mainMenu = MainMenu.build(lang: lang, tabs: tabs, settings: self, settingsAction: #selector(openSettings(_:)))
        NSApp.activate(ignoringOtherApps: true)
        #if DEBUG
        if testing {
            // Each UI test starts signed out: no session cookie left by an earlier test.
            Task { @MainActor in
                let data = WKWebsiteDataStore.default()
                await data.removeData(ofTypes: [WKWebsiteDataTypeCookies], modifiedSince: .distantPast)
                self.startTabs()
            }
            return
        }
        #endif
        startTabs()
    }

    private func startTabs() {
        let first = launchLink.flatMap(appPage).map(TabsController.path(of:))
        launchLink = nil
        tabs.start(launchPath: first, firstPath: firstPath)
        started = true
        notifier.start()
        if showOnboarding {
            showOnboarding = false
            openOnboarding()
        }
    }

    // MARK: Settings, onboarding (block 5)

    /// Cmd+, the menu bar item and the page's `openSettings()`.
    @objc func openSettings(_ sender: Any?) {
        openSettings(section: nil)
    }

    private func openSettings(section: SettingsSection?) {
        let controller = settingsWindow ?? SettingsWindowController(model: model)
        settingsWindow = controller
        model.prefs = tabs.session.prefs
        controller.show(section)
    }

    private func openOnboarding() {
        let controller = onboarding ?? OnboardingWindowController(model: model)
        onboarding = controller
        controller.show()
    }

    /// Sign-in from Settings, the onboarding or the menu bar item: the browser sheet goes on the
    /// window in front (a tab window is shown first when every window is closed).
    private func signIn() {
        if !tabs.hasVisibleWindow { tabs.showLast() }
        auth.window = tabs.activeWeb?.webView.window ?? NSApp.keyWindow
        auth.begin()
    }

    func applicationWillTerminate(_ notification: Notification) {
        meetings?.systemAudio.stop(.user)
        tabs?.willTerminate()
    }

    /// The menu bar item and Settings › Meetings show what records now.
    private func captureChanged() {
        let now = CaptureState(
            dictation: dictation?.machine.phase == .recording,
            meeting: meetings?.recording != nil,
            systemAudio: meetings?.systemAudio.running ?? false,
            rec: rec?.marking ?? false
        )
        statusItem.setCapture(now)
        model?.captureChanged(now)
    }

    // MARK: Deep links

    /// `zerosoft://` links (CFBundleURLTypes). Only `open` with a safe app path does anything:
    /// it shows that page of the configured server in the tab in front. A sign-in callback is
    /// accepted only by the ASWebAuthenticationSession that asked for it, so a link with one is
    /// ignored here.
    func application(_ application: NSApplication, open urls: [URL]) {
        for url in urls.prefix(1) {
            guard started else {
                launchLink = url
                return
            }
            if let page = appPage(url) {
                tabs.navigateActive(page)
            } else {
                tabs.showLast()
            }
        }
    }

    /// The server page a link opens, or nil (and the reason for the tests).
    private func appPage(_ url: URL) -> URL? {
        switch DeepLink.parse(url) {
        case let .open(path)?:
            guard let target = DeepLink.target(for: path, server: server) else {
                onDeepLink?("refused \(url.absoluteString)")
                return nil
            }
            onDeepLink?("open \(path)")
            return target
        case .auth?:
            onDeepLink?("ignored auth")
            return nil
        case nil:
            onDeepLink?("refused \(url.absoluteString)")
            return nil
        }
    }

    /// The Mac App Store build (`STORE` compilation condition, block 10) hides purchase links.
    #if STORE
    static let storeBuild = true
    #else
    static let storeBuild = false
    #endif

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        if !tabs.hasVisibleWindow { tabs.showLast() }
        return true
    }

    /// Dock menu: New Window.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        let item = menu.addItem(withTitle: Strings.text(.menuNewWindow, lang), action: #selector(TabsController.newWindowAction(_:)), keyEquivalent: "")
        item.target = tabs
        return menu
    }
}
