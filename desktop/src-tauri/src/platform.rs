//! Lo que depende del sistema: permisos de macOS (micrófono y Accesibilidad), la app de adelante
//! y la tecla de pegar simulada.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionStatus {
    Granted,
    Denied,
    NotDetermined,
    Restricted,
    /// Windows: no hay permiso que pedir.
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    NotNeeded,
}

#[cfg(target_os = "macos")]
mod mac {
    use super::PermissionStatus;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;
    use std::ffi::c_void;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const c_void) -> bool;
    }

    #[link(name = "AVFoundation", kind = "framework")]
    extern "C" {}

    pub fn accessibility(prompt: bool) -> bool {
        unsafe {
            if !prompt {
                return AXIsProcessTrusted();
            }
            // @{ kAXTrustedCheckOptionPrompt: @YES }: macOS suma la app a la lista (apagada) y muestra el aviso.
            let key = NSString::from_str("AXTrustedCheckOptionPrompt");
            let yes: *mut AnyObject = msg_send![class!(NSNumber), numberWithBool: true];
            let dict: *mut AnyObject = msg_send![class!(NSDictionary), dictionaryWithObject: yes, forKey: &*key];
            AXIsProcessTrustedWithOptions(dict as *const c_void)
        }
    }

    // ---------- Pegar: Cmd+V con CGEvent ----------
    //
    // No con enigo: su Key::Unicode busca la tecla con TIS (Text Input Sources), que en macOS 14+
    // solo se puede llamar desde el hilo principal (si no, libdispatch cierra la app), y no marca
    // el evento con Command: si Option seguía apretado (el atajo es Option + Espacio) salía
    // Cmd+Option+V. Acá la tecla se busca en el hilo principal y el evento lleva solo Command.

    #[repr(C)]
    struct CFOpaque(u8);

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFRelease(cf: *const c_void);
        fn CFDataGetBytePtr(data: *const c_void) -> *const u8;
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceCreate(state: i32) -> *mut CFOpaque;
        fn CGEventCreateKeyboardEvent(source: *mut CFOpaque, keycode: u16, down: bool) -> *mut CFOpaque;
        fn CGEventSetFlags(event: *mut CFOpaque, flags: u64);
        fn CGEventPost(tap: u32, event: *mut CFOpaque);
    }

    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn TISCopyCurrentKeyboardLayoutInputSource() -> *mut c_void;
        fn TISGetInputSourceProperty(source: *mut c_void, key: *const c_void) -> *const c_void;
        static kTISPropertyUnicodeKeyLayoutData: *const c_void;
        fn LMGetKbdType() -> u8;
        fn UCKeyTranslate(
            layout: *const u8,
            code: u16,
            action: u16,
            modifiers: u32,
            kbd_type: u32,
            options: u32,
            dead_keys: *mut u32,
            max_len: usize,
            len: *mut usize,
            chars: *mut u16,
        ) -> i32;
    }

    /// kVK_ANSI_V: la V en un teclado QWERTY.
    pub const ANSI_V: u16 = 9;

    /// La tecla que escribe "v" con la distribución de teclado actual (Dvorak, AZERTY...).
    /// Solo en el hilo principal.
    pub fn keycode_for_v() -> u16 {
        unsafe {
            let src = TISCopyCurrentKeyboardLayoutInputSource();
            if src.is_null() {
                return ANSI_V;
            }
            let data = TISGetInputSourceProperty(src, kTISPropertyUnicodeKeyLayoutData);
            let mut found = ANSI_V;
            if !data.is_null() {
                let layout = CFDataGetBytePtr(data);
                let kbd = LMGetKbdType() as u32;
                for code in 0u16..128 {
                    let mut dead = 0u32;
                    let mut len = 0usize;
                    let mut chars = [0u16; 4];
                    // kUCKeyActionDisplay = 3, kUCKeyTranslateNoDeadKeysMask = 1.
                    if UCKeyTranslate(layout, code, 3, 0, kbd, 1, &mut dead, chars.len(), &mut len, chars.as_mut_ptr()) == 0 && len == 1 && chars[0] == 'v' as u16 {
                        found = code;
                        break;
                    }
                }
            }
            CFRelease(src as *const c_void);
            found
        }
    }

    /// Cmd+V a la app de adelante. false si macOS no dejó crear el evento.
    pub fn post_cmd_v(keycode: u16) -> bool {
        // kCGEventSourceStateCombinedSessionState = 0; kCGSessionEventTap = 1.
        // Flags: kCGEventFlagMaskCommand (1 << 20) | NX_DEVICELCMDKEYMASK (0x08), como un Command real.
        const CMD: u64 = (1 << 20) | 0x08;
        unsafe {
            let source = CGEventSourceCreate(0);
            let down = CGEventCreateKeyboardEvent(source, keycode, true);
            let up = CGEventCreateKeyboardEvent(source, keycode, false);
            let ok = !down.is_null() && !up.is_null();
            if ok {
                CGEventSetFlags(down, CMD);
                CGEventSetFlags(up, CMD);
                CGEventPost(1, down);
                std::thread::sleep(std::time::Duration::from_millis(8));
                CGEventPost(1, up);
            }
            for p in [down, up, source] {
                if !p.is_null() {
                    CFRelease(p as *const c_void);
                }
            }
            ok
        }
    }

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
        fn CGRequestScreenCaptureAccess() -> bool;
    }

    /// Grabación de pantalla (Rec): macOS no dice "sin decidir", solo si está permitida.
    pub fn screen() -> PermissionStatus {
        if unsafe { CGPreflightScreenCaptureAccess() } {
            PermissionStatus::Granted
        } else {
            PermissionStatus::Denied
        }
    }

    /// Pide grabación de pantalla (la primera vez macOS suma la app a la lista y avisa). true si ya estaba.
    pub fn request_screen() -> bool {
        unsafe { CGRequestScreenCaptureAccess() }
    }

    pub fn camera() -> PermissionStatus {
        capture_status("vide")
    }

    pub fn microphone() -> PermissionStatus {
        capture_status("soun")
    }

    fn capture_status(kind: &str) -> PermissionStatus {
        // AVAuthorizationStatus: 0 sin decidir, 1 restringido, 2 denegado, 3 permitido.
        let media = NSString::from_str(kind);
        let status: isize = unsafe { msg_send![class!(AVCaptureDevice), authorizationStatusForMediaType: &*media] };
        match status {
            3 => PermissionStatus::Granted,
            2 => PermissionStatus::Denied,
            1 => PermissionStatus::Restricted,
            _ => PermissionStatus::NotDetermined,
        }
    }
}

pub const PANE_MIC: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone";
pub const PANE_SCREEN: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";
pub const PANE_ACCESSIBILITY: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
pub const PANE_CAMERA: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera";

pub fn camera_status() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    return mac::camera();
    #[cfg(not(target_os = "macos"))]
    PermissionStatus::NotNeeded
}

pub fn screen_status() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    return mac::screen();
    #[cfg(not(target_os = "macos"))]
    PermissionStatus::NotNeeded
}

/// Pide grabación de pantalla (Mac). true si ya estaba.
pub fn request_screen() -> bool {
    #[cfg(target_os = "macos")]
    return mac::request_screen();
    #[cfg(not(target_os = "macos"))]
    true
}

/// Servicio de TCC (tccutil) de cada permiso que se puede restablecer.
pub fn tcc_service(kind: &str) -> Option<&'static str> {
    match kind {
        "accessibility" => Some("Accessibility"),
        "microphone" => Some("Microphone"),
        "camera" => Some("Camera"),
        "screen" => Some("ScreenCapture"),
        _ => None,
    }
}

pub fn microphone_status() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    return mac::microphone();
    #[cfg(not(target_os = "macos"))]
    PermissionStatus::NotNeeded
}

pub fn accessibility_status() -> PermissionStatus {
    #[cfg(target_os = "macos")]
    return if mac::accessibility(false) { PermissionStatus::Granted } else { PermissionStatus::Denied };
    #[cfg(not(target_os = "macos"))]
    PermissionStatus::NotNeeded
}

/// Pide Accesibilidad con el aviso del sistema (Mac). true si ya estaba.
pub fn prompt_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    return mac::accessibility(true);
    #[cfg(not(target_os = "macos"))]
    true
}

/// Se puede simular Cmd/Ctrl+V.
pub fn can_simulate_paste() -> bool {
    accessibility_status() != PermissionStatus::Denied
}

/// Borra lo que macOS tenga guardado de Accesibilidad para esta app (Mac). Con firma ad hoc, el
/// permiso queda atado a la build exacta: después de una actualización la llave sigue prendida en
/// Ajustes del Sistema pero es de la build vieja, y AXIsProcessTrusted da false. Borrarla y volver
/// a pedir crea una entrada nueva para esta build (apagada: la persona la prende).
pub fn reset_accessibility(bundle_id: &str) -> bool {
    reset_permission("Accessibility", bundle_id)
}

/// Borra lo que macOS tenga guardado de un permiso (servicio de TCC) para esta app: la próxima vez
/// lo vuelve a preguntar. Sirve cuando la llave quedó atada a otra build.
pub fn reset_permission(service: &str, bundle_id: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        let ok_service = ["Accessibility", "Microphone", "Camera", "ScreenCapture"].contains(&service);
        if !ok_service || bundle_id.is_empty() || !bundle_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-') {
            return false;
        }
        return std::process::Command::new("/usr/bin/tccutil").args(["reset", service, bundle_id]).output().map(|o| o.status.success()).unwrap_or(false);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (service, bundle_id);
        true
    }
}

/// Cómo está firmada la app (Mac): "adhoc" (el permiso se ata a cada build), "stable" (un
/// certificado: el permiso sigue entre versiones) o "unknown". Se mira una vez.
pub fn signature_kind() -> &'static str {
    static KIND: std::sync::OnceLock<&'static str> = std::sync::OnceLock::new();
    KIND.get_or_init(|| {
        #[cfg(target_os = "macos")]
        {
            // .../zerosoft.app/Contents/MacOS/zerosoft → .../zerosoft.app
            let Some(bundle) = std::env::current_exe().ok().and_then(|p| p.parent()?.parent()?.parent().map(|b| b.to_path_buf())) else { return "unknown" };
            if bundle.extension().and_then(|e| e.to_str()) != Some("app") {
                return "unknown";
            }
            let out = std::process::Command::new("/usr/bin/codesign").args(["-d", "-r-"]).arg(&bundle).output();
            let text = out.map(|o| format!("{}{}", String::from_utf8_lossy(&o.stdout), String::from_utf8_lossy(&o.stderr))).unwrap_or_default();
            classify_requirement(&text)
        }
        #[cfg(not(target_os = "macos"))]
        "unknown"
    })
}

/// La salida de `codesign -d -r-` → "adhoc" | "stable" | "unknown".
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn classify_requirement(text: &str) -> &'static str {
    let Some(req) = text.lines().find(|l| l.contains("designated =>")) else { return "unknown" };
    if req.contains("cdhash") {
        "adhoc"
    } else if req.contains("certificate") || req.contains("anchor") {
        "stable"
    } else {
        "unknown"
    }
}

/// Nombre de la app de adelante (Mac, con lsappinfo: no pide permiso de automatización).
pub fn frontmost_app() -> String {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let asn = Command::new("lsappinfo").arg("front").output().ok().map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string()).unwrap_or_default();
        if !asn.starts_with("ASN:") || asn.len() > 40 {
            return String::new();
        }
        let out = Command::new("lsappinfo").args(["info", "-only", "name", &asn]).output().ok().map(|o| String::from_utf8_lossy(&o.stdout).to_string()).unwrap_or_default();
        // "LSDisplayName"="Slack"
        return out.split("=\"").nth(1).and_then(|r| r.split('"').next()).unwrap_or("").chars().take(100).collect();
    }
    #[cfg(not(target_os = "macos"))]
    String::new()
}

/// La tecla de la "v" para `tap_paste` (Mac; en Windows no se usa). Llamar en el hilo principal.
pub fn paste_keycode() -> u16 {
    #[cfg(target_os = "macos")]
    return mac::keycode_for_v();
    #[cfg(not(target_os = "macos"))]
    0
}

/// Cmd+V (Mac, con la tecla de `paste_keycode`) o Ctrl+V (Windows). false si el sistema no dejó.
pub fn tap_paste(keycode: u16) -> bool {
    #[cfg(target_os = "macos")]
    return mac::post_cmd_v(keycode);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = keycode;
        use enigo::{Direction, Enigo, Key, Keyboard, Settings};
        let Ok(mut e) = Enigo::new(&Settings::default()) else { return false };
        let ok = e.key(Key::Control, Direction::Press).is_ok() && e.key(Key::Unicode('v'), Direction::Click).is_ok();
        let _ = e.key(Key::Control, Direction::Release);
        ok
    }
}

/// Contexto para la limpieza según la app de adelante (como en la web).
pub fn context_for_app(name: &str) -> &'static str {
    let n = name.to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| n.split(|c: char| !c.is_alphanumeric()).any(|t| t == *w));
    if n.is_empty() {
        "other"
    } else if has(&["mail", "outlook", "gmail", "spark", "superhuman", "thunderbird", "airmail", "hey"]) {
        "email"
    } else if has(&["slack", "discord", "teams", "whatsapp", "telegram", "messages", "signal", "messenger", "zoom", "wechat", "line"]) {
        "chat"
    } else if has(&["notes", "notion", "obsidian", "bear", "word", "pages", "docs", "evernote", "craft", "logseq", "textedit", "notepad"]) {
        "note"
    } else {
        "other"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contexts() {
        assert_eq!(context_for_app("Microsoft Outlook"), "email");
        assert_eq!(context_for_app("Slack"), "chat");
        assert_eq!(context_for_app("Notion"), "note");
        assert_eq!(context_for_app("Figma"), "other");
        assert_eq!(context_for_app(""), "other");
        assert_eq!(context_for_app("Mailchimp Desktop"), "other");
    }

    #[test]
    fn tcc_services() {
        assert_eq!(tcc_service("screen"), Some("ScreenCapture"));
        assert_eq!(tcc_service("accessibility"), Some("Accessibility"));
        assert_eq!(tcc_service("all"), None);
    }

    #[test]
    fn signature_kinds() {
        assert_eq!(classify_requirement("Executable=/x\ndesignated => cdhash H\"2e1f\"\n"), "adhoc");
        assert_eq!(classify_requirement("designated => identifier \"ai.zerosoft.desktop\" and certificate leaf = H\"ab12\""), "stable");
        assert_eq!(classify_requirement("designated => anchor apple generic and identifier \"ai.zerosoft.desktop\""), "stable");
        assert_eq!(classify_requirement("code object is not signed at all"), "unknown");
    }
}
