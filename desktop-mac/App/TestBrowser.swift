#if DEBUG
import Foundation

/// UI tests only (`-ZSUITest YES`, Debug builds): stands in for the system sign-in window, which
/// CI cannot click through. It requests the start URL on the fixture server without following
/// the redirect and returns the `Location` (the `zerosoft://auth/callback` the server would send
/// the browser to), so the rest of the flow (state check, token exchange, cookie) is the real
/// code path.
enum TestBrowser {
    static func follow(_ url: URL, _ done: @escaping @MainActor @Sendable (URL?) -> Void) {
        let config = URLSessionConfiguration.ephemeral
        let session = URLSession(configuration: config, delegate: Stop(), delegateQueue: nil)
        session.dataTask(with: url) { _, response, _ in
            let location = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Location")
            let callback = location.flatMap(URL.init(string:))
            Task { @MainActor in done(callback) }
            session.finishTasksAndInvalidate()
        }.resume()
    }

    private final class Stop: NSObject, URLSessionTaskDelegate, Sendable {
        func urlSession(
            _ session: URLSession,
            task: URLSessionTask,
            willPerformHTTPRedirection response: HTTPURLResponse,
            newRequest request: URLRequest
        ) async -> URLRequest? {
            nil
        }
    }
}
#endif
