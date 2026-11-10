// Comandos propios con permisos generados (allow-<comando>): la página remota de zerosoft solo
// recibe los del puente (capabilities/remote.json y la capability que se suma en runtime para un
// servidor propio); Ajustes y el HUD (archivos locales) reciben los suyos (capabilities/local.json).
const COMMANDS: &[&str] = &[
    // Puente de la página remota.
    "desktop_info",
    "desktop_start_login",
    "desktop_open_settings",
    "desktop_notify",
    "desktop_recording",
    "desktop_tabs",
    "desktop_system_audio_start",
    "desktop_system_audio_read",
    "desktop_system_audio_stop",
    // Tira de pestañas (archivo local en cada ventana, tabs.rs).
    "tabs_ready",
    "tabs_action",
    // Indicador de grabación (ventana local).
    "indicator_state",
    "indicator_action",
    // Ajustes (ventana local).
    "settings_get",
    "settings_save",
    "permission_ask",
    "voice_get",
    "voice_save",
    "dictionary_list",
    "dictionary_add",
    "dictionary_delete",
    "history_list",
    "history_copy",
    "history_paste",
    "pending_retry",
    "pending_discard",
    "account_sign_in",
    "account_sign_out",
    "open_voice",
    "tabs_prefs_get",
    "tabs_prefs_save",
    "settings_nav",
    "settings_open_web",
    "update_check",
    "update_restart",
];

/// ScreenCaptureKit (system_audio.rs) trae un puente en Swift: el binario final necesita saber dónde
/// están las librerías de Swift (el rpath de la dependencia no llega al enlace de esta crate).
fn link_swift() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    let dev = std::process::Command::new("xcode-select").arg("-p").output().ok().and_then(|o| String::from_utf8(o.stdout).ok()).map(|s| s.trim().to_string()).unwrap_or_default();
    if dev.is_empty() {
        return;
    }
    let base = format!("{dev}/Toolchains/XcodeDefault.xctoolchain/usr/lib");
    for dir in ["swift/macosx", "swift-5.5/macosx"] {
        println!("cargo:rustc-link-search=native={base}/{dir}");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,{base}/swift/macosx");
}

fn main() {
    link_swift();
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build");
}
