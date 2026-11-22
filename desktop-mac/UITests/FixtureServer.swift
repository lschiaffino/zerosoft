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
    static let csrfToken = "fixture-csrf+token/1"
    static let csrfCookie = "next-auth.csrf-token=fixturecsrfcookie"

    /// The Settings window's server side (block 5): dictation settings, the dictionary, the
    /// history and the sign-out, kept in memory.
    private var voice: [String: Any] = ["language": "auto", "cleanupMode": "per_app", "cleanupDepth": "standard", "aiCleanup": true, "styles": [String: String]()]
    private var entries: [[String: Any]] = [["id": "e1", "kind": "word", "phrase": "zerosoft", "replacement": ""]]
    private var nextEntry = 2
    private var _writes: [String] = []
    /// Every write of the Settings window: "PATCH /api/voice/settings {body}", "POST ...",
    /// "DELETE ...", "signout ok|bad"; "bad-origin <path>" when a write came without the
    /// server as Origin.
    var writes: [String] {
        lock.lock(); defer { lock.unlock() }; return _writes
    }

    var dictionaryIDs: [String] {
        lock.lock(); defer { lock.unlock() }; return entries.compactMap { $0["id"] as? String }
    }

    private var _dictations: [String] = []
    /// One entry per request to /api/voice/dictate (block 6): "warm session=no",
    /// "ok context=other app=yes capture=desktop fast=1 rate=16000 ms=1000", "signed-out",
    /// "bad-origin" or "bad-body <why>". The app name itself is not recorded.
    var dictations: [String] {
        lock.lock(); defer { lock.unlock() }; return _dictations
    }

    static let dictatedText = "zs-dictated-text"

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
        let (request, rawBody) = readRequest(client)
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
        } else if mode != .blank, path.hasPrefix("/api/voice/dictate") {
            let (s, body, e) = dictate(request: request, body: rawBody)
            (status, extra, bytes) = (s, e, Array(body.utf8))
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

    /// The request (head and body, as text) and the body's bytes as they came (an upload is
    /// binary: its length is counted in bytes, not in decoded characters).
    private func readRequest(_ client: Int32) -> (String, [UInt8]) {
        var data = [UInt8]()
        var buf = [UInt8](repeating: 0, count: 65_536)
        var bodyStart: Int?
        var length = 0
        while data.count < 8 * 1024 * 1024 {
            let n = read(client, &buf, buf.count)
            if n <= 0 { break }
            data.append(contentsOf: buf[0 ..< n])
            if bodyStart == nil, let end = Self.find(data, Array("\r\n\r\n".utf8)) {
                bodyStart = end + 4
                let head = String(decoding: data[0 ..< end], as: UTF8.self)
                length = Self.header(head, "Content-Length").flatMap { Int($0) } ?? 0
            }
            if let start = bodyStart, data.count - start >= length { break }
            if bodyStart == nil, data.count >= 65_536 { break }
        }
        let body = bodyStart.map { Array(data[min($0, data.count)...]) } ?? []
        return (String(decoding: data, as: UTF8.self), body)
    }

    private static func find(_ data: [UInt8], _ needle: [UInt8], from: Int = 0) -> Int? {
        guard !needle.isEmpty, data.count >= needle.count, from <= data.count - needle.count else { return nil }
        var i = from
        while i <= data.count - needle.count {
            if data[i] == needle[0], Array(data[i ..< i + needle.count]) == needle { return i }
            i += 1
        }
        return nil
    }

    /// POST /api/voice/dictate (app/api/voice/dictate/route.ts), reduced: the session, the same
    /// origin, then the multipart fields and a real 16 kHz WAV. GET warms (204).
    private func dictate(request: String, body: [UInt8]) -> (String, String, String) {
        let method = request.split(separator: " ").first.map(String.init) ?? "GET"
        func note(_ s: String) { lock.lock(); _dictations.append(s); lock.unlock() }
        if method == "GET" {
            note("warm session=\(Self.signedIn(request) ? "yes" : "no")")
            return ("204 No Content", "", "Content-Type: text/plain\r\n")
        }
        if Self.header(request, "Origin") != origin {
            note("bad-origin")
            return ("403 Forbidden", #"{"error":"origin"}"#, Self.json)
        }
        guard Self.signedIn(request) else {
            note("signed-out")
            return ("401 Unauthorized", #"{"error":"unauthorized"}"#, Self.json)
        }
        let type = Self.header(request, "Content-Type") ?? ""
        guard let range = type.range(of: "boundary=") else {
            note("bad-body type")
            return ("400 Bad Request", #"{"error":"audio_type"}"#, Self.json)
        }
        let parts = Self.multipart(body, boundary: String(type[range.upperBound...]))
        let field = { (name: String) in parts[name].map { String(decoding: $0.data, as: UTF8.self) } }
        guard let audio = parts["audio"], audio.head.contains("filename=\"dictation.wav\""), audio.head.contains("Content-Type: audio/wav"),
              audio.data.count > 44, Array(audio.data[0 ..< 4]) == Array("RIFF".utf8) else {
            note("bad-body audio")
            return ("400 Bad Request", #"{"error":"empty_audio"}"#, Self.json)
        }
        let rate = Int(audio.data[24]) | Int(audio.data[25]) << 8 | Int(audio.data[26]) << 16 | Int(audio.data[27]) << 24
        let app = field("sourceApp") ?? ""
        note("ok context=\(field("context") ?? "-") app=\(app.isEmpty ? "none" : app == "desktop" ? "desktop" : "yes") capture=\(field("capture") ?? "-") fast=\(field("fast") ?? "-") rate=\(rate) ms=\(field("durationMs") ?? "-")")
        let answer: [String: Any] = [
            "text": Self.dictatedText, "raw": "zs dictated text", "ai": false,
            "timings": ["transcribeMs": 5, "cleanupMs": 0, "totalMs": 7],
        ]
        return ("201 Created", Self.encode(answer), Self.json)
    }

    /// name -> (part head, part bytes).
    private static func multipart(_ body: [UInt8], boundary: String) -> [String: (head: String, data: [UInt8])] {
        let marker = Array("--\(boundary)".utf8)
        var out: [String: (head: String, data: [UInt8])] = [:]
        var at = find(body, marker) ?? body.count
        while at < body.count {
            let start = at + marker.count
            guard let next = find(body, marker, from: start) else { break }
            var part = Array(body[start ..< next])
            if part.starts(with: Array("\r\n".utf8)) { part.removeFirst(2) }
            if part.count >= 2, Array(part.suffix(2)) == Array("\r\n".utf8) { part.removeLast(2) }
            if let split = find(part, Array("\r\n\r\n".utf8)) {
                let head = String(decoding: part[0 ..< split], as: UTF8.self)
                if let r = head.range(of: "name=\""), let end = head[r.upperBound...].firstIndex(of: "\"") {
                    out[String(head[r.upperBound ..< end])] = (head, Array(part[(split + 4)...]))
                }
            }
            at = next
        }
        return out
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
            let body = #"{"total":3,"talk":1,"bell":2,"notifications":[],"byPath":{},"now":"2026-11-22T10:00:00.000Z","disabledApps":[],"user":{"email":"fixture@example.com","name":"Fixture"}}"#
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

    private static let json = "Content-Type: application/json\r\n"

    private static func encode(_ object: Any) -> String {
        (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])).map { String(decoding: $0, as: UTF8.self) } ?? "{}"
    }

    /// The routes the Settings window calls (lib/routes and app/api/voice), reduced.
    private func settings(path: String, request: String) -> (String, String, String)? {
        let method = request.split(separator: " ").first.map(String.init) ?? "GET"
        let route = path.split(separator: "?").first.map(String.init) ?? path
        guard route.hasPrefix("/api/voice/") || route.hasPrefix("/api/auth/") else { return nil }
        if method != "GET", Self.header(request, "Origin") != origin {
            lock.lock(); _writes.append("bad-origin \(route)"); lock.unlock()
            return ("403 Forbidden", #"{"error":"origin"}"#, Self.json)
        }
        if route == "/api/auth/csrf" {
            return ("200 OK", #"{"csrfToken":"\#(Self.csrfToken)"}"#, "\(Self.json)Set-Cookie: \(Self.csrfCookie); Path=/; HttpOnly; SameSite=Lax\r\n")
        }
        if route == "/api/auth/signout", method == "POST" {
            let cookie = Self.header(request, "Cookie") ?? ""
            let form = Self.body(request)
            let token = Self.csrfToken.addingPercentEncoding(withAllowedCharacters: .alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? ""
            let ok = Self.signedIn(request) && cookie.contains(Self.csrfCookie) && form == "csrfToken=\(token)&json=true"
            lock.lock(); _writes.append(ok ? "signout ok" : "signout bad"); lock.unlock()
            return ("200 OK", #"{"url":"/"}"#, "\(Self.json)Set-Cookie: next-auth.session-token=; Path=/; Max-Age=0\r\n")
        }
        guard Self.signedIn(request) else { return ("401 Unauthorized", #"{"error":"unauthorized"}"#, Self.json) }
        lock.lock(); defer { lock.unlock() }
        if method != "GET" { _writes.append("\(method) \(route) \(Self.body(request))") }
        switch (method, route) {
        case ("GET", "/api/voice/settings"):
            return ("200 OK", Self.encode(["settings": voice, "transcription": true, "ai": true]), Self.json)
        case ("PATCH", "/api/voice/settings"):
            let patch = (try? JSONSerialization.jsonObject(with: Data(Self.body(request).utf8))) as? [String: Any] ?? [:]
            for (k, v) in patch { voice[k] = v }
            return ("200 OK", Self.encode(["settings": voice]), Self.json)
        case ("GET", "/api/voice/dictionary"):
            return ("200 OK", Self.encode(["entries": entries, "canEditTeam": false]), Self.json)
        case ("POST", "/api/voice/dictionary"):
            var entry = (try? JSONSerialization.jsonObject(with: Data(Self.body(request).utf8))) as? [String: Any] ?? [:]
            let id = "e\(nextEntry)"
            nextEntry += 1
            entry["id"] = id
            if entry["replacement"] == nil { entry["replacement"] = "" }
            entries.append(entry)
            return ("201 Created", Self.encode(["id": id]), Self.json)
        case ("GET", "/api/voice/sessions"):
            let item: [String: Any] = ["id": "s1", "kind": "dictation", "text": "zs-history-text", "durationMs": 3000, "startedAt": "2026-11-22T10:00:00.000Z"]
            return ("200 OK", Self.encode(["sessions": [item]]), Self.json)
        default:
            if method == "DELETE", route.hasPrefix("/api/voice/dictionary/") {
                let id = String(route.dropFirst("/api/voice/dictionary/".count))
                guard entries.contains(where: { $0["id"] as? String == id }) else { return ("404 Not Found", #"{"error":"not_found"}"#, Self.json) }
                entries.removeAll { $0["id"] as? String == id }
                return ("200 OK", #"{"ok":true}"#, Self.json)
            }
            return ("404 Not Found", #"{"error":"not_found"}"#, Self.json)
        }
    }

    /// (status line, body, extra headers; with extra headers the page sets its own type).
    private func page(path: String, mode: Mode, request: String) -> (String, String, String) {
        if path.hasPrefix("/favicon") { return ("404 Not Found", "", "") }
        if mode != .blank, let answer = signIn(path: path, request: request) { return answer }
        if mode != .blank, let answer = settings(path: path, request: request) { return answer }
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
        <p><button onclick="window.zerosoftDesktop.openSettings()">Desktop settings</button></p>
        <p><button onclick="zsMeeting.start()">Start meeting</button>
          <button onclick="zsMeeting.later()">Start meeting soon</button>
          <button onclick="zsMeeting.stop()">Stop meeting</button></p>
        <p id="meeting">meeting pending</p>
        <script>
        // What components/voice/RecorderProvider.tsx and audio.ts do with the bridge: the
        // recording flag, the computer's audio read every 250 ms, and Stop from the app.
        window.zsMeeting = (function () {
          var b = window.zerosoftDesktop, bytes = 0, timer = 0, res = 'none', stops = 0, rec = false;
          var paint = function () {
            document.getElementById('meeting').textContent = 'meeting rec=' + rec + ' start=' + res + ' audio=' + (bytes > 0) +
              ' stops=' + stops + ' sys=' + (b ? b.systemAudio : 'none') + ' ind=' + (b ? b.recordingIndicator : 'none') + ' end';
          };
          var start = function () {
            if (!b) return;
            rec = true;
            b.recording({ active: true, startedAt: Date.now() - 1000, path: '/app/voice/meetings/fixture-1' }).catch(function () {});
            b.systemAudioStart().then(function (r) {
              res = r;
              paint();
              if (r === 'ok') timer = setInterval(function () {
                b.systemAudioRead().then(function (v) { bytes += atob(v).length; paint(); }, function () {});
              }, 250);
            }, function (e) { res = 'error:' + (e && e.message); paint(); });
            paint();
          };
          var stop = function () {
            clearInterval(timer);
            if (b) {
              b.systemAudioStop().catch(function () {});
              b.recording({ active: false }).catch(function () {});
            }
            rec = false;
            stops++;
            paint();
          };
          addEventListener('zerosoft:stop-recording', stop);
          setTimeout(paint, 0);
          return { start: start, stop: stop, later: function () { setTimeout(start, 4000); } };
        })();
        </script>
        <p><button onclick="zsRec.start(false, false)">Start rec</button>
          <button onclick="zsRec.start(true, false)">Start rec with camera</button>
          <button onclick="zsRec.start(false, true)">Start rec with audio</button>
          <button onclick="zsRec.later()">Start rec soon</button></p>
        <p id="rec">rec pending</p>
        <script>
        // What components/rec/Recorder.tsx does with the bridge (block 8): the state for the
        // floating bar (countdown, recording, paused, finishing), the microphone level, and the
        // controls that come back as zerosoft:rec-control.
        window.zsRec = (function () {
          var b = window.zerosoftDesktop, phase = 'setup', mic = 'on', cam = null, seen = [], elapsed = 0, since = 0, lvl = 0, sys = 'none';
          var paint = function () {
            document.getElementById('rec').textContent = 'rec phase=' + phase + ' mic=' + mic + ' cam=' + (cam === null ? 'none' : 'bubble') +
              ' controls=' + (seen.slice(-6).join(',') || 'none') + ' sys=' + sys + ' api=' + (b ? typeof b.recOverlay : 'none') + ' end';
          };
          var send = function () {
            if (!b || typeof b.recOverlay !== 'function') return;
            var now = Date.now();
            b.recOverlay(phase === 'setup' ? { active: false } : {
              active: true, phase: phase, elapsedMs: elapsed + (phase === 'recording' ? now - since : 0), mic: mic, camera: cam
            }).catch(function () {});
          };
          var set = function (p) { phase = p; send(); paint(); };
          var record = function () {
            since = Date.now();
            set('recording');
            clearInterval(lvl);
            lvl = setInterval(function () { if (b) b.recLevel(0.5).catch(function () {}); }, 250);
          };
          var start = function (camera, audio) {
            elapsed = 0;
            cam = camera ? 'Fixture Camera' : null;
            if (audio && b) b.systemAudioStart().then(function (r) { sys = r; paint(); }, function () { sys = 'error'; paint(); });
            set('countdown');
            setTimeout(record, 1500);
          };
          var end = function () {
            clearInterval(lvl);
            if (b && sys === 'ok') b.systemAudioStop().catch(function () {});
            sys = 'none';
            set('setup');
          };
          addEventListener('zerosoft:rec-control', function (e) {
            var c = e.detail;
            seen.push(c);
            if (c === 'pause' || (c === 'toggle' && phase === 'recording')) { elapsed += Date.now() - since; set('paused'); }
            else if (c === 'resume' || c === 'toggle') { since = Date.now(); set('recording'); }
            else if (c === 'stop') { set('finishing'); setTimeout(end, 500); }
            else if (c === 'discard') end();
            else if (c === 'restart') { elapsed = 0; set('countdown'); setTimeout(record, 1500); }
            else if (c === 'mute' || c === 'unmute') { mic = c === 'mute' ? 'muted' : 'on'; send(); paint(); }
            else if (c === 'bubble-failed') { cam = null; send(); paint(); }
          });
          setTimeout(paint, 0);
          return { start: start, later: function () { setTimeout(function () { start(false, false); }, 4000); } };
        })();
        </script>
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
            res(function () { return h.postMessage({ cmd: 'recOverlay', args: { active: false } }); }),
            res(function () { return h.postMessage('info'); })
          ]).then(function (r) {
            show('bridge', 'bridge info=' + r[0] + ' unknown=' + r[1] + ' oversize=' + r[2] + ' badargs=' + r[3] +
              ' recoff=' + r[4] + ' malformed=' + r[5] + ' frozen=' + frozen + ' fields=' +
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
