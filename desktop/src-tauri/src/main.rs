// Sin consola en Windows (release).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    zerosoft_desktop_lib::run()
}
