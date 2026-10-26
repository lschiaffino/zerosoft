// Sin consola en Windows en release.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zerosoft_voice_lib::run();
}
