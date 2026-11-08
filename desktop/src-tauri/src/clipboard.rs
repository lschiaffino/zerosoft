//! Pegar con el portapapeles (lógica con dependencias inyectadas, probada sin sistema):
//!
//! 1. Se guarda lo que había (texto o imagen).
//! 2. Se escribe el texto y se simula Cmd/Ctrl+V.
//! 3. Después de un rato (la app de destino lee el portapapeles al procesar la tecla) se devuelve
//!    lo guardado, solo si el portapapeles sigue teniendo nuestro texto: si la persona copió otra
//!    cosa en el medio, no se pisa.
//!
//! Sin permiso para simular la tecla (Accesibilidad en Mac), el texto queda copiado ('copied').

use std::time::Duration;

pub const SETTLE: Duration = Duration::from_millis(450);

pub trait ClipboardPort {
    type Snapshot;
    fn snapshot(&mut self) -> Option<Self::Snapshot>;
    fn is_empty(s: &Self::Snapshot) -> bool;
    fn write_text(&mut self, text: &str) -> bool;
    fn read_text(&mut self) -> Option<String>;
    fn restore(&mut self, s: Self::Snapshot) -> bool;
    fn clear(&mut self);
}

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum How {
    Pasted,
    Copied,
}

/// Pega `text`. `tap` simula la tecla (None = sin permiso). Devuelve cómo quedó y si se devolvió
/// el portapapeles. `sleep` se inyecta para los tests.
pub fn paste_via_clipboard<C: ClipboardPort>(cb: &mut C, text: &str, tap: Option<&mut dyn FnMut() -> bool>, restore: bool, sleep: &mut dyn FnMut(Duration)) -> (How, bool) {
    let Some(tap) = tap else {
        cb.write_text(text);
        return (How::Copied, false);
    };
    let saved = if restore { cb.snapshot() } else { None };
    if !cb.write_text(text) {
        return (How::Copied, false);
    }
    if !tap() {
        return (How::Copied, false);
    }
    if !restore {
        return (How::Pasted, false);
    }
    let Some(saved) = saved else { return (How::Pasted, false) };
    sleep(SETTLE);
    if cb.read_text().as_deref() != Some(text) {
        return (How::Pasted, false);
    }
    let restored = if C::is_empty(&saved) {
        cb.clear();
        true
    } else {
        cb.restore(saved)
    };
    (How::Pasted, restored)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::rc::Rc;

    /// Portapapeles de mentira: el snapshot es la lista de "formatos" que había.
    #[derive(Default)]
    struct State {
        items: Vec<String>,
        restored: u32,
        cleared: u32,
        changed_in_between: Option<String>,
        fail_read: bool,
    }

    #[derive(Clone, Default)]
    struct Fake(Rc<RefCell<State>>);

    impl ClipboardPort for Fake {
        type Snapshot = Vec<String>;
        fn snapshot(&mut self) -> Option<Vec<String>> {
            Some(self.0.borrow().items.clone())
        }
        fn is_empty(s: &Vec<String>) -> bool {
            s.is_empty()
        }
        fn write_text(&mut self, t: &str) -> bool {
            self.0.borrow_mut().items = vec![t.into()];
            true
        }
        fn read_text(&mut self) -> Option<String> {
            let mut st = self.0.borrow_mut();
            if st.fail_read {
                return None;
            }
            if let Some(c) = st.changed_in_between.take() {
                st.items = vec![c];
            }
            st.items.first().cloned()
        }
        fn restore(&mut self, s: Vec<String>) -> bool {
            let mut st = self.0.borrow_mut();
            st.items = s;
            st.restored += 1;
            true
        }
        fn clear(&mut self) {
            let mut st = self.0.borrow_mut();
            st.items.clear();
            st.cleared += 1;
        }
    }

    fn fake(items: &[&str]) -> Fake {
        Fake(Rc::new(RefCell::new(State { items: items.iter().map(|s| s.to_string()).collect(), ..Default::default() })))
    }

    /// Corre el pegado; devuelve (cómo, devuelto, lo que había en el portapapeles al apretar la tecla).
    fn run(cb: &Fake, restore: bool, can_tap: bool) -> (How, bool, Option<String>) {
        let seen = Rc::new(RefCell::new(None));
        let (cb_tap, seen_tap) = (cb.clone(), seen.clone());
        let mut tap = move || {
            *seen_tap.borrow_mut() = cb_tap.0.borrow().items.first().cloned();
            true
        };
        let mut port = cb.clone();
        let (how, restored) = paste_via_clipboard(&mut port, "dictado", if can_tap { Some(&mut tap) } else { None }, restore, &mut |_| {});
        let at_tap = seen.borrow().clone();
        (how, restored, at_tap)
    }

    fn items(cb: &Fake) -> Vec<String> {
        cb.0.borrow().items.clone()
    }

    #[test]
    fn pastes_and_restores() {
        let cb = fake(&["viejo", "<b>html</b>"]);
        let (how, restored, at_tap) = run(&cb, true, true);
        assert_eq!(how, How::Pasted);
        assert!(restored);
        // La tecla se simula con el dictado ya en el portapapeles (si no, pegaría lo viejo).
        assert_eq!(at_tap.as_deref(), Some("dictado"));
        assert_eq!(items(&cb), vec!["viejo", "<b>html</b>"]);
    }

    #[test]
    fn does_not_clobber_a_new_copy() {
        let cb = fake(&["viejo"]);
        cb.0.borrow_mut().changed_in_between = Some("copiado por la persona".into());
        let (_, restored, _) = run(&cb, true, true);
        assert!(!restored);
        assert_eq!(items(&cb), vec!["copiado por la persona"]);
        assert_eq!(cb.0.borrow().restored, 0);
    }

    #[test]
    fn empty_before_stays_empty() {
        let cb = fake(&[]);
        let (_, restored, _) = run(&cb, true, true);
        assert!(restored);
        assert_eq!(cb.0.borrow().cleared, 1);
        assert!(items(&cb).is_empty());
    }

    #[test]
    fn no_restore_leaves_dictation() {
        let cb = fake(&["viejo"]);
        assert_eq!(run(&cb, false, true).0, How::Pasted);
        assert_eq!(items(&cb), vec!["dictado"]);
    }

    #[test]
    fn without_permission_only_copies() {
        let cb = fake(&["viejo"]);
        let (how, restored, _) = run(&cb, true, false);
        assert_eq!((how, restored), (How::Copied, false));
        assert_eq!(items(&cb), vec!["dictado"]);
    }

    #[test]
    fn read_failure_does_not_restore() {
        let cb = fake(&["viejo"]);
        cb.0.borrow_mut().fail_read = true;
        assert!(!run(&cb, true, true).1);
    }
}
