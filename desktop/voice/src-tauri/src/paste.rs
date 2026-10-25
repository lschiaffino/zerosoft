//! Pegar en la app activa: el texto va al portapapeles y se simula Cmd+V
//! (macOS) o Ctrl+V (Windows/Linux). Después se devuelve lo que había en el
//! portapapeles. En macOS hace falta el permiso de Accesibilidad.

use anyhow::Result;
use enigo::{Direction, Enigo, Key, Keyboard, Settings};

pub fn paste(text: &str) -> Result<()> {
    let mut clipboard = arboard::Clipboard::new()?;
    let previous = clipboard.get_text().ok();
    clipboard.set_text(text.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(60));

    let mut enigo = Enigo::new(&Settings::default())?;
    #[cfg(target_os = "macos")]
    let modifier = Key::Meta;
    #[cfg(not(target_os = "macos"))]
    let modifier = Key::Control;
    enigo.key(modifier, Direction::Press)?;
    enigo.key(Key::Unicode('v'), Direction::Click)?;
    enigo.key(modifier, Direction::Release)?;

    // Se espera a que la app lea el portapapeles antes de restaurarlo.
    std::thread::sleep(std::time::Duration::from_millis(400));
    if let Some(prev) = previous {
        let _ = clipboard.set_text(prev);
    }
    Ok(())
}

/// Solo copiar (el último dictado, si el pegado no llegó).
pub fn copy(text: &str) -> Result<()> {
    arboard::Clipboard::new()?.set_text(text.to_string())?;
    Ok(())
}
