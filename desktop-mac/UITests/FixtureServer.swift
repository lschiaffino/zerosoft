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
        let (status, body) = page(path: path, mode: mode)
        let bytes = Array(body.utf8)
        let head = "HTTP/1.1 \(status)\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(bytes.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
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

    private func page(path: String, mode: Mode) -> (String, String) {
        if path.hasPrefix("/favicon") { return ("404 Not Found", "") }
        if mode == .blank {
            return ("200 OK", "<!doctype html><html><head><title>blank</title></head><body><script>void 0</script></body></html>")
        }
        if path.hasPrefix("/second") {
            return ("200 OK", "<!doctype html><html><head><title>second</title></head><body><h1>zs-fixture-second</h1></body></html>")
        }
        // The feature line is for block 2, which asserts that Lockdown restrictions are active.
        return ("200 OK", """
        <!doctype html><html><head><meta charset="utf-8"><title>fixture</title></head><body>
        <h1>zs-fixture-ok</h1>
        <p><a href="\(otherOrigin)/elsewhere">Other origin</a></p>
        <p><a href="/second">Same origin</a></p>
        <p id="features">features</p>
        <script>
        document.getElementById('features').textContent = 'features idb=' + typeof indexedDB +
          ' rtc=' + typeof RTCPeerConnection + ' media=' + typeof navigator.mediaDevices +
          ' sw=' + ('serviceWorker' in navigator);
        </script>
        </body></html>
        """)
    }
}
