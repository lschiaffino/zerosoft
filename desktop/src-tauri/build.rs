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
];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("tauri build");
}
