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
        let mode = self.mode
        if mode == .hang {
            lock.lock(); held.append(client); lock.unlock()
            return
        }
        let status: String, extra: String, bytes: [UInt8]
        if mode != .blank, path.hasPrefix("/fonts/fixture.ttf") {
            (status, extra, bytes) = Self.font()
        } else {
            let (s, body, e) = page(path: path, mode: mode)
            (status, extra, bytes) = (s, e, Array(body.utf8))
        }
        let type = extra.isEmpty ? "Content-Type: text/html; charset=utf-8\r\n" : ""
        let head = "HTTP/1.1 \(status)\r\n\(type)\(extra)Content-Length: \(bytes.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        _ = Array(head.utf8).withUnsafeBufferPointer { write(client, $0.baseAddress, $0.count) }
        _ = bytes.withUnsafeBufferPointer { write(client, $0.baseAddress, $0.count) }
        close(client)
    }

    private func readHead(_ client: Int32) -> String {
        var data = [UInt8]()
        var buf = [UInt8](repeating: 0, count: 4096)
        while data.count < 65_536 {
            let n = read(client, &buf, buf.count)
            if n <= 0 { break }
            data.append(contentsOf: buf[0 ..< n])
            if String(decoding: data, as: UTF8.self).contains("\r\n\r\n") { break }
        }
        return String(decoding: data, as: UTF8.self)
    }

    /// (status line, body, extra headers; with extra headers the page sets its own type).
    private func page(path: String, mode: Mode) -> (String, String, String) {
        if path.hasPrefix("/favicon") { return ("404 Not Found", "", "") }
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
        <p><button onclick="window.open()">Open blank</button></p>
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
            res(function () { return h.postMessage({ cmd: 'startLogin', args: {} }); }),
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
