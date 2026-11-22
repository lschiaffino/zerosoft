import CryptoKit
import Darwin
import Foundation

/// A tiny HTTP server on 127.0.0.1 for the UI tests (plain BSD sockets, one thread). It serves a
/// page with a marker, a page that never draws, or no answer at all, and can start after the app
/// so a test can check that Retry recovers when the server comes back.
final class FixtureServer {
    enum Mode {
        /// The fixture page (marker `zs-fixture-ok`, links to the same and another origin).
        case normal
        /// A page whose body draws nothing.
        case blank
        /// Accepts the connection and never answers.
        case hang
    }

    let port: UInt16
    var origin: String { "http://127.0.0.1:\(port)" }
    /// Another origin on the same server: the navigation policy must keep it out of the app.
    var otherOrigin: String { "http://localhost:\(port)" }

    private let lock = NSLock()
    private var _mode: Mode = .normal
    var mode: Mode {
        get { lock.lock(); defer { lock.unlock() }; return _mode }
        set { lock.lock(); _mode = newValue; lock.unlock() }
    }

    /// What the sign-in start route sends back: the state it was given, or another one.
    enum LoginState {
        case echo
        case wrong
    }

    private var _loginState: LoginState = .echo
    var loginState: LoginState {
        get { lock.lock(); defer { lock.unlock() }; return _loginState }
        set { lock.lock(); _loginState = newValue; lock.unlock() }
    }

    /// Codes the sign-in route handed out, with their PKCE challenge (one use each).
    private var codes: [String: String] = [:]
    private var _tokenRequests: [String] = []
    /// One entry per POST /api/desktop/token: "ok", "bad-verifier", "unknown-code" or "malformed".
    var tokenRequests: [String] {
        lock.lock(); defer { lock.unlock() }; return _tokenRequests
    }

    private var _requests: [String] = []
    /// Every request, as host + path ("127.0.0.1:4100/app"), in order.
    var requests: [String] {
        lock.lock(); defer { lock.unlock() }; return _requests
    }

    static let sessionToken = "fixture.session-token_value"

    private var listenFD: Int32 = -1
    private var held: [Int32] = []
    private var thread: Thread?

    init(port: UInt16) {
        self.port = port
    }

    /// A port nothing listens on right now (bind to 0, read it, close).
    static func freePort() throws -> UInt16 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw failure("socket") }
        defer { close(fd) }
        var addr = loopback(port: 0)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else { throw failure("bind") }
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        withUnsafeMutablePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { _ = getsockname(fd, $0, &len) }
        }
        let port = UInt16(bigEndian: addr.sin_port)
        guard port != 0 else { throw failure("getsockname") }
        return port
    }

    /// The call that failed and errno, so a CI failure says what the runner refused.
    private static func failure(_ call: String) -> NSError {
        let code = errno
        return NSError(domain: "FixtureServer", code: Int(code), userInfo: [
            NSLocalizedDescriptionKey: "\(call) failed: errno \(code) (\(String(cString: strerror(code))))",
        ])
    }

    private static func loopback(port: UInt16) -> sockaddr_in {
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        return addr
    }

    func start() throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw Self.failure("socket") }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout<Int32>.size))
        var addr = Self.loopback(port: port)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else {
            let error = Self.failure("bind \(port)")
            close(fd)
            throw error
        }
        guard listen(fd, 16) == 0 else {
            let error = Self.failure("listen")
            close(fd)
            throw error
        }
        listenFD = fd
        let thread = Thread { [weak self] in self?.acceptLoop(fd) }
        thread.start()
        self.thread = thread
    }

    func stop() {
        if listenFD >= 0 {
            shutdown(listenFD, SHUT_RDWR)
            close(listenFD)
            listenFD = -1
        }
        lock.lock()
        held.forEach { close($0) }
        held.removeAll()
        lock.unlock()
    }

    private func acceptLoop(_ fd: Int32) {
        while true {
            let client = accept(fd, nil, nil)
            if client < 0 { return }
            // One connection per task: WebKit opens speculative connections that send nothing.
            DispatchQueue.global().async { [weak self] in self?.handle(client) }
        }
    }

    private func handle(_ client: Int32) {
        var nosigpipe: Int32 = 1
        setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &nosigpipe, socklen_t(MemoryLayout<Int32>.size))
        var wait = timeval(tv_sec: 10, tv_usec: 0)
        setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &wait, socklen_t(MemoryLayout<timeval>.size))
        let request = readHead(client)
        if request.isEmpty {
            close(client)
            return
        }
        let path = request.split(separator: " ").dropFirst().first.map(String.init) ?? "/"
        let host = Self.header(request, "Host") ?? ""
        lock.lock(); _requests.append("\(host)\(path)"); lock.unlock()
        let mode = self.mode
        if mode == .hang {
            lock.lock(); held.append(client); lock.unlock()
            return
        }
        let status: String, extra: String, bytes: [UInt8]
        if mode != .blank, path.hasPrefix("/fonts/fixture.ttf") {
            (status, extra, bytes) = Self.font()
        } else {
            let (s, body, e) = page(path: path, mode: mode, request: request)
            (status, extra, bytes) = (s, e, Array(body.utf8))
        }
        let type = extra.isEmpty ? "Content-Type: text/html; charset=utf-8\r\n" : ""
        let head = "HTTP/1.1 \(status)\r\n\(type)\(extra)Content-Length: \(bytes.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        _ = Array(head.utf8).withUnsafeBufferPointer { write(client, $0.baseAddress, $0.count) }
        _ = bytes.withUnsafeBufferPointer { write(client, $0.baseAddress, $0.count) }
        close(client)
    }

    /// The request head and, when it has a Content-Length, its body.
    private func readHead(_ client: Int32) -> String {
        var data = [UInt8]()
        var buf = [UInt8](repeating: 0, count: 4096)
        while data.count < 65_536 {
            let n = read(client, &buf, buf.count)
            if n <= 0 { break }
            data.append(contentsOf: buf[0 ..< n])
            let text = String(decoding: data, as: UTF8.self)
            guard let end = text.range(of: "\r\n\r\n") else { continue }
            let length = Self.header(text, "Content-Length").flatMap { Int($0) } ?? 0
            if text[end.upperBound...].utf8.count >= length { break }
        }
        return String(decoding: data, as: UTF8.self)
    }

    private static func header(_ request: String, _ name: String) -> String? {
        let head = request.components(separatedBy: "\r\n\r\n").first ?? ""
        for line in head.components(separatedBy: "\r\n").dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count == 2, parts[0].lowercased() == name.lowercased() { return parts[1] }
        }
        return nil
    }

    private static func body(_ request: String) -> String {
        guard let end = request.range(of: "\r\n\r\n") else { return "" }
        return String(request[end.upperBound...])
    }

    private static func query(_ path: String) -> [String: String] {
        let items = URLComponents(string: "http://x" + path)?.queryItems ?? []
        return Dictionary(items.map { ($0.name, $0.value ?? "") }, uniquingKeysWith: { a, _ in a })
    }

    private static func signedIn(_ request: String) -> Bool {
        (header(request, "Cookie") ?? "").contains("next-auth.session-token=\(sessionToken)")
    }

    private static func challenge(_ verifier: String) -> String {
        Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// The server side of the desktop sign-in (lib/desktop-auth.ts), reduced: the start route
    /// redirects to the app's callback with a one-time code, the token route checks the verifier
    /// against the challenge and answers with the session cookie.
    private func signIn(path: String, request: String) -> (String, String, String)? {
        if path.hasPrefix("/api/desktop/login") {
            let q = Self.query(path)
            guard let challenge = q["challenge"], challenge.count == 43, let state = q["state"], q["device"] == "darwin" else {
                return ("400 Bad Request", "bad request", "Content-Type: text/plain\r\n")
            }
            let code = String(repeating: "c", count: 11) + UUID().uuidString.replacingOccurrences(of: "-", with: "")
            lock.lock(); codes[code] = challenge; let wrong = _loginState == .wrong; lock.unlock()
            let back = wrong ? String(repeating: "W", count: 32) : state
            return ("302 Found", "", "Location: zerosoft://auth/callback?code=\(code)&state=\(back)\r\nContent-Type: text/html\r\n")
        }
        if path.hasPrefix("/api/desktop/token") {
            let json = (try? JSONSerialization.jsonObject(with: Data(Self.body(request).utf8))) as? [String: String]
            let outcome: String
            lock.lock()
            if let json, let code = json["code"], let verifier = json["verifier"] {
                if let challenge = codes.removeValue(forKey: code) {
                    outcome = Self.challenge(verifier) == challenge ? "ok" : "bad-verifier"
                } else {
                    outcome = "unknown-code"
                }
            } else {
                outcome = "malformed"
            }
            _tokenRequests.append(outcome)
            lock.unlock()
            guard outcome == "ok" else { return ("400 Bad Request", #"{"error":"invalid_grant"}"#, "Content-Type: application/json\r\n") }
            let body = #"{"token":"\#(Self.sessionToken)","cookie":{"name":"next-auth.session-token","domain":null,"secure":false,"maxAge":3600}}"#
            return ("200 OK", body, "Content-Type: application/json\r\n")
        }
        if path.hasPrefix("/api/desktop/badge") {
            guard Self.signedIn(request) else { return ("401 Unauthorized", #"{"error":"unauthorized"}"#, "Content-Type: application/json\r\n") }
            let body = #"{"total":3,"talk":1,"bell":2,"notifications":[],"byPath":{},"now":"2026-11-22T10:00:00.000Z","disabledApps":[]}"#
            return ("200 OK", body, "Content-Type: application/json\r\n")
        }
        if path.hasPrefix("/app") || path.hasPrefix("/es/app") {
            let route = path.split(separator: "?").first.map(String.init) ?? path
            let session = Self.signedIn(request) ? "yes" : "no"
            return ("200 OK", """
            <!doctype html><html><head><meta charset="utf-8"><title>app</title></head><body>
            <h1>zs-fixture-app</h1>
            <p id="state">app pending</p>
            <script>
            document.getElementById('state').textContent = 'app path=\(route) session=\(session) jscookie=' +
              (document.cookie.indexOf('session-token') >= 0 ? 'yes' : 'no') + ' end';
            </script>
            </body></html>
            """, "")
        }
        return nil
    }

    /// (status line, body, extra headers; with extra headers the page sets its own type).
    private func page(path: String, mode: Mode, request: String) -> (String, String, String) {
        if path.hasPrefix("/favicon") { return ("404 Not Found", "", "") }
        if mode != .blank, let answer = signIn(path: path, request: request) { return answer }
        if mode == .blank {
            return ("200 OK", "<!doctype html><html><head><title>blank</title></head><body><script>void 0</script></body></html>", "")
        }
        if path.hasPrefix("/second") {
            return ("200 OK", "<!doctype html><html><head><title>second</title></head><body><h1>zs-fixture-second</h1></body></html>", "")
        }
        // An integration start route: redirects to the provider (another origin).
        if path.hasPrefix("/api/integrations/demo/start") {
            return ("302 Found", "", "Location: \(otherOrigin)/provider/authorize\r\nContent-Type: text/html\r\n")
        }
        // A file download from the server's own origin.
        if path.hasPrefix("/files/report.csv") {
            return ("200 OK", "a,b\n1,2\n", "Content-Type: text/csv\r\nContent-Disposition: attachment; filename=\"report.csv\"\r\n")
        }
        // A frame that tries the bridge: from another origin, the same origin, or sandboxed
        // (opaque origin). The native side must refuse all three.
        if path.hasPrefix("/frame") {
            let who = path.contains("who=same") ? "same" : path.contains("who=sandboxed") ? "sandboxed" : "other"
            return ("200 OK", Self.frame(who), "")
        }
        // A service worker for the feature attempts (it does nothing).
        if path.hasPrefix("/sw.js") {
            return ("200 OK", "self.addEventListener('fetch', function () {});", "Content-Type: text/javascript\r\n")
        }
        // The feature line tells the tests whether Lockdown restrictions are active.
        return ("200 OK", """
        <!doctype html><html><head><meta charset="utf-8"><title>fixture</title>
        <style>
        @font-face { font-family: ZSFixture; src: url(/fonts/fixture.ttf) format('truetype'); font-display: swap; }
        #font { font-family: ZSFixture, sans-serif; }
        iframe { width: 320px; height: 40px; border: 0; }
        </style></head><body>
        <h1>zs-fixture-ok</h1>
        <p><a href="\(otherOrigin)/elsewhere">Other origin</a></p>
        <p><a href="/second">Same origin</a></p>
        <p><a href="/api/integrations/demo/start">Connect demo</a></p>
        <p><a href="/files/report.csv">Download report</a></p>
        <p><a href="/app/two">App two</a></p>
        <p><a href="/app/one" target="_blank">Blank same</a></p>
        <p><a href="\(otherOrigin)/blank-other" target="_blank">Blank other</a></p>
        <p><button onclick="window.open()">Open blank</button></p>
        <p><button onclick="window.zerosoftDesktop.startLogin()">Sign in with Google</button></p>
        <p><button onclick="new Notification('zs-note', { body: 'zs-body' })">Notify</button></p>
        <p id="detect">detect pending</p>
        <p id="features">features</p>
        <script>
        document.getElementById('features').textContent = 'features wasm=' + typeof WebAssembly +
          ' idb=' + typeof indexedDB + ' rtc=' + typeof RTCPeerConnection +
          ' media=' + typeof navigator.mediaDevices + ' sw=' + ('serviceWorker' in navigator) + ' end';
        </script>
        <p id="font">zs-font-text</p>
        <p id="fonts">fonts pending</p>
        <p id="attempts">attempts pending</p>
        <p id="bridge">bridge pending</p>
        <iframe title="frame other" src="\(otherOrigin)/frame?who=other"></iframe>
        <iframe title="frame same" src="/frame?who=same"></iframe>
        <iframe title="frame sandboxed" sandbox="allow-scripts" src="/frame?who=sandboxed"></iframe>
        <script>
        (function () {
          var show = function (id, text) { document.getElementById(id).textContent = text; };
          // Web fonts (next/font, KaTeX): under Lockdown they may fall back to system fonts;
          // the text must show either way.
          if (document.fonts && document.fonts.load) {
            document.fonts.load('16px ZSFixture').then(function (list) {
              show('fonts', 'fonts status=' + (list.length ? 'loaded' : 'failed') + ' end');
            }, function () { show('fonts', 'fonts status=error end'); });
          } else show('fonts', 'fonts status=unsupported end');

          // What the web app's offline code does: open IndexedDB, register a service worker.
          var idb = new Promise(function (done) {
            if (typeof indexedDB === 'undefined' || !indexedDB) return done('absent');
            try {
              var r = indexedDB.open('zs-fixture', 1);
              r.onsuccess = function () { r.result.close(); done('opened'); };
              r.onerror = function () { done('error'); };
            } catch (e) { done('threw'); }
          });
          var sw = !('serviceWorker' in navigator) ? Promise.resolve('absent') :
            navigator.serviceWorker.register('/sw.js').then(function () { return 'registered'; }, function () { return 'error'; });
          Promise.all([idb, sw]).then(function (r) { show('attempts', 'attempts idb=' + r[0] + ' sw=' + r[1] + ' end'); });

          // The bridge from the main frame: info works, everything malformed is refused.
          var b = window.zerosoftDesktop;
          // What desktopBridge() in the web app checks, and the Notification shim.
          show('detect', 'detect startLogin=' + (b ? typeof b.startLogin : 'none') + ' notification=' + typeof Notification +
            ' permission=' + (typeof Notification !== 'undefined' ? Notification.permission : 'none') +
            ' settingsWindow=' + (b ? b.settingsWindow : 'none') + ' end');
          var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.zerosoft;
          var res = function (send) {
            if (!h) return Promise.resolve('nohandler');
            try {
              return Promise.resolve(send()).then(function () { return 'ok'; }, function (e) { return 'denied:' + (e && e.message); });
            } catch (e) { return Promise.resolve('threw'); }
          };
          var frozen = false;
          if (b) {
            try { b.info = null; } catch (e) {}
            try { window.zerosoftDesktop = null; } catch (e) {}
            frozen = Object.isFrozen(b) && typeof b.info === 'function' && window.zerosoftDesktop === b;
          }
          Promise.all([
            b ? b.info().then(function (i) {
              return 'ok:' + i.platform + ':store=' + i.store + ':lockdown=' + i.lockdown + ':' + i.lockdownSetting;
            }, function (e) { return 'denied:' + (e && e.message); }) : Promise.resolve('absent'),
            res(function () { return h.postMessage({ cmd: 'eval', args: { code: '1' } }); }),
            res(function () { return h.postMessage({ cmd: 'notify', args: { title: new Array(5001).join('x') } }); }),
            res(function () { return h.postMessage({ cmd: 'recLevel', args: { level: 'loud' } }); }),
            res(function () { return h.postMessage({ cmd: 'systemAudioStop', args: {} }); }),
            res(function () { return h.postMessage('info'); })
          ]).then(function (r) {
            show('bridge', 'bridge info=' + r[0] + ' unknown=' + r[1] + ' oversize=' + r[2] + ' badargs=' + r[3] +
              ' unimplemented=' + r[4] + ' malformed=' + r[5] + ' frozen=' + frozen + ' fields=' +
              (b ? b.platform + ',' + b.store + ',' + b.lockdown : 'none') + ' end');
          });
        })();
        </script>
        </body></html>
        """, "")
    }

    /// The page inside the iframes: it calls the handler directly (the bridge script runs in the
    /// main frame only) and shows what happened.
    private static func frame(_ who: String) -> String {
        """
        <!doctype html><html><head><meta charset="utf-8"><title>frame</title></head><body>
        <p id="r">frame-\(who) pending</p>
        <script>
        (function () {
          var r = document.getElementById('r');
          var seen = typeof window.zerosoftDesktop !== 'undefined';
          var h = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.zerosoft;
          if (!h) { r.textContent = 'frame-\(who)=nohandler bridge=' + seen + ' end'; return; }
          Promise.resolve(h.postMessage({ cmd: 'info', args: {} })).then(function () {
            r.textContent = 'frame-\(who)=allowed bridge=' + seen + ' end';
          }, function (e) {
            r.textContent = 'frame-\(who)=denied:' + (e && e.message) + ' bridge=' + seen + ' end';
          });
        })();
        </script>
        </body></html>
        """
    }

    /// A real TrueType font from the system, served as a web font (404 if none is readable).
    private static func font() -> (String, String, [UInt8]) {
        let candidates = [
            "/System/Library/Fonts/Supplemental/Courier New.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Supplemental/Georgia.ttf",
            "/System/Library/Fonts/Supplemental/Andale Mono.ttf",
        ]
        for path in candidates {
            if let data = FileManager.default.contents(atPath: path) {
                return ("200 OK", "Content-Type: font/ttf\r\n", [UInt8](data))
            }
        }
        return ("404 Not Found", "Content-Type: text/plain\r\n", [])
    }
}
