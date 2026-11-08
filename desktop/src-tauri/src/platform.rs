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

    pub fn microphone() -> PermissionStatus {
        // AVAuthorizationStatus: 0 sin decidir, 1 restringido, 2 denegado, 3 permitido.
        let media = NSString::from_str("soun");
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
pub const PANE_ACCESSIBILITY: &str = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

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

/// Cmd+V (Mac) o Ctrl+V (Windows). false si el sistema no dejó.
pub fn tap_paste() -> bool {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    let Ok(mut e) = Enigo::new(&Settings::default()) else { return false };
    let modifier = if cfg!(target_os = "macos") { Key::Meta } else { Key::Control };
    let ok = e.key(modifier, Direction::Press).is_ok() && e.key(Key::Unicode('v'), Direction::Click).is_ok();
    let _ = e.key(modifier, Direction::Release);
    ok
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
}
