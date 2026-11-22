import Foundation

/// The user script that defines `window.zerosoftDesktop` (docs/desktop-swift.md, section 4.3).
/// The app injects it at document start, main frame only, in the page content world.
///
/// - It returns early unless `location.origin` is the server (the native side checks the origin
///   of every message again: this is only so other pages never see the object).
/// - It keeps a reference to the message handler before any page script runs, so a page cannot
///   swap `postMessage` under the bridge.
/// - The object is frozen and not writable. It carries the fields of `lib/desktop-bridge.ts`
///   (with the capability fields `settingsWindow` and `updateFeed` set to false for what this
///   build does not have yet, and `tabs` true) and the methods with a native side: `info()`, `startLogin()`
///   (block 3; `desktopBridge()` in the web app finds the app by it, as with Tauri), `notify()`.
///   `openSettings()` exists because the contract requires it; it does nothing until block 5.
/// - `window.Notification` becomes a shim that hands the page's title and body to the native
///   side (the app shows it only while it is not in front), as the Tauri app does. The web
///   features are measured before the shim replaces it.
/// - At DOMContentLoaded it posts `ready` with the paint count and the web features measured at
///   document start: the watchdog's second paint signal and the Lockdown proof of the UI tests.
/// - Tabs (block 4): it reports the path and title (`tabs state`) when they change, sends
///   Cmd-click, Cmd+Shift-click, Cmd+Option-click, middle click and right click on links of the
///   server to the app (`open`, `open-tab`, `open-window`, `menu`), and Cmd+1...9, Cmd+Shift+[ ]
///   and Ctrl+Tab while the page has the keyboard (`select`, `prev`, `next`). Links to other
///   origins are left to the page and the navigation policy.
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
          // Tabs (block 4, as bridge_script in lib.rs): path and title for the strip; Cmd-click,
          // middle click and right click on the server's links; Cmd+1...9, Cmd+Shift+[ ] and
          // Ctrl+Tab while the page has the keyboard (the native menus cover the rest).
          var tabs = function (a) { call('tabs', a).catch(quiet); };
          var last = '';
          var report = function () {
            var p = location.pathname + location.search + location.hash;
            if (p.length > \(Bridge.maxPath)) return;
            // The page's title; when it is the site's generic one, the h1 (the open record).
            var t = document.title || '';
            if (/^zerosoft(\\s*[·|]|$)/i.test(t.trim())) {
              var h = document.querySelector('main h1') || document.querySelector('h1');
              t = h ? (h.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : '';
            }
            t = text(t, \(Bridge.maxTitle));
            var k = p + '|' + t;
            if (k === last) return;
            last = k;
            tabs({ action: 'state', path: p, title: t });
          };
          var soon = function () { if (!soon.t) soon.t = setTimeout(function () { soon.t = 0; report(); }, 150); };
          ['pushState', 'replaceState'].forEach(function (m) {
            var orig = history[m];
            history[m] = function () { var r = orig.apply(this, arguments); soon(); return r; };
          });
          addEventListener('popstate', soon);
          addEventListener('hashchange', soon);
          var watch = function () {
            soon();
            try { new MutationObserver(soon).observe(document.documentElement, { childList: true, subtree: true, characterData: true }); } catch (e) {}
          };
          var linkPath = function (el) {
            var a = el && el.closest ? el.closest('a[href]') : null;
            if (!a || a.hasAttribute('download')) return null;
            try {
              var u = new URL(a.getAttribute('href'), location.href);
              var p = u.pathname + u.search + u.hash;
              return u.origin === location.origin && p.length <= \(Bridge.maxPath) ? p : null;
            } catch (e) { return null; }
          };
          document.addEventListener('click', function (e) {
            if (e.button !== 0 || !e.metaKey) return;
            var p = linkPath(e.target);
            if (!p) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            // Cmd-click: behind (or a window, by preference); Cmd+Shift: in front; Cmd+Option: window.
            tabs({ action: e.altKey ? 'open-window' : e.shiftKey ? 'open-tab' : 'open', path: p });
          }, true);
          document.addEventListener('mousedown', function (e) { if (e.button === 1 && linkPath(e.target)) e.preventDefault(); }, true);
          document.addEventListener('auxclick', function (e) {
            if (e.button !== 1) return;
            var p = linkPath(e.target);
            if (!p) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            tabs({ action: 'open', path: p });
          }, true);
          // Right click on a link: the app's menu, unless the page put up its own.
          addEventListener('contextmenu', function (e) {
            if (e.defaultPrevented) return;
            var p = linkPath(e.target);
            if (!p) return;
            e.preventDefault();
            tabs({ action: 'menu', path: p });
          });
          document.addEventListener('keydown', function (e) {
            if (e.ctrlKey && !e.metaKey && !e.altKey && e.key === 'Tab') {
              e.preventDefault();
              tabs({ action: e.shiftKey ? 'prev' : 'next' });
              return;
            }
            if (!e.metaKey || e.altKey || e.ctrlKey) return;
            if (!e.shiftKey && /^Digit[1-9]$/.test(e.code)) {
              e.preventDefault();
              tabs({ action: 'select', n: Number(e.code.slice(5)) });
            } else if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
              e.preventDefault();
              tabs({ action: e.code === 'BracketLeft' ? 'prev' : 'next' });
            }
          }, true);
          var ready = function () {
            watch();
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
