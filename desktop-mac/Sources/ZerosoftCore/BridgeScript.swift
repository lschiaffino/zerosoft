import Foundation

/// The user script that defines `window.zerosoftDesktop` (docs/desktop-swift.md, section 4.3).
/// The app injects it at document start, main frame only, in the page content world.
///
/// - It returns early unless `location.origin` is the server (the native side checks the origin
///   of every message again: this is only so other pages never see the object).
/// - It keeps a reference to the message handler before any page script runs, so a page cannot
///   swap `postMessage` under the bridge.
/// - The object is frozen and not writable. It carries the fields of `lib/desktop-bridge.ts`
///   (with the capability fields `settingsWindow`, `updateFeed` and `tabs` set to false for what
///   this build does not have yet) and the methods with a native side: `info()`, `startLogin()`
///   (block 3; `desktopBridge()` in the web app finds the app by it, as with Tauri), `notify()`.
///   `openSettings()` exists because the contract requires it; it does nothing until block 5.
/// - `window.Notification` becomes a shim that hands the page's title and body to the native
///   side (the app shows it only while it is not in front), as the Tauri app does. The web
///   features are measured before the shim replaces it.
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
          var quiet = function () {};
          var text = function (v, max) { return String(v == null ? '' : v).slice(0, max); };
          var bridge = Object.freeze({
            version: \(js(info.version)),
            platform: 'darwin',
            systemAudio: false,
            dictation: false,
            recordingIndicator: false,
            settingsWindow: \(BridgeInfo.settingsWindow),
            updateFeed: \(BridgeInfo.updateFeed),
            tabs: \(BridgeInfo.tabs),
            store: \(info.store),
            lockdown: \(info.lockdown),
            info: function () { return call('info'); },
            startLogin: function () { call('startLogin').catch(quiet); },
            openSettings: function () { call('openSettings').catch(quiet); },
            notify: function (title, body) {
              return call('notify', { title: text(title, \(Bridge.maxTitle)), body: body == null ? null : text(body, \(Bridge.maxBody)) });
            }
          });
          try { Object.defineProperty(window, 'zerosoftDesktop', { value: bridge }); } catch (e) { return; }
          var N = function (title, opts) { bridge.notify(title, opts && opts.body).catch(quiet); };
          N.permission = 'granted';
          N.requestPermission = function (cb) { if (typeof cb === 'function') cb('granted'); return Promise.resolve('granted'); };
          N.prototype.close = quiet;
          N.prototype.addEventListener = quiet;
          N.prototype.removeEventListener = quiet;
          try { Object.defineProperty(window, 'Notification', { value: N, configurable: true, writable: true }); } catch (e) {}
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
