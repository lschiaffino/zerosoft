# A Swift Mac app for the Mac App Store and Lockdown Mode

Status: blocks 1 to 8 merged or in review (November 2026); the rest is plan. This document is step 1 of the gauntlet loop
that rewrites the Mac desktop app in Swift: it maps what the current app does, what Apple allows in
the Mac App Store, what Lockdown Mode changes, the architecture, the distribution plan and the
blocks (pull requests) that get us to 1.0.

The current app is Tauri 2 (`desktop/`, Rust in `desktop/src-tauri/src/`, local pages in
`desktop/ui/`, described in `desktop/README.md` and `docs/desktop-tabs.md`). It stays the Windows
app (section 5.4).

Sources are linked inline. Anything marked **(unconfirmed)** could not be checked against an Apple
page or a test and has to be verified in the block that depends on it.

## 0. Summary

- The Store build must be sandboxed (guideline 2.4.5(i)), cannot update itself (2.4.5(vii)), cannot
  use private APIs (2.5.1, and today's Tauri build uses `macOSPrivateApi` for transparent
  windows), and must be more than a repackaged website (4.2). An app whose main window is our web
  app needs native features a reviewer can see in the first minute: dictation into any app, the
  menu bar item, Rec overlays, meeting audio, native notifications and a native settings window.
- Dictation's paste into the front app (a synthetic Cmd+V with `CGEventPost`) is the riskiest
  feature for the Store. Apple DTS says posting events is compatible with the App Sandbox (with the
  user's approval in Privacy › Accessibility), but a sandboxed clipboard manager doing exactly this
  was rejected twice under 2.4.5 (section 2.2). The plan ships the Store build with "copy, then you
  press Cmd+V" as the baseline and tries auto-paste in review; the direct-download build always has
  auto-paste.
- Lockdown Mode, per WebKit's source, does **not** restrict the WKWebViews of a third-party Mac app
  when the user turns it on system-wide: on macOS it applies by default only to Safari and two Apple
  apps. An app can opt a web view in with `WKWebpagePreferences.isLockdownModeEnabled` (section 3).
  So Lockdown Mode is an unlikely cause of the white window a teammate saw. The current code has
  likelier causes (section 3.4). The Swift app makes that state impossible: a native tab strip and,
  per web view, a load and paint watchdog that replaces a blank, failed or crashed page with a native
  error view (Retry, Open in browser).
- If we opt our web views into Lockdown Mode (to honour the user's choice), WebKit turns off
  IndexedDB, service workers, `getUserMedia`, WebRTC, Web Audio and Notifications, which Talk,
  Rec, Voice meetings and offline use. CI runs every UI test twice, with Lockdown off and on, and the
  "on" run checks that the app still renders and that those features fail with a message instead of
  a blank page.
- Builds, signing and UI tests run on GitHub `macos-15` runners; this Mac has only the Command Line
  Tools. Block 1 is a minimal app: one window, one WKWebView of the server, the watchdog, the
  navigation policy, signed ad hoc in CI.

## 1. Feature inventory of the current Mac app

Every native capability of `desktop/src-tauri/src/`, with the macOS permission or entitlement it
uses today. The current app is signed ad hoc or with a self-made certificate
(`desktop/scripts/macos-signing-cert.sh`), hardened runtime on, not sandboxed, not notarized
(`tauri.conf.json`, `entitlements.plist`).

| File | What it does | macOS permission / entitlement today |
|---|---|---|
| `lib.rs` | App setup, plugins, bridge script `window.zerosoftDesktop` injected only when `location.origin` is the server, `window.Notification` shim, link handling (Cmd-click, middle click, context menu, Cmd+1..9) | none |
| `tabs.rs`, `session.rs`, `ui/tabs.*` | Windows with a tab strip in the title bar (a local page `tabs.html` in its own child webview), one child WKWebView per tab, reparenting between windows, lazy restore from `session.json`, idle tab suspension (30 min), Dock menu "New window" (objc `applicationDockMenu:`) | none (uses Tauri `unstable` multi-webview) |
| `nav.rs` | Navigation policy: only the exact server origin loads inside; Google sign-in goes to the system browser; integration OAuth opens its start route in the browser; other http(s), mailto, tel to the browser; every other scheme blocked | none |
| `auth.rs`, `api.rs` | Google sign-in in the system browser with PKCE, callback `zerosoft://auth/callback`, `POST /api/desktop/token`, session cookie put into the webview cookie store; native requests read that cookie (no own token copy) | network client |
| `deeplink.rs` | `zerosoft://auth/callback` and `zerosoft://open?path=/app/...`, validated field by field | `CFBundleURLTypes` (Tauri deep-link plugin) |
| `offline.rs` | 10 s watchdog per tab: if the first load did not finish, injects an offline page into the blank document | none |
| `dictation.rs`, `audio.rs`, `hud.rs`, `ui/hud.*` | Global shortcut (Carbon `RegisterEventHotKey`, Option+Space), hold or toggle, Esc to cancel; mic capture (cpal) to 16 kHz WAV; HUD (transparent, non-focusable, always on top, all Spaces); `POST /api/voice/dictate` | Microphone (`NSMicrophoneUsageDescription`, `com.apple.security.device.audio-input`) |
| `clipboard.rs`, `platform.rs` | Paste: saves the clipboard (text or image), writes the transcript marked concealed, posts Cmd+V with `CGEventPost` using the current keyboard layout (TIS/UCKeyTranslate), restores the clipboard 450 ms later | Accessibility (`AXIsProcessTrusted`) for `CGEventPost`; pasteboard (no permission) |
| `platform.rs` | Front app name (`/usr/bin/lsappinfo`), permission status for mic, camera, screen, Accessibility; `tccutil reset` to fix stale Accessibility entries; `codesign -d -r-` to read the signature kind; exe inode check (replaced on disk); `security` to delete the old Electron keychain item; opens System Settings panes (`x-apple.systempreferences:`) | runs `/usr/bin` tools as subprocesses |
| `retry.rs` | Failed dictations kept in `<data>/pending/` (20, one week) and resent | files in app data |
| `system_audio.rs` | System audio for meeting notes and Rec: ScreenCaptureKit `SCStream` with `capturesAudio`, `excludesCurrentProcessAudio`, PCM 16 kHz read by the page every 250 ms through the bridge | Screen Recording (`NSScreenCaptureUsageDescription`, `CGPreflightScreenCaptureAccess`) |
| `indicator.rs`, `ui/indicator.*` | Floating recording indicator (meeting recording while the window is not in front): open, stop, drag, remembers position | none (transparent window) |
| `rec_overlay.rs`, `ui/recbar.*`, `ui/recbubble.*` | Rec floating control bar (excluded from capture with `NSWindowSharingNone`) and the camera bubble (a local page with `getUserMedia`); global shortcuts Option+Shift+P / S while recording | Camera (`NSCameraUsageDescription`, `com.apple.security.device.camera`), Microphone |
| `tabs.rs` (`on_permission_request`) | Grants camera and mic to the server page only (Talk, Rec, Voice meetings); the page uses `getUserMedia`, `getDisplayMedia`, `MediaRecorder`, WebRTC | Camera, Microphone, Screen Recording (for `getDisplayMedia`) |
| `tray.rs` | Menu bar item with dictation, paste last, history, retry, Rec open/stop, system audio stop, settings, privacy, updates, sign out, quit; a dot while the mic, system audio or a recording is on; app menu (File, Edit, View, Window) | none |
| `badge.rs` | Polls `GET /api/desktop/badge` every 30 s; Dock badge count; native notification for new items when unfocused | Notifications (`UNUserNotificationCenter` through the plugin) |
| `commands.rs`, `ui/settings*` | Settings window (local page): onboarding, general, Voice, dictionary, history, permissions, privacy, account; bridge commands from the page | none |
| `config.rs` | `settings.json`: server URL (self-hosting), shortcut, mode, clipboard restore, privacy switches | files in app config |
| `updater.rs` | Tauri updater (minisign-signed) from `/api/desktop/update/latest.json`, background download, install on restart or quit | writes the app bundle |
| Autostart (plugin) | Open at login through a LaunchAgent plist | `~/Library/LaunchAgents` |
| `privacy.rs`, `privacy-facts.json`, `ui/settings-privacy.ts` | Privacy and data page: permissions with last use, stored files with sizes and delete, network requests, a closed-schema activity log (500 events, 30 days), export, delete all (incl. webview data and Electron leftovers) | files in app data |
| Single instance (plugin) | A second launch focuses the first | none |
| Window state (plugin) | Restores main window size and position | `window_state` file |

Bridge surface the web app uses today (`lib/desktop-bridge.ts`, `lib.rs` `bridge_script`):
`version`, `platform`, `systemAudio`, `dictation`, `recordingIndicator`, `startLogin()`,
`openSettings()`, `recording({active, startedAt, path})`, `systemAudioStart/Read/Stop()`,
`recOverlay({active, phase, elapsedMs, mic, camera})`, `recLevel(level)`, `notify(title, body)`,
plus internal `desktop_tabs` messages (`state`, `open`, `open-tab`, `open-window`, `menu`,
`select`, `prev`, `next`). Events from the app to the page: `zerosoft:stop-recording` and
`zerosoft:rec-control` (fixed list in `lib/rec-controls.ts`). `consumeAutostart` is typed in
`lib/desktop-bridge.ts` and used by `components/voice/MeetingView.tsx` but the Tauri app does not
implement it (Electron leftover). Callers: `components/rec/Recorder.tsx`,
`components/voice/{MeetingView,MeetingsHome,RecorderProvider,audio}.tsx`,
`components/auth/GoogleButton.tsx`, `components/settings/*`, `components/app/*`,
`components/desktop/*`, `lib/desktop-*.ts`.

## 2. Mac App Store constraints per feature

Guidelines: https://developer.apple.com/app-store/review/guidelines/ (section numbers below).
Entitlements: https://developer.apple.com/documentation/bundleresources/entitlements/.

### 2.1 Rules that apply to the whole app

- **2.4.5(i) sandbox required.** Every Store build has `com.apple.security.app-sandbox`.
- **2.4.5(ii)** built with Xcode and self-contained; **(iv)** may not download additional code to add
  functionality; **(vii)** "must use the Mac App Store to distribute updates; other update mechanisms
  are not allowed"; **(iii)** no auto-launch or login items without consent.
- **2.5.1 public APIs only.** Today's Tauri build enables `macOSPrivateApi` (transparent webview
  windows for the HUD, indicator and Rec bar): that alone would block a Store submission. The Swift
  app uses `NSPanel` with SwiftUI instead.
- **2.5.2 / 4.7 / 2.5.6.** Loading our web app in WebKit is allowed (apps that browse the web must
  use WebKit; HTML5 content not in the binary is allowed with us responsible for it).
- **4.2 minimum functionality.** The app must have "features, content, and UI that elevate it beyond
  a repackaged website", and 4.2.2 rules out apps that are mainly "web clippings, content
  aggregators, or a collection of links". This is the main review risk for an app whose windows are
  our web pages. What the reviewer must see without effort:
  1. Dictation in any app from a global shortcut, with a native HUD (the headline feature; it does
     not exist in the browser).
  2. A menu bar item with dictation, paste last, history and recording state.
  3. Meeting notes that capture the other side of a call (system audio) with a floating indicator.
  4. Rec with a floating control bar and a camera bubble over other apps.
  5. Native tabs and windows, native settings, native notifications with the Dock badge, offline
     start.
  The review notes say this in the first paragraph and the onboarding shows the dictation shortcut
  on first launch. A Store build without dictation and system audio would be a web wrapper and
  should not be submitted.
- **2.1 completeness.** Review needs a demo account and the backend on. The default server
  (`https://zerosoft.ai`) is what review sees; the custom server field (self-hosting) stays in
  Settings › Advanced. A built-in demo mode needs Apple's approval first, so we give a real demo
  account in App Store Connect.
- **4.8 login services.** Google sign-in is used for the primary account, so the Store build must
  also offer an equivalent option that limits data to name and email, allows a private email and
  does not track. Email sign-in with a one-time code is our own account system, which the guideline
  exempts ("your company's own account setup and sign-in systems"), but whether review accepts
  email codes as the equivalent is **(unconfirmed)**. Sign in with Apple meets the rule for certain;
  adding it is a server change (decision 7.3).
- **5.1.1(v) account deletion.** Accounts can be created in the app (sign-up inside the web view),
  so deleting the account must be possible in the app. The web app's account settings must expose
  it; check before submitting **(unconfirmed that it exists today)**.
- **3.1 payments.** Unlocking paid plans inside the app requires in-app purchase (3.1.1). 3.1.3(b)
  lets users use what they bought on the web only "provided those items are also available as in-app
  purchases within the app"; 3.1.3(a) (reader apps) does not cover a productivity suite. Linking out
  to buy is allowed only on the US storefront. Practical options: hide every upgrade, pricing and
  checkout link when the page runs in the Store build (the bridge reports `store: true`), or add
  IAP. Many productivity apps on the Store ship with sign-in only and no purchase UI; whether review
  accepts that for us is a judgment call **(unconfirmed)**. Decision 7.2.
- **2.5.14 recording.** Recording needs explicit consent and a clear visual indication. Today's menu
  bar dot, HUD, indicator and Rec bar already do this; keep them non-hideable.
- **Privacy manifest.** `PrivacyInfo.xcprivacy` declares collected data types "on all platforms",
  but the required-reason API declarations (UserDefaults, file timestamps, boot time, disk space)
  are required only on iOS, iPadOS, tvOS, visionOS and watchOS
  (https://developer.apple.com/documentation/bundleresources/privacy-manifest-files). We ship a
  manifest anyway (cheap, and it matches the App Store privacy labels).

### 2.2 Per feature

| Feature | Store build | Entitlements / Info.plist | Risk and notes |
|---|---|---|---|
| Web views of the server | Yes | `com.apple.security.network.client` | 4.2 (above). Navigation limited to the server origin |
| Downloads from the page | Yes | `com.apple.security.files.downloads.read-write` or `files.user-selected.read-write` with a save panel | Low |
| Microphone (dictation, meetings, Talk) | Yes | `com.apple.security.device.audio-input`, `NSMicrophoneUsageDescription` | Low |
| Camera (Talk, Rec bubble) | Yes | `com.apple.security.device.camera`, `NSCameraUsageDescription` | Low |
| Global shortcut | Yes | none | `RegisterEventHotKey` (Carbon) is widely reported to work in sandboxed Store apps without any permission, but no Apple statement was found **(unconfirmed)**. Known Sequoia bug with Option- or Shift-only modifiers (https://developer.apple.com/forums/thread/763878): test Option+Space on macOS 15 and 26. `NSEvent.addGlobalMonitorForEvents` needs Accessibility, so we do not use it |
| Paste into the front app (`CGEventPost` Cmd+V) | Try, with fallback | none; user approval in Privacy › Accessibility via `CGRequestPostEventAccess` (macOS 10.15+, https://developer.apple.com/documentation/coregraphics/cgrequestposteventaccess()) | Apple DTS: PostEvent and ListenEvent "*are* compatible with the App Sandbox", Accessibility (AX) APIs are not (https://developer.apple.com/forums/thread/820594). Same thread: a sandboxed clipboard manager posting Cmd+V was rejected twice under 2.4.5 for "Accessibility … for non-accessibility purposes", no resolution recorded. DTS points to Developer ID for this kind of feature (https://developer.apple.com/forums/thread/664959). Whether Store dictation apps (Superwhisper, Wispr Flow, MacWhisper) paste is **(unconfirmed)**; one comparison says MacWhisper's Store edition lacks system-wide dictation. Store build: the transcript is copied and the HUD says "Copied, press Cmd+V"; auto-paste is a feature flag we submit and turn off if rejected |
| `AXIsProcessTrusted`, `tccutil reset`, `codesign`, `security`, `lsappinfo` subprocesses | No | | AX is not available in the sandbox; replaced by `CGPreflightPostEventAccess`. The front app comes from `NSWorkspace.shared.frontmostApplication`. The Electron keychain cleanup and `tccutil` reset are dropped (the Store build has a stable signature, so the stale-permission problem they fixed goes away) |
| Clipboard save and restore | Yes | none | `NSPasteboard` works in the sandbox. macOS 15.4+ may show a paste-access alert when an app reads the pasteboard without user action **(unconfirmed for macOS 26; test)**; restoring needs a read |
| System audio (meetings, Rec) | Yes | `NSScreenCaptureUsageDescription` (ScreenCaptureKit) or `NSAudioCaptureUsageDescription` (Core Audio taps) | No Apple text forbids ScreenCaptureKit in sandboxed Store apps. Screen Recording permission re-prompts periodically on macOS 15 (reported by developers, not documented, https://developer.apple.com/forums/thread/761641). Core Audio process taps (`AudioHardwareCreateProcessTap`, macOS 14.2+, https://developer.apple.com/documentation/coreaudio/capturing-system-audio-with-core-audio-taps) ask only for "system audio recording" and fit meeting notes better. Plan: taps on 14.2+, ScreenCaptureKit audio on 13 to 14.1. `com.apple.developer.persistent-content-capture` is for VNC-type apps and needs a request form; not for us |
| Screen recording from the page (`getDisplayMedia` in Rec) | Yes | Screen Recording permission | Same TCC permission. `SCContentSharingPicker` (macOS 14) is the system picker; whether it avoids the TCC prompt is **(unconfirmed)** |
| Floating overlays (HUD, indicator, Rec bar, bubble) | Yes | none | `NSPanel`, public API. Rec bar `sharingType = .none` |
| Menu bar item, Dock badge, Dock menu | Yes | none | Low |
| Notifications | Yes | none | `UNUserNotificationCenter`; ask from onboarding |
| Deep links `zerosoft://` | Yes | `CFBundleURLTypes` | Low. Google sign-in with `ASWebAuthenticationSession` avoids depending on the scheme for auth |
| Open at login | Yes, opt-in | none | `SMAppService.mainApp` (macOS 13, https://developer.apple.com/documentation/servicemanagement/smappservice); off by default per 2.4.5(iii) |
| Self-updater | No | | 2.4.5(vii). Store updates only. Sparkle only in the direct build |
| Custom server URL | Yes | | Allowed as a setting (our inference from 2.1: review must work with the default). Bridge and navigation follow the configured origin |
| Privacy page, activity log, delete all | Yes | | Delete all removes the app container's data; the `.wipe-pending` restart flow stays |
| Single instance | Yes | | Default for an AppKit app |

## 3. Lockdown Mode

### 3.1 What it does to web content

Apple's page (https://support.apple.com/en-us/105120) says Lockdown Mode blocks "certain complex
web technologies", that web fonts may not show and images may be replaced, and that on Mac websites
are excluded from Safari settings. It describes per-app exclusions only for iPhone and iPad.

WebKit's source is precise. Preferences marked `disableInLockdownMode: true` in
`Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml`, plus `WebPage::adjustSettingsForLockdownMode`
in `Source/WebKit/WebProcess/WebPage/WebPage.cpp` (https://github.com/WebKit/WebKit), turn off:
JIT and WebAssembly, IndexedDB, service workers and the Cache API, `navigator.mediaDevices`
(`getUserMedia`), WebRTC (`RTCPeerConnection`), Web Audio, the Notification and Push APIs,
FileReader, File System Access, Gamepad, MathML, WebGL, WebGPU, WebXR, speech recognition and
synthesis, Web Locks, WebCodecs video, Web Share, WebTransport, picture in picture, the built-in PDF
viewer, XSLT and `<embed>`. Web fonts go through a restricted parser and media containers and codecs
are limited to an allowlist. `MediaRecorder` is not in the list.

### 3.2 Does it apply to our app?

Not by default. `isLockdownModeEnabledBySystemIgnoringCaching()` in
`Source/WebKit/UIProcess/Cocoa/WebProcessPoolCocoa.mm` (WebKit `main`, checked 2026-11-19) returns
false on `PLATFORM(MAC)` unless the process is Safari, MiniBrowser or Captive Network Assistant. So
with system Lockdown Mode on, the WKWebViews of a native AppKit app (the Tauri app today, the Swift
app tomorrow) run without those restrictions. iPad and Catalyst apps on the Mac are a different case:
Element's iPad build shows a grey call view under Lockdown Mode on macOS
(https://github.com/element-hq/element-x-ios/issues/6152). One more reason not to build a Catalyst
app. The WebKit that ships in a given macOS release may differ from `main` **(unconfirmed for
macOS 15 and 26 builds; block 2 tests it on the runner)**.

An app can opt in or out per navigation with `WKWebpagePreferences.isLockdownModeEnabled`
(macOS 13+, https://developer.apple.com/documentation/webkit/wkwebpagepreferences/islockdownmodeenabled):
"update this preference to override the device setting". Setting it to false throws only on iOS
without the browser entitlement; there is no such check on macOS. So the app can test with Lockdown
restrictions forced on, on any runner, without turning on system Lockdown Mode.

Whether the system's Lockdown Mode affects anything else the app does (camera, mic, ScreenCaptureKit,
custom URL schemes, notifications) on macOS is **(unconfirmed)**. Apple's list for the Mac covers
messages, web browsing, FaceTime, shared albums, device connections, configuration profiles and
MDM; none of those is something we use.

### 3.3 Does our web app use anything affected?

Grep of `app/`, `components/`, `lib/`, `public/` (2026-11-19), only matters if restrictions apply
(the app opts in, or a future macOS changes the default):

| Feature | Where | With Lockdown restrictions |
|---|---|---|
| WebAssembly | none in our code; `pdfjs-dist` (Sign, Notes, WhatsApp PDF thumbnails) may use Wasm decoders for some images **(unconfirmed)** | Those images fail; JS fallbacks |
| Web fonts | `next/font/google` self-hosted fonts in `app/[locale]/layout.tsx` (Space Grotesk, IBM Plex Mono) and Design's fonts (`components/design/fonts.ts`); KaTeX fonts in Docs | Fall back to system fonts (layout shifts, no blank page). Contrary to the brief, the app does use web fonts |
| WebGL | `lib/desktop-detect.ts` (GPU name to guess the Mac chip, download page only) | Falls back to the guess path |
| Service workers, Cache API | `public/sw.js` (offline) | Offline start stops working; online is fine |
| IndexedDB | 7 files (offline stores) | Any code that assumes it exists must catch; a thrown `indexedDB` access at startup could break a whole app page. Audit in block 2 |
| `getUserMedia`, Web Audio, WebRTC | Talk (`components/talk/huddle-client.ts`), Rec, Voice meetings (`components/voice/*`) | Calls, Rec and meeting capture in the page do not work; must say so in words |
| Notifications | the bridge replaces `window.Notification` with the native shim | Not affected (native) |
| MathML | Docs math (KaTeX output) | Falls back to KaTeX HTML rendering **(unconfirmed)** |
| JIT | all JS | Slower (interpreter only), still renders |

None of these explains a fully white window including the tab strip.

### 3.4 The white window a teammate saw

Facts: the whole window was white, tab strip included. The strip (`desktop/ui/tabs.html`) paints a
grey background (`--strip: #e8e8e8`, dark `#1b1b1b`) from CSS alone, before any script runs. A white
strip means its web view never painted, so the failure is below our web code. Given 3.2, Lockdown
restrictions are unlikely. Plausible causes in the current Tauri code, most likely first:

1. **Child web views not attached or zero-sized.** Each window is a bare `Window` with child
   webviews added by `add_child` (Tauri `unstable` multi-webview). If adding the strip or the tab
   fails, or its frame is computed from the inner size of a hidden window
   (`build_window` creates the window with `visible(false)` and lays out children before `show`),
   the user sees only the NSWindow background: white in light mode. `ensure_webview` drops the
   error (`add_child(...).ok()?`) and then never starts the offline watchdog.
2. **Two restorers of geometry.** `tauri-plugin-window-state` restores the `main` window while
   `session.json` also stores bounds; `layout()` only runs on `Resized`. A restore that changes the
   size without a resize event would leave children at the old frame **(unconfirmed)**.
3. **WebContent process crash or jetsam.** Nothing in `tabs.rs` handles
   `webViewWebContentProcessDidTerminate`; a crashed process leaves a white view, and the offline
   script (`offline.rs`) is injected with `eval` into that same dead view.
4. **Page "finished" but blank.** The watchdog only fires when `Finished` never arrives; a page that
   finishes with an empty body (error before hydration, blocked script) is never caught.
5. **`tauri://` custom scheme** for the strip failing to serve `tabs.html` (rare, would also leave
   Settings white) **(unconfirmed)**.

To confirm, ask the teammate for: macOS version, light or dark appearance (white in dark mode would
rule out cause 1), whether Settings (Cmd+,) also opens white, `log show --last 1h --predicate
'process CONTAINS "WebContent" OR process == "zerosoft"'` around a launch, and whether moving
`session.json` away fixes it. The Swift design removes each cause: native strip and error views,
one owner of geometry (the window controller), a process-termination handler, and a paint check
after load (section 4.6).

### 3.5 CI test plan with Lockdown restrictions on

- Every XCUITest launch takes `-ZSLockdown on|off|system`. `on` sets
  `defaultWebpagePreferences.isLockdownModeEnabled = true` on every web view configuration and in
  `decidePolicyFor navigationAction:preferences:`; `off` sets false; `system` leaves the default.
- CI matrix (`macos-15`, later also `macos-26` when the image exists): `lockdown: [off, on]`.
- Test server: the job starts a small local static server (Python `http.server` in the runner) with
  fixtures: a normal page, a page that never finishes, a page that finishes blank, a page using
  IndexedDB, a service worker, `getUserMedia` and web fonts, and one that calls the bridge from an
  iframe of another origin. WebContent process termination is tested at the unit level: the
  watchdog state machine in `ZerosoftCore` receives a "terminated" event (no private API in the app).
- Assertions, both runs: the tab strip is visible (accessibility identifier), the content is either
  the page (marker element) or the native error view, never neither, within 15 s; Retry and Open in
  browser exist; bridge calls from other origins fail.
- Lockdown `on` only: the page reports `typeof indexedDB`, `navigator.serviceWorker`,
  `navigator.mediaDevices` through the bridge `ready` message, so the test proves restrictions were
  actually active (if they were not, the test fails: it protects against a no-op flag).
  **Measured in block 2 (macos-15 runner, `isLockdownModeEnabled = true`):** WebAssembly,
  IndexedDB (absent, not throwing), WebRTC, Web Audio and `Notification` are gone; service workers
  stay available and register; a TrueType web font is refused and text falls back to a system
  font; the page and the bridge keep working. `navigator.mediaDevices` is absent in both modes until
  the app has the camera and microphone entitlements, so it is not used as proof. The web app's
  IndexedDB code (7 files) already checks `typeof indexedDB` or catches before using it.
- Against the real web app: a nightly job runs the Swift app against a `next start` of `main` with
  `DEMO_MODE=true` (the same build the e2e jobs make) and opens the home of each app with Lockdown on
  and off, taking a screenshot per app as an artifact and failing on a blank page or uncaught error.
  This is what proves "works under Lockdown Mode" for the web side, and what tells the web team
  which apps need a "not available in Lockdown Mode" message.

## 4. Architecture

### 4.1 Layout

A new top-level folder `desktop-mac/`, separate from `desktop/` (Tauri, Windows):

```
desktop-mac/
  project.yml                 XcodeGen spec (the .xcodeproj is generated in CI, not committed)
  Package.swift               ZerosoftCore as a Swift package: builds and tests with `swift test`
                              on this Mac (Command Line Tools) and in CI
  Sources/ZerosoftCore/       pure logic, no AppKit: navigation policy, deep link parser, bridge
                              message schemas and validation, session model (tabs), settings,
                              pending dictations, privacy log, clipboard restore rules, strings
  App/                        the app target (AppKit + SwiftUI)
    AppDelegate.swift, MainMenu, Windows/, Tabs/, Web/ (WebViewFactory, Bridge, Watchdog,
    NavigationPolicy glue), Dictation/, Audio/, Overlays/, MenuBar/, Settings/, Updates/,
    Privacy/, Resources/ (Assets, Localizable.xcstrings en/es/pt, PrivacyInfo.xcprivacy,
    privacy-facts.json copied at build), Info.plist, entitlements per build
  Tests/ZerosoftCoreTests/    XCTest for the package (runs locally and in CI)
  UITests/                    XCUITest, CI only (needs Xcode)
  scripts/                    ci-build.sh, sign-adhoc.sh, export-options plists
```

Why this split: `swift build` and `swift test` work with the Command Line Tools, so the core logic
(most of the bugs) is testable on this Mac without Xcode, the same way `session.rs` and `nav.rs` are
pure today. Anything that needs an `.app` bundle, entitlements, XCUITest or signing runs only on
the `macos-15` runner, which ships Xcode 16 (https://github.com/actions/runner-images/blob/main/images/macos/macos-15-Readme.md).
XcodeGen (https://github.com/yonaskolb/XcodeGen) keeps the project as a reviewable YAML file
instead of a `project.pbxproj` that agents cannot merge.

Minimum macOS: 13 (Ventura). It gives `SMAppService`, ScreenCaptureKit audio,
`WKWebpagePreferences.isLockdownModeEnabled`, SwiftUI `MenuBarExtra` and `Settings` scenes. The
Tauri app supports 11; Macs on 11 and 12 keep the Tauri download (section 5).

### 4.2 AppKit or SwiftUI per surface

| Surface | Choice | Why |
|---|---|---|
| App lifecycle, main menu, windows | AppKit (`NSApplicationDelegate`, `NSWindowController`) | Multi-window with tabs, title bar layout, Dock menu, restoration: AppKit gives full control; SwiftUI `WindowGroup` with WKWebView has had focus and restoration quirks |
| Tab strip | AppKit view hosting SwiftUI (`NSHostingView`) inside an `NSTitlebarAccessoryViewController` or a full-size content view with the traffic lights | Native, so it renders even if every webview fails. Today's strip is a webview, which is why a broken WebKit leaves the whole window white |
| Page content | `WKWebView`, one per tab, as AppKit views | Same model as today (`docs/desktop-tabs.md`): one WebContent process per tab, suspend idle tabs |
| Error / offline / watchdog view | SwiftUI over the webview | Native, no WebKit needed |
| Settings | SwiftUI `Settings` scene (or an `NSWindow` with SwiftUI) | Native settings are part of the 4.2 case and replace `ui/settings*` |
| Menu bar item | `NSStatusItem` with an `NSMenu` (AppKit) | Dynamic items (recording dot, retry count) are simpler in AppKit than `MenuBarExtra` |
| HUD, recording indicator, Rec bar | `NSPanel` (`.nonactivatingPanel`, `.floating` level, `canJoinAllSpaces`) with SwiftUI content | Replaces transparent webviews and the private API; `sharingType = .none` for the Rec bar |
| Camera bubble | `NSPanel` with `AVCaptureVideoPreviewLayer` | Native camera preview, no local web page needing the camera |
| Onboarding, permissions | SwiftUI | Explains each permission before the system prompt |

### 4.3 JS bridge

The page keeps calling `window.zerosoftDesktop` (`lib/desktop-bridge.ts`), so the web app does not
change. The Swift app injects a `WKUserScript` at document start, main frame only, that defines the
same frozen object and the same `Notification` shim and link handlers as `bridge_script` in
`lib.rs`. Each method posts to one `WKScriptMessageHandlerWithReply` named `zerosoft`:

```js
window.webkit.messageHandlers.zerosoft.postMessage({ cmd: 'recOverlay', args: {...} })  // returns a Promise
```

Native side rules, enforced in `ZerosoftCore` and unit tested:

1. **Origin check on every message**: `message.frameInfo.isMainFrame` and
   `message.frameInfo.securityOrigin` must equal the configured server origin (scheme, host, port).
   Messages from iframes or other origins are dropped and logged to the activity log (closed tag).
2. **Allowlist of commands**: an enum `BridgeCommand` with exactly the commands in section 1
   (`info`, `startLogin`, `openSettings`, `notify`, `recording`, `systemAudioStart`,
   `systemAudioRead`, `systemAudioStop`, `recOverlay`, `recLevel`, `tabs`). Unknown `cmd`
   rejects.
3. **Typed arguments**: each command decodes its args with `Decodable` structs, with length caps
   (title 200 chars, path validated like `session::valid_path`), the same as the Rust commands.
4. **Context checks**: `systemAudioStart` only from the tab in front (as `desktop_system_audio_start`
   today), `recOverlay` only from the tab that owns the recording.
5. **Content world**: the bridge script runs in `.page` (the page must see `window.zerosoftDesktop`),
   but the handler is added only to web views whose top URL passes the navigation policy, and the
   script returns early when `location.origin` differs, as today.

App to page events (`zerosoft:stop-recording`, `zerosoft:rec-control`) go through
`evaluateJavaScript` with a `CustomEvent` built from a fixed list, as today.

### 4.4 Navigation policy

`NavigationPolicy` in `ZerosoftCore` is a port of `nav.rs` with its tests: `WKNavigationDelegate`
`decidePolicyFor navigationAction` returns `.allow` only for the exact server origin; Google
sign-in starts the PKCE flow in the browser; integration OAuth opens its start route in the
browser (`nav::connect_start`); http(s), mailto and tel go to `NSWorkspace.open`; everything else is
cancelled. `createWebViewWith` (target=_blank) opens a tab for same-origin URLs and the browser for
the rest. Downloads (`WKDownload`, macOS 11.3+) save to Downloads with a user-selected or
Downloads entitlement (section 2).

Server URL: the default build is `https://zerosoft.ai`. The custom server (self-hosting) is a
setting in Settings › Advanced; for review the default must work with a demo account
(section 2, guideline 2.1).

### 4.5 Auth and session

Same flow as `auth.rs`: email sign-in inside the page; Google through the system browser with
PKCE. Two options for the browser part:

- `ASWebAuthenticationSession` (macOS 10.15+) with callback scheme `zerosoft`: Apple's supported
  way, runs in a sandbox, shares cookies with Safari only when asked
  (https://developer.apple.com/documentation/authenticationservices/aswebauthenticationsession).
  Recommended.
- The default browser plus the `zerosoft://auth/callback` deep link, as today (also works).

The token exchange `POST /api/desktop/token` sets the session cookie in
`WKWebsiteDataStore.default().httpCookieStore`. Native requests (`URLSession`) read that cookie
from the store for each request, as `api.rs` does; the app keeps no token copy, so
`privacy-facts.json` stays true. Integration OAuth (Gmail, Calendar...) keeps opening its start
route in the default browser because the callback validates state against a cookie set there.

**Built in block 3** (`desktop-mac/App/AuthController.swift`, `Sources/ZerosoftCore/Login.swift`):
ASWebAuthenticationSession, not the deep link. The verifier and state live in memory for one
attempt; the callback is checked for shape, state (constant time), age (10 minutes) and server
before the code is exchanged; the token goes from the response straight into the web view's cookie
store (host-only, `HttpOnly`, `SameSite=Lax`, `Secure` on https) and nowhere else: no Keychain item
is needed because the app keeps no copy of its own. A `zerosoft://auth/callback` link that arrives
through `application(_:open:)` is ignored: a sign-in completes only in the session that started it.
Native requests (`App/NativeHTTP.swift`) use an ephemeral `URLSession` without a cookie jar or
redirects and refuse any URL outside the server origin.

### 4.6 Load watchdog, offline and blank pages

A white window must not be possible. Per web view:

1. **Start timer** on `didStartProvisionalNavigation`. If `didFinish` has not fired in 10 s, or
   `didFail`/`didFailProvisionalNavigation` fires, show the native error view (SwiftUI overlay):
   title, the reason in words (offline, server error, TLS, timeout), **Retry**, **Open in browser**
   and **Settings**. Not injected HTML: a native view on top of the webview, so it works even when
   WebKit cannot render anything.
2. **Paint check** after `didFinish`: `evaluateJavaScript("document.body && document.body.childElementCount")`
   and, as a second signal, a bridge message `ready` that the bridge script posts on
   `DOMContentLoaded`. If neither arrives in 5 s after finish, error view with the reason "page did
   not draw".
3. **Process crash**: `webViewWebContentProcessDidTerminate` shows the error view and reloads once
   automatically; a second crash in 60 s leaves the error view up.
4. **Offline**: the service worker (`public/sw.js`) still serves cached pages inside WKWebView. When
   the first load fails and `NWPathMonitor` says offline, the error view says offline and retries
   by itself when the path becomes satisfied (no request of our own to decide, as today).
5. **The tab strip, menus and settings are native**, so a WebKit failure leaves the frame of the app
   usable: tabs can be closed, the server changed, Lockdown status read.
6. The error view and Settings › About show whether the web views run with Lockdown restrictions
   (section 3.2), and the reason code of the last failure, so a report like "the window is white"
   comes with something to act on. A "Copy diagnostics" button copies macOS version, app version,
   Lockdown state, server and the last 20 navigation events (no URLs beyond the path, no content).

### 4.7 Notifications, badge, deep links, login item

- Notifications: `UNUserNotificationCenter` with authorization requested from onboarding, not at
  launch. A click opens the tab of the notification (today's plugin cannot, README "what Electron
  did"). The page's `window.Notification` shim stays.
- Badge: `NSApp.dockTile.badgeLabel` from `GET /api/desktop/badge` every 30 s, as `badge.rs`.
- Deep links: `CFBundleURLTypes` for `zerosoft`, handled in
  `application(_:open:)`, parsed by a port of `deeplink.rs` (field-by-field validation, length cap).
- Open at login: `SMAppService.mainApp.register()` (macOS 13), off by default, switched on from
  Settings only (section 2).

### 4.8 Keeping `desktop/privacy-facts.json` true

The facts file stays the single list for both apps and the public page `/download/privacy`.

- Each fact gains `apps: ["windows", "mac"]` (or a per-app `code` list): the Swift app's code paths
  go under `desktop-mac/`. Facts that only apply to one app say so; the public page shows both.
- `tests/unit/desktop-privacy.test.ts` already scans `desktop/src-tauri/src/*.rs` for server paths
  and compares them with `network[].endpoints`. It gains a Swift scanner over
  `desktop-mac/**/*.swift` (string literals containing `/api/`), with the same ignore list.
- A Swift test in `ZerosoftCoreTests` loads the JSON (copied into the test bundle) and checks that
  every `PrivacyEvent`, store id, control id and limit (500 events, 30 days, 20 pending, a week)
  matches the Swift enums, like the Rust tests in `privacy.rs`.
- Network test at runtime (block 9): a UI test run with a local proxy (or a `URLProtocol` and a
  `WKURLSchemeHandler` probe in a test build) records every host the app contacts during a scripted
  session and fails if a host is not in `network[].host`.

### 4.9 Shared code with Windows

Windows stays on Tauri (section 5.4). Shared parts are the server API (unchanged), the web bridge
contract (`lib/desktop-bridge.ts`, which becomes the documented contract both apps implement),
`desktop/strings.json` (the Swift app converts it to `Localizable.xcstrings` at build, so copy
stays in one place), `desktop/privacy-facts.json`, and the Mac-specific Rust code paths, which get
deleted from Tauri once the Swift app ships (the Tauri Mac build keeps going only for macOS 11 and
12, or stops; decision 7.5).

## 5. Distribution

### 5.1 Two builds from one codebase

| | Store build | Direct build |
|---|---|---|
| Channel | Mac App Store (TestFlight first) | `zerosoft.ai/download`, `.dmg` |
| Signing | Apple Distribution + Mac Installer Distribution, provisioning profile | Developer ID Application, notarized and stapled |
| Sandbox | Required | On as well (same entitlements, one code path); off only if a direct-only feature needs it |
| Updates | App Store | Sparkle 2 (supports sandboxed apps with its installer XPC service, https://sparkle-project.org/documentation/sandboxing/) with an EdDSA-signed appcast on `zerosoft.ai` |
| Auto-paste | Feature flag, submitted on; off if review rejects | On |
| Upgrade and pricing links in the page | Hidden (bridge `store: true`) unless decision 7.2 says otherwise | Shown |
| Swift flag | `STORE` active compilation condition | none |

Both come from the same XcodeGen project as two configurations (or two targets sharing sources).
Sparkle is linked only into the direct build. The Store build has no code path that downloads or
installs anything.

### 5.2 What the owner must provide

| Item | Cost | Notes |
|---|---|---|
| Apple Developer Program membership (organization, needs a D-U-N-S number) | 99 USD per year (https://developer.apple.com/programs/whats-included/) | The account holder generates the Developer ID certificate (https://developer.apple.com/developer-id/); the same membership covers the Store |
| Bundle id | free | Registered in the developer account. Reusing `ai.zerosoft.desktop` does not keep users' permissions (the new signature changes the designated requirement anyway) and would mix the two apps' data and TCC entries during the transition. Recommended: `ai.zerosoft.mac` (decision 7.4) |
| App Store Connect app record | free | Name, SKU, category Productivity, privacy labels, age rating, export compliance (HTTPS only: `ITSAppUsesNonExemptEncryption = NO`) |
| Certificates in CI secrets | free | Apple Distribution, Mac Installer Distribution, Developer ID Application (`.p12` + passwords), provisioning profiles, an App Store Connect API key (issuer id, key id, `.p8`) for `altool`/`notarytool` and TestFlight upload. Secrets live in GitHub (the repo is public; nothing in the tree) |
| Demo account for review | free | A workspace with sample data on `zerosoft.ai` |
| Screenshots, description, support and privacy URLs | free | `/download/privacy` already exists |
| Sparkle EdDSA key | free | Private key in a CI secret, public key in Info.plist |
| Commission | 15% under the Small Business Program only if we sell through IAP (https://developer.apple.com/app-store/small-business-program/) | 0 if there is no IAP |

GitHub `macos-15` runner minutes: macOS minutes are billed at 10 times Linux on private repos; on
this public repo standard runners are free.

### 5.3 Updates

Store: the Store updates it; the app shows nothing about updates. Direct: Sparkle checks on launch
and every 4 hours, downloads in the background and installs on quit or "Restart to update", never
during a recording or dictation (same rules as `updater.rs`). The current Tauri updater feed stays
for the Tauri builds.

### 5.4 Windows stays on Tauri

No strong reason to change: WebView2 has none of the Mac problems (getDisplayMedia shares system
audio, no Store requirement). Consequences:

- `desktop/` keeps building Windows (and the Mac Tauri build until decision 7.5). Mac-only Rust
  (`system_audio.rs`, the CGEvent paste, the Dock menu) is removed once the Tauri Mac build stops.
- The bridge contract is shared: `lib/desktop-bridge.ts` becomes the reference, with a capability
  field per feature (`systemAudio`, `dictation`, `store`, `lockdown`) so the web app never checks
  which app it runs in.
- `desktop/strings.json` and `desktop/privacy-facts.json` stay single sources for both apps.
- `/download` serves the Store link (or the notarized `.dmg`) for Mac and the NSIS installer for
  Windows; `app/api/desktop/download/route.ts` changes in the distribution block.

## 6. Block plan

Each block is one pull request with its own tests, CI green before merge (auto-merge). CI gets a
new workflow `.github/workflows/desktop-mac.yml` on `macos-15`, triggered by changes under
`desktop-mac/`, `lib/desktop-bridge.ts` and `desktop/privacy-facts.json`: `swift test` for
`ZerosoftCore`, `xcodegen`, `xcodebuild build` and `xcodebuild test` (unit + UI tests, Lockdown
matrix from block 2), ad hoc signing (`codesign -s -`), and the built `.app` as an artifact. Locally
only `swift build` / `swift test` of the package run (Command Line Tools); no Xcode is installed.
Since block 3, `ci.yml` calls `desktop-mac.yml` (`workflow_call`) when a pull request touches the
files in the `mac` list of `scripts/e2e-areas.json` (the paths above plus the two workflows), and
`CI result` waits for that job. A pull request that touches only the web skips it. On `main` the
workflow runs on its own for pushes that touch the app.

| # | Block | Delivers | Tests | Depends on |
|---|---|---|---|---|
| 1 | Minimal app | `desktop-mac/` layout, XcodeGen project, `ZerosoftCore` package; one window with one WKWebView of the server; `NavigationPolicy` (port of `nav.rs` and its tests); load and paint watchdog with the native error view (Retry, Open in browser); process-termination handler; App Sandbox + network client entitlement; ad hoc signed `.app` artifact; `desktop-mac.yml` | XCTest: navigation policy table, watchdog state machine (timeout, fail, blank, terminated). XCUITest: launch against the local fixture server, page shown; never-finishing and blank pages show the error view; external link does not navigate inside | none |
| 2 | Lockdown and bridge core | `-ZSLockdown` switch and the CI matrix; bridge `WKScriptMessageHandlerWithReply` with the origin check, command allowlist, typed args; `info` and `ready` messages; `store` and `lockdown` capability fields | XCTest for message validation (wrong origin, iframe, unknown cmd, oversize args). XCUITest both Lockdown modes: render or error view, never blank; restrictions proven active in `on` | 1 |
| 3 | Auth, deep links, notifications, badge | Google via `ASWebAuthenticationSession` + PKCE + `/api/desktop/token`, cookie into the data store; `zerosoft://` parser (port of `deeplink.rs` tests); `UNUserNotificationCenter` with click to open; `window.Notification` shim; Dock badge poll | Unit: PKCE, state, deep link table, badge parsing. UI: deep link opens a path; notification shim calls native | 2 |
| 4 | Tabs and windows | Native tab strip (SwiftUI in the title bar), one web view per tab, multiple windows, move tabs between windows, `session.json`-compatible model (port of `session.rs` tests), lazy restore, idle suspension, shortcuts and menus from `docs/desktop-tabs.md`, link handling messages | Unit: session model. UI: Cmd+T, Cmd+W, Cmd+Shift+T, Cmd+1..9, restore after relaunch | 2 |
| 5 | Menu bar, settings, login item | `NSStatusItem` and its menu; SwiftUI Settings (General, Voice, Dictionary, History, Permissions, Account) reading the same server endpoints as today; onboarding with permission explanations; `SMAppService` toggle | Unit: settings encode/decode, endpoint list. UI: Settings opens, switches persist | 2 (parallel with 4) |
| 6 | Dictation | `RegisterEventHotKey` shortcut (hold, toggle, both, Esc), `AVAudioEngine` capture to 16 kHz WAV, HUD `NSPanel`, upload with timings, pending store and retry (port of `retry.rs`), copy plus optional `CGEventPost` paste behind `CGRequestPostEventAccess`, clipboard restore rules (port of `clipboard.rs`), front app via `NSWorkspace` | Unit: WAV encoder, hold/toggle state machine, clipboard restore rules, retry policy. UI: shortcut with a fake audio source and a stub server writes the transcript to the clipboard | 5 |
| 7 | Meeting audio and recording indicator | Core Audio process tap (14.2+) and ScreenCaptureKit audio fallback (13 to 14.1) behind the bridge `systemAudioStart/Read/Stop` contract; floating indicator panel; menu bar dot | Unit: PCM resampling and base64 chunks, start rules (front tab only). UI: bridge start without permission returns `denied` | 2, 5 |
| 8 | Rec overlays | Rec bar `NSPanel` (excluded from capture), camera bubble with `AVCaptureVideoPreviewLayer`, global Rec shortcuts while recording, `zerosoft:rec-control` events; `getDisplayMedia` in WKWebView checked on macOS 15 | Unit: overlay state reducer, control list matches `lib/rec-controls.ts`. UI: bridge `recOverlay` shows and hides the bar | 7 |
| 9 | Privacy and data | Activity log (closed schema, 500 events, 30 days), stores inventory and delete, delete-all flow, privacy page in Settings; `privacy-facts.json` gains per-app code paths; `tests/unit/desktop-privacy.test.ts` scans Swift sources; Swift test compares ids and limits; runtime host check | Vitest + XCTest + a UI run that records hosts contacted | 3 to 8 |
| 10 | Distribution | Developer ID signing, notarization and stapling, Sparkle 2 in the direct build, Store configuration (provisioning, `PrivacyInfo.xcprivacy`, export compliance), TestFlight upload with the App Store Connect API key on a tag `mac-vX.Y.Z`; `/download` and the download route serve the new build | CI dry run with a throwaway certificate (like today's `signing_selftest`); `spctl --assess` on the notarized app; `codesign -d --entitlements` matches the expected list | 1 (signing parts can start early, in parallel), needs the owner's account |
| 11 | 1.0 hardening | VoiceOver labels on native UI, en/es/pt strings from `desktop/strings.json`, memory and launch timings against the Tauri numbers in `desktop/README.md`, the nightly real-web-app Lockdown run, review notes and screenshots | Full UI suite on both Lockdown modes; nightly run green 5 nights in a row | all |

**Built in block 4** (`Sources/ZerosoftCore/TabSession.swift`, `App/TabsController.swift`,
`App/BrowserWindowController.swift`, `App/TabStripView.swift`): windows with their own tab strip,
one `WebController` per loaded tab built by the same factory as the first (same navigation policy,
bridge checks, watchdog and Lockdown setting), the shortcuts and menus of `docs/desktop-tabs.md`,
link handling in the bridge script (Cmd-click, Cmd+Shift-click, Cmd+Option-click, middle click,
right click), `target=_blank` of the server as a tab next to the page, drag to reorder, drop on
another window's strip or away from it, lazy restore and idle suspension. The bridge `tabs`
capability is on. Where the code differs from the table above or from the Tauri app:

- The strip is AppKit views in the title bar of a full-size content window, not SwiftUI: dragging a
  tab across windows, the middle button and accessibility tab buttons need event tracking that
  SwiftUI does not give.
- `session.json` keeps the Tauri shape (version, windows, tabs with id and path, the tab in front,
  bounds, prefs) but holds no titles, which are page contents; it reads a Tauri file and drops its
  titles. Every path read from it goes through `TabSession.allowedPath`: `session::valid_path`,
  no dot segment (plain or percent-encoded), no `/api/` route, and the server plus the path must
  be the server origin and pass the navigation policy. Only app pages (`/app...`, also after a
  locale) are saved, without query or fragment and never under `invite/`: public pages carry
  capability tokens in the path (`/invite/<token>`, `/sign/<token>`...) and a query can carry one.
  Restore takes only paths in that saved form. Tabs that fail are dropped, and so are windows left
  without tabs.
- A link or `target=_blank` to a server URL that cannot be a tab (an `/api/` export or download)
  goes to the browser, as downloads do; the bridge script leaves `/api/` links to the page.
- A tab with the camera or microphone on is never suspended, whatever the page told the bridge.
- Bridge `tabs` actions other than `state` count only from the tab in front of its window.
- Deep links and notification clicks load their page in the tab in front of the last focused
  window, as `navigate_active` in tabs.rs (section 4.7 said "opens the tab of the notification").
- A fresh session opens `/app`, as the Tauri app; blocks 1 to 3 opened the server root.
- The tab preferences (suspend, minutes, restore, Cmd-click target) are read from `session.json`;
  the switches arrive with Settings in block 5. The recording dot waits for block 7 (built there).

**Built in block 5** (`Sources/ZerosoftCore/AppSettings.swift`, `Sources/ZerosoftCore/SettingsAPI.swift`,
`App/SettingsWindow.swift`, `App/SettingsModel.swift`, `App/OnboardingWindow.swift`,
`App/StatusItemController.swift`, `App/SystemServices.swift`): the menu bar item, the SwiftUI
Settings window in an AppKit window (app menu Settings, Cmd+,; the menu bar item; the page's
`openSettings()`), the first-run window and the login item. The bridge `settingsWindow`
capability is on and `openSettings` has its native side, so the web app's "Desktop app
settings" buttons (`components/settings/DesktopAppSettings.tsx`, `components/app/AppSidebar.tsx`)
show and open it. `openSettings` counts only from the tab in front of the window in front, while
the app is in front, so a background page cannot pull the app over other apps. Where the code differs from the table above or from the Tauri app:

- Sections: General (open at login, menu bar item, server and Lockdown state, "show the welcome
  again", the web settings in a tab), Tabs (the `session.json` preferences block 4 left without
  switches: suspend, minutes, restore, Cmd-click target), Notifications, Dictation (language,
  style, depth, AI cleanup: `/api/voice/settings`), Dictionary (`/api/voice/dictionary`), History
  (the last 50 dictations, `/api/voice/sessions`) and Account (from the badge route's `user`, sign
  in and out). Permissions has only notifications: the microphone, camera, screen and Accessibility
  rows come with the blocks that add those entitlements (6 to 8). Meetings, Privacy and Updates
  come with blocks 7, 9 and 10. History copies; paste-back needs block 6's paste path.
- The Tauri window also lists the server's settings groups (`/api/settings/nav`) and loads those
  web sections inside itself. The Swift window opens `/app/settings` in a tab instead: one less
  web view outside the tab model and its checks.
- The custom server is shown, not edited: a change needs the origin of every check to move and a
  relaunch, so the field (Settings › Advanced) waits for block 10, where the direct build needs it.
- `settings.json` (next to `session.json`, mode 0600) holds two switches and a version:
  `onboarded`, `menuBarItem`. A test checks it can hold nothing else. The tab
  preferences stay in `session.json`; the login item's state is the system's
  (`SMAppService.mainApp.status`), so the app keeps no copy. What the server sections load
  (dictionary, history, the account's name and email) stays in memory.
- The notification prompt shows only from the "Turn on notifications" button of the onboarding or
  Settings, after a screen that says what the notifications are. Block 3 asked on the first
  delivery; now nothing is handed to the system until the person allowed it, and the Dock badge
  counts in the meantime.
- Open at login is off by default and changes only from its switch (onboarding or Settings).
  "Needs approval" sends the person to System Settings › Login Items. A fresh install can report
  "not found" before its first registration on macOS 13 and 14, so the switch stays usable and
  `register()` decides.
- Sign-out from Settings or the menu bar item does next-auth's CSRF request and POST
  (`/api/auth/csrf`, `/api/auth/signout`, as auth.rs `server_sign_out`), which also revokes the
  session on the server, then deletes the session cookies from the web views' store. The web
  app's own local data for the server (localStorage, IndexedDB) stays: block 9's "delete all"
  removes it. The open server section reloads after a sign-in or sign-out from anywhere. Writes to
  the voice routes carry the server as `Origin`. Every path is in `desktop/privacy-facts.json`
  (a Swift test compares them).
- The first-run window did not show the dictation shortcut yet (section 2.1): block 6 added that
  step. It opens once, never in a UI test unless `-ZSOnboarding YES` asks for it; closing it counts
  as seen.
- The menu bar item's menu: Open zerosoft, New Tab, New Window, the count of new items, Settings,
  Sign in or Sign Out (once the badge poll knows), Quit. Its icon is an SF Symbol until block 11's
  artwork. Dictation, history and the recording dot join it in blocks 6 and 7.
- UI tests replace the login item and the notification permission with fakes (CI cannot answer
  the system prompt, and an ad hoc build must not add itself to the runner's login items); the
  mapping of the system states is unit tested.

**Built in block 6** (`Sources/ZerosoftCore/Dictation.swift`, `DictationAudio.swift`,
`DictationAPI.swift`, `PendingDictations.swift`, `PasteFlow.swift`; `App/Dictation/`): dictation
in any app. The bridge `dictation` capability is on; the page still has no command that starts a
dictation. Where the code differs from the table above or from the Tauri app:

- **Paste path (decision 7.1, as planned).** Auto-paste sits behind the `ZSAutoPaste` flag in
  Info.plist, from the `ZS_AUTO_PASTE` build setting in `project.yml`: `YES` for the direct build
  and for the Store submission, and the Store configuration of block 10 sets `NO` if review
  rejects it. The keystroke is posted only when the flag is on, the person's "Paste into the app
  in front" switch is on (Settings › Dictation) and macOS approved it
  (`CGPreflightPostEventAccess`). Otherwise the text is copied and the HUD says "Copied. Paste
  with ⌘V" (the plan's copy-only baseline; no extra notification). Approval is asked for only
  from the "Allow pasting" button (onboarding or Settings › Permissions):
  `CGRequestPostEventAccess`, and System Settings › Accessibility whenever macOS shows no prompt
  (it prompts only once per app). No
  Accessibility (AX) API is used. `scripts/check-signature.sh` checks the built app has the flag
  on and a microphone usage string.
- **Microphone.** `com.apple.security.device.audio-input` and `NSMicrophoneUsageDescription` are
  the only additions (the signature check lists the entitlements). The prompt shows only from
  "Turn on the microphone" (onboarding, Settings › Permissions) or the first dictation, which asks
  and records nothing; the next one records. Capture is `AVAudioEngine`'s input node at the
  device's rate, mixed to mono in memory and resampled to 16 kHz WAV when the dictation ends.
- **Shortcut.** `RegisterEventHotKey` for the dictation shortcut (the Tauri list, default
  Option+Space) and "paste last" (Control+Command+V); Esc is registered only while recording.
  Hold, tap (hands-free) and both modes are the Tauri state machine (`DictationMachine`), with
  key repeats ignored and a lost release not blocking the next press. A shortcut that cannot be
  registered shows "Pick another one" in Settings and the onboarding; when the default
  Option+Space is refused (macOS 15 is reported to refuse some Option-only shortcuts), the app
  uses Command+Shift+D for the session and says so in Settings. The UI tests record whether the
  default registers on the runner and use Command+Shift+D for the shortcut test (Control+Option+
  Space is a macOS input-source shortcut). While the microphone is open, paste last and the
  resend of saved dictations do nothing and nothing replaces or hides the recording HUD.
- **Clipboard.** The port of `clipboard.rs` keeps its rules, with two changes: the snapshot keeps
  every item and type (Tauri kept text or an image), and "is our text still there" compares the
  pasteboard's change count instead of reading the text back. Contents marked concealed,
  transient or auto-generated (password managers) are never read or put back: the clipboard is
  cleared instead, so their auto-clear still works. A clipboard over 32 MB is left alone. The clipboard is read only when the
  keystroke will be posted and "put back the clipboard" is on; whether macOS 26's paste prompt
  shows for that read is still **(unconfirmed)**. Text the app writes is transient, concealed and
  this Mac only.
- **Saved dictations.** `retry.rs` ported with its limits (20, a week): `<id>.audio` and
  `<id>.json`, mode 0600, in the container's `Application Support/zerosoft/pending/` (0700,
  excluded from backups), only for
  failures where the audio was fine and only with "Keep dictations that could not be sent" on (on
  by default, as the Tauri app and the privacy facts). They are sent only to the server they were
  recorded for, and the text that comes back is copied, never pasted. No transcript is ever
  written to disk; the last text stays in memory for "Paste last dictation". One resend runs at
  a time, and it stops at the first offline, signed-out or rate-limited answer. The dictation
  request has its own client with a 75-second idle timeout (the server can think for 60).
- **Settings and menus.** settings.json gains the shortcut and the mode (names from closed lists)
  and four switches (`autoPaste`, `restoreClipboard`, `sendAppName`, `keepFailedDictations`).
  Settings › Notifications became Permissions (notifications, microphone, Accessibility).
  Settings › Dictation has the switches above the account's dictation settings; the app-name and
  keep switches live there until block 9's Privacy page. History pastes back (zerosoft hides so
  the focus returns to the previous app) and sends the saved dictations again. The menu bar item
  gained Start/Stop dictation, the hold hint, Paste last dictation, Send saved dictations again
  and Dictation history; its icon and tooltip change while the microphone is open. The
  onboarding has a dictation step (shortcut, microphone, pasting) after the welcome.
- **Not in this block.** Timings are logged as numbers (`os.Logger`, never text) instead of shown
  in History; activity-log events for the microphone and paste wait for block 9 with the rest of
  the log, and the Swift code paths in `desktop/privacy-facts.json` too. UI tests use a fake audio
  source and fake microphone and Accessibility permissions (CI cannot grant either and must not
  post keystrokes); the real capture and keystroke need a run on a real Mac before TestFlight.

**Built in block 7** (`Sources/ZerosoftCore/Meetings.swift`; `App/Meetings/`: `SystemAudioCapture.swift`,
`SystemAudioController.swift`, `MeetingsController.swift`, `RecordingIndicator.swift`): meetings. The
bridge `recording` and `systemAudioStart/Read/Stop` have their native side, `recordingIndicator` is
on and `systemAudio` is on except under forced Lockdown restrictions. Where the code differs from
the table above or from the Tauri app:

- **Capture.** A private Core Audio process tap of every process but zerosoft, in a private
  aggregate device that holds only the tap (no sub-device, so a headset microphone cannot join),
  on macOS 14.2 and later; ScreenCaptureKit's audio
  of the main display (no video output taken) on 13 to 14.1, as planned. Samples are mixed to
  mono and converted to 16 kHz 16-bit in the app (`PCMResampler`: a box filter down, linear up,
  independent of how the audio thread splits the stream, following the tap's format when the
  output device changes), held in memory at most 60 s between two
  reads (`PCMQueue`) and handed to the page as base64, as system_audio.rs does. Nothing is written
  to disk or logged; logs carry closed tags and OSStatus codes only.
- **Upload.** Nothing native uploads: as in the Tauri app, the page records (MediaRecorder) and
  uploads through the Voice session routes (`/api/voice/sessions/...`). The app only feeds the
  page the computer's audio and marks the recording.
- **Start rules.** As commands.rs: a capture starts only from the tab in use (in front of the key
  window, the app in front); only that tab reads, stops or restarts it. It does not wait for the
  page's `recording` flag: Voice and Rec ask for the audio before they report recording, as in the
  Tauri app. A stop, or a new document in the tab, while macOS still holds the start cancels it. It also ends when that tab
  closes, is suspended, loads another document or its web process ends, and 30 s after the page's
  last read, unless that tab still reports a meeting (a page behind other tabs can be throttled;
  its marks stay on and the queue keeps at most 60 s). Such a tab is never suspended. With the "Let meetings capture the computer's audio"
  switch off (Settings › Meetings, on by default as in the Tauri app, where it lived in Privacy) or
  under forced Lockdown restrictions (no Web Audio for the page) the start answers `unsupported`
  and the page records the microphone only; switching it off stops a capture.
- **Permissions.** No entitlement was added: taps use the existing audio input entitlement and
  `NSAudioCaptureUsageDescription`, ScreenCaptureKit only the person's Screen Recording approval
  (`NSScreenCaptureUsageDescription` is set as well); `scripts/check-signature.sh` checks both
  strings. Prompts show only on the first capture or from Settings › Permissions' "Allow screen
  recording" (a row shown only on macOS 13 to 14.1, where the capture needs it), never at launch;
  a capture never opens System Settings by itself. Audio taps have no public permission check, so `denied` comes only
  from the ScreenCaptureKit path; a tap macOS refused records silence, which the page already warns
  about (`systemAudioSilent`). Their Permissions row explains when macOS asks and opens System
  Settings instead of starting a throwaway capture to raise the prompt. The Tauri app also opened
  System Settings on `denied`; this app leaves that to the row's button.
- **Marks (guideline 2.5.14).** The tab's red dot (block 4), the menu bar item's red dot with
  "Recording a meeting" or "Capturing the computer's audio", Open the recording, Stop recording and
  Stop capturing the computer's audio, and the floating indicator (a non-activating `NSPanel`:
  click opens the tab, hover shows the time, right click Open, Stop, Hide until the next
  recording, drag to move, position kept in settings.json as `indicatorPosition`). While a meeting
  records or the computer's audio is captured the menu bar item shows even when Settings ›
  General hides it. The indicator follows its switch for meetings but shows for the computer's
  audio whatever the switch says while the tab is not in front; "Hide until the next recording"
  hides it for both, and the menu bar item's dot and the tab's dot stay. Every tab that records a
  meeting or captures the computer's audio has the dot, and two tabs can record at once.
- **Differences from indicator.rs.** The recording flag belongs to the tab that sent it: another
  tab saying "not recording" (Voice says it whenever its recorder mounts) no longer clears it.
  Stop from the indicator or the menu bar item sends `zerosoft:stop-recording` to the page and
  also stops the computer's audio natively right away, instead of waiting for the page.
- **Settings.** A Meetings section (what records now with Stop, the indicator switch, the computer
  audio switch, "Open meetings in Voice") between Tabs and Permissions; Permissions gained
  Computer audio and Screen recording. settings.json gained `recordingIndicator`,
  `allowSystemAudio` and `indicatorPosition`.
- **Not in this block.** Activity-log events for meetings and the computer's audio, and the Swift
  code paths in `desktop/privacy-facts.json`, wait for block 9. UI tests use a fake capture and
  fake permissions (CI cannot grant Screen Recording or system audio recording); the real tap and
  ScreenCaptureKit paths need a run on a real Mac (one on 14.2 or later, one on 13 or 14.1) before
  TestFlight. The bridge test's "unimplemented command" now sends `recOverlay`; block 8 implements
  it and must pick another check (or drop it once every command has a native side).

**Built in block 8** (`Sources/ZerosoftCore/Rec.swift`; `App/Rec/`: `RecController.swift`,
`RecBar.swift`, `RecBubble.swift`, `CameraPreview.swift`): Rec's floating controls. `recOverlay`
and `recLevel` have their native side, so every bridge command has one: the bridge test's
"unimplemented command" check is gone and the fixture's `recOverlay {active: false}` from a tab
without a recording is answered and does nothing. The bridge object now has `recOverlay` and
`recLevel`, which is how `components/rec/Recorder.tsx` turns on its desktop behaviour (the bar's
controls, the native bubble for a full-screen recording with the camera). Where the code differs
from the table above or from the Tauri app:

- **No native screen capture.** As planned, the page records the screen (`getDisplayMedia`), the
  camera and the microphone, and uploads; the app only shows the controls and the bubble. The
  bubble is an `AVCaptureVideoPreviewLayer` of a capture session with no output, so no frame is
  kept or written anywhere; the page's screen recording records the bubble on screen. The
  computer's audio of a Rec recording is block 7's capture, started by the page from the tab in
  use. The ready report gained a `display` key (`getDisplayMedia` present) and the Rec UI test
  attaches what the macos-15 runner's WebKit offers; a real screen recording needs a real Mac.
- **Start rule (section 4.3, rule 4, plus block 7's rule).** A recording's bar starts only from the
  tab in use. Rec reports its first state after the screen picker closes, and macOS's picker can
  take the app out of the front, so the tab that was in use when the app lost the front may
  still start within 2 minutes, as long as no other tab came to the front since
  (`RecStartGate`). After that only that tab updates or ends its recording, and only its level
  reaches the bar. A tab that closes, is suspended or loads another document ends its recording,
  and a tab that records is never suspended. Two tabs recording at once both get the red dot;
  the bar follows the last one that started (the Tauri app kept only the last).
- **Bar.** A non-activating `NSPanel` in AppKit (not SwiftUI: first-click buttons, drag and the
  confirmation row are simpler), `sharingType = .none`, `.floating` on every Space. Clock, state,
  microphone with its level (click mutes), camera show or hide, pause or resume, restart and
  discard (each asks in the bar), Finish (finishes and brings the recording's tab to the
  front); a click on the bar opens that tab, a drag moves it. Whether ScreenCaptureKit on macOS 15
  and later still honours `sharingType = .none` for what `getDisplayMedia` records is
  **(unconfirmed)**: it needs a run on a real Mac.
- **Bubble.** A round, mirrored `NSPanel` (168 or 280 points, as Tauri), shared with screen
  captures; hover shows Bigger or Smaller and Hide; drag moves it. It opens the camera whose name
  the page sent, else the default one, only while it shows: hiding it releases the camera.
  macOS asks for the camera on that first use when nothing asked before (the page's own camera
  usually asked already); a refusal or no camera sends `bubble-failed`, as the Tauri bubble did,
  and the page draws the face in the video again. Where the bar and the bubble were left is
  remembered while the app runs, not on disk, as in the Tauri app.
- **Shortcuts.** Option+Shift+P and Option+Shift+S while a recording counts down, records or is
  paused (`RegisterEventHotKey`, a second `HotKeys` instance that passes other presses on).
  macOS 15 refuses shortcuts whose only modifiers are Option and Shift (section 2.2), so when it
  refuses them the app uses Control+Option+P and Control+Option+S, and the bar's tooltips say
  which. The UI test reports which pair the runner took.
- **Camera for the page.** The camera entitlement (`com.apple.security.device.camera`) and
  `NSCameraUsageDescription` are the only additions; `scripts/check-signature.sh` checks both. The
  web views now answer WebKit's media-capture question as tabs.rs `on_permission_request` did:
  camera and microphone granted to the server's main frame, denied to every frame and every other
  origin. macOS still asks the person the first time. `getDisplayMedia` is not part of that
  question: WebKit asks the person itself each time.
- **Marks and menus (guideline 2.5.14).** While Rec records, the bar shows (it cannot be hidden),
  the tab has the red dot, and the menu bar item shows its red dot even when Settings › General
  hides it, with "Rec is recording", Open the Rec recording and Finish the Rec recording (Finish
  also stops the computer's audio right away). `RecordingIndicatorRules.shouldShow` gets the real
  bar state: the meeting indicator does not show for the computer's audio of a Rec recording,
  which the bar already marks. Settings › Meetings' Stop also finishes Rec.
- **Permissions.** Settings › Permissions gained Camera (state and "Turn on the camera", the only
  other place macOS asks) and shows Screen recording on every macOS, since Rec's page records the
  screen; it explains that and still asks only from its button.
- **Not in this block.** Activity-log events for Rec and the camera, and the Swift code paths in
  `desktop/privacy-facts.json`, wait for block 9. UI tests use a fake camera and a fake camera
  permission (CI has no camera and cannot answer prompts); the real camera, the shortcuts on
  macOS 15 and 26 and a real screen recording (bar left out, bubble in) need a run on a real Mac
  before TestFlight.

Parallel work: after block 2, blocks 4 and 5 can run at the same time; 6 and 7 at the same time
after 5; block 10's signing setup any time after 1 once the owner's account exists. At most two blocks
are in flight at once, so reviews stay small.

**Exit criteria for TestFlight (internal):** blocks 1 to 10 merged; CI green on both Lockdown modes;
the notarized direct build opens on a clean macOS 13, 15 and 26 machine; the teammate who saw the
white window runs it with Lockdown Mode on; every feature in section 1 has a row in
`privacy-facts.json` for the Swift app and the test passes; no private API (App Store Connect
validation of the Store build passes).

**Exit criteria for the Store:** one week of internal TestFlight with no crash in the crash reports
and no blank-window report; block 11 merged; demo account and review notes ready; decisions 7.1 to
7.3 settled (paste, payments, login); App Store Connect validation clean. If review rejects
auto-paste, ship with copy-only and keep auto-paste in the direct build.

## 7. Open decisions

| # | Decision | Options | Recommendation |
|---|---|---|---|
| 7.1 | Auto-paste in the Store build | (a) submit with auto-paste via `CGEventPost`; (b) copy-only in the Store, auto-paste in the direct build | (a) behind a feature flag with a clear explanation in the review notes, fall back to (b) on rejection. Keep the direct build either way |
| 7.2 | Payments in the Store build | (a) no purchase UI or links in the Store build (bridge `store: true` hides them); (b) add IAP for plans; (c) US-only external purchase link | (a) for 1.0. It needs a small web change: the upgrade buttons check `store` |
| 7.3 | Sign-in options for 4.8 | (a) email code + Google, argue the own-account exemption; (b) add Sign in with Apple on the server | (b): removes a likely rejection; server work is a separate PR before block 10 |
| 7.4 | Bundle id and name | keep `ai.zerosoft.desktop` or new `ai.zerosoft.mac` | `ai.zerosoft.mac`, name "zerosoft" |
| 7.5 | Tauri Mac build after the Swift 1.0 | keep for macOS 11 and 12, or stop | Keep for 3 months as "legacy" on `/download` for macOS 11 and 12, then stop and delete the Mac-only Rust |
| 7.6 | Minimum macOS | 13 or 14 | 13 (ScreenCaptureKit audio, `SMAppService`, Lockdown preference); Core Audio taps from 14.2 at runtime |
| 7.7 | Direct build at all | Store only, or Store + notarized direct | Both: the direct build keeps auto-paste and self-hosted users who do not use the Store |
| 7.8 | Honour system Lockdown Mode in our web views | (a) WebKit default (no restrictions on Mac); (b) follow the system setting with `isLockdownModeEnabled`; (c) a Settings switch | (a) by default, (c) as an option for users who want it, with a page that lists what stops working. (b) would break calls, Rec and offline for exactly the users who turned on Lockdown Mode for other reasons |
| 7.9 | Project generation | XcodeGen YAML or a committed `.xcodeproj` | XcodeGen: reviewable diffs, no `pbxproj` merge conflicts between agents |
| 7.10 | Apple Developer account owner | personal or organization | Organization (needs D-U-N-S); the seller name shows on the Store |
