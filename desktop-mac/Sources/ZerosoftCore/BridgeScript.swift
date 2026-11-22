import Foundation

/// The user script that defines `window.zerosoftDesktop` (docs/desktop-swift.md, section 4.3).
/// The app injects it at document start, main frame only, in the page content world.
///
/// - It returns early unless `location.origin` is the server (the native side checks the origin
///   of every message again: this is only so other pages never see the object).
/// - It keeps a reference to the message handler before any page script runs, so a page cannot
///   swap `postMessage` under the bridge.
/// - The object is frozen and not writable. It carries the fields of `lib/desktop-bridge.ts` and
///   only the methods with a native side: `info()` in block 2. `startLogin` arrives with block 3,
///   so until then `desktopBridge()` in the web app returns null and the page behaves as in a
///   browser (the navigation policy sends Google sign-in to the browser).
/// - At DOMContentLoaded it posts `ready` with the paint count and the web features measured at
///   document start: the watchdog's second paint signal and the Lockdown proof of the UI tests.
public enum BridgeScript {
    public static func source(server: String, info: BridgeInfo) -> String {
        """
        (function () {
          if (location.origin !== \(js(server))) return;
          var w = window.webkit, h = w && w.messageHandlers && w.messageHandlers.\(Bridge.handlerName);
          if (!h || typeof h.postMessage !== 'function') return;
          var post = h.postMessage.bind(h);
          var call = function (cmd, args) {
            try { return Promise.resolve(post({ cmd: cmd, args: args || {} })); } catch (e) { return Promise.reject(e); }
          };
          var features = {
            wasm: typeof WebAssembly !== 'undefined',
            idb: typeof indexedDB !== 'undefined' && indexedDB !== null,
            sw: 'serviceWorker' in navigator,
            media: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
            rtc: typeof RTCPeerConnection !== 'undefined',
            audio: typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined',
            notification: typeof Notification !== 'undefined'
          };
          var bridge = Object.freeze({
            version: \(js(info.version)),
            platform: 'darwin',
            systemAudio: false,
            dictation: false,
            recordingIndicator: false,
            store: \(info.store),
            lockdown: \(info.lockdown),
            info: function () { return call('info'); }
          });
          try { Object.defineProperty(window, 'zerosoftDesktop', { value: bridge }); } catch (e) { return; }
          var ready = function () {
            var content = 0;
            try { content = \(LoadWatchdog.paintCheckScript); } catch (e) {}
            call('ready', { content: content, features: features }).catch(function () {});
          };
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
          else ready();
        })();
        """
    }

    /// A JS string literal (JSON, with the line separators JSON allows but old JS did not).
    static func js(_ s: String) -> String {
        let data = (try? JSONSerialization.data(withJSONObject: s, options: [.fragmentsAllowed])) ?? Data("\"\"".utf8)
        return String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }
}
