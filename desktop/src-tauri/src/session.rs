//! Ventanas y pestañas (modelo puro, sin Tauri): qué ventanas hay, qué pestañas tiene cada una,
//! cuál está adelante, las cerradas para volver a abrir (⌘⇧T) y las preferencias. Se guarda en
//! <config>/session.json para restaurar al abrir. tabs.rs lo conecta con las ventanas reales.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

/// Topes: una sesión rota o enorme no traba el arranque.
pub const MAX_WINDOWS: usize = 12;
pub const MAX_TABS: usize = 40;
const MAX_CLOSED: usize = 25;
const MAX_PATH: usize = 1000;
const MAX_TITLE: usize = 200;
pub const MAIN: &str = "main";
pub const HOME: &str = "/app";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: u64,
    pub path: String,
    #[serde(default)]
    pub title: String,
    /// Tiene webview (las suspendidas y las restauradas que no se miraron, no).
    #[serde(skip)]
    pub loaded: bool,
    /// ms de la última vez que dejó de estar adelante (o que se miró).
    #[serde(skip)]
    pub last_active: u64,
    #[serde(skip)]
    pub recording: bool,
    #[serde(skip)]
    pub unread: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Win {
    pub label: String,
    pub tabs: Vec<Tab>,
    /// id de la pestaña adelante.
    pub active: u64,
    #[serde(default)]
    pub bounds: Option<Bounds>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Prefs {
    /// Suspender pestañas que no se miran hace un rato (liberan memoria; vuelven al tocarlas).
    pub suspend: bool,
    pub suspend_minutes: u32,
    /// Al abrir, las ventanas y pestañas de la última vez.
    pub restore: bool,
    /// ⌘-clic en un link: "tab" (pestaña nueva) o "window" (ventana nueva).
    pub links: String,
}

impl Default for Prefs {
    fn default() -> Self {
        Prefs { suspend: true, suspend_minutes: 30, restore: true, links: "tab".into() }
    }
}

pub const SUSPEND_MINUTES: [u32; 5] = [5, 15, 30, 60, 240];

#[derive(Debug, Clone, PartialEq)]
pub struct Closed {
    pub path: String,
    pub title: String,
    pub window: String,
    pub index: usize,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Session {
    pub windows: Vec<Win>,
    pub closed: Vec<Closed>,
    pub prefs: Prefs,
    next_id: u64,
    next_win: u64,
}

/// Dónde abrir algo nuevo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    /// Al final, adelante (⌘T).
    End,
    /// Al lado de la actual, adelante (⌘⇧-clic, target=_blank).
    Next,
    /// Al lado de la actual, atrás (⌘-clic, clic del medio).
    Background,
}

/// Path de la app que puede ir en una pestaña: absoluto, sin otro origen, sin control.
pub fn valid_path(p: &str) -> bool {
    p.starts_with('/') && !p.starts_with("//") && p.len() <= MAX_PATH && !p.contains('\\') && !p.chars().any(|c| c.is_control() || c == ' ')
}

/// Segmento de producto de un path (/app/track/... → "track"; con idioma /es/app/... también).
pub fn product_of(path: &str) -> &str {
    let clean = path.split(['?', '#']).next().unwrap_or("");
    let mut it = clean.split('/').filter(|s| !s.is_empty());
    let mut first = it.next().unwrap_or("");
    if matches!(first, "en" | "es" | "pt") {
        first = it.next().unwrap_or("");
    }
    if first != "app" {
        return "";
    }
    it.next().unwrap_or("")
}

fn clip(s: &str, n: usize) -> String {
    s.chars().filter(|c| !c.is_control()).take(n).collect()
}

impl Session {
    pub fn new(prefs: Prefs) -> Self {
        Session { prefs, next_id: 1, next_win: 1, ..Default::default() }
    }

    fn id(&mut self) -> u64 {
        let id = self.next_id.max(1);
        self.next_id = id + 1;
        id
    }

    fn tab(&mut self, path: &str) -> Tab {
        let path = if valid_path(path) { path.to_string() } else { HOME.to_string() };
        Tab { id: self.id(), path, title: String::new(), loaded: false, last_active: 0, recording: false, unread: false }
    }

    pub fn win(&self, label: &str) -> Option<&Win> {
        self.windows.iter().find(|w| w.label == label)
    }

    fn win_mut(&mut self, label: &str) -> Option<&mut Win> {
        self.windows.iter_mut().find(|w| w.label == label)
    }

    /// (índice de ventana, índice de pestaña).
    pub fn find(&self, id: u64) -> Option<(usize, usize)> {
        self.windows.iter().enumerate().find_map(|(wi, w)| w.tabs.iter().position(|t| t.id == id).map(|ti| (wi, ti)))
    }

    pub fn get(&self, id: u64) -> Option<&Tab> {
        self.find(id).map(|(wi, ti)| &self.windows[wi].tabs[ti])
    }

    pub fn get_mut(&mut self, id: u64) -> Option<&mut Tab> {
        let (wi, ti) = self.find(id)?;
        Some(&mut self.windows[wi].tabs[ti])
    }

    pub fn window_of(&self, id: u64) -> Option<&str> {
        self.find(id).map(|(wi, _)| self.windows[wi].label.as_str())
    }

    pub fn active_of(&self, label: &str) -> Option<u64> {
        self.win(label).map(|w| w.active)
    }

    /// Ventana nueva con una pestaña. La primera se llama "main" (la que esconde el cerrar).
    pub fn new_window(&mut self, path: &str, bounds: Option<Bounds>) -> Option<(String, u64)> {
        if self.windows.len() >= MAX_WINDOWS {
            return None;
        }
        let label = if self.win(MAIN).is_none() {
            MAIN.to_string()
        } else {
            loop {
                let l = format!("w{}", self.next_win.max(1));
                self.next_win = self.next_win.max(1) + 1;
                if self.win(&l).is_none() {
                    break l;
                }
            }
        };
        let tab = self.tab(path);
        let id = tab.id;
        self.windows.push(Win { label: label.clone(), tabs: vec![tab], active: id, bounds });
        Some((label, id))
    }

    /// Pestaña nueva en una ventana. Devuelve su id (None si la ventana no existe o está llena).
    pub fn add_tab(&mut self, label: &str, path: &str, place: Place) -> Option<u64> {
        let tab = self.tab(path);
        let id = tab.id;
        let w = self.win_mut(label)?;
        if w.tabs.len() >= MAX_TABS {
            return None;
        }
        let cur = w.tabs.iter().position(|t| t.id == w.active).unwrap_or(w.tabs.len().saturating_sub(1));
        let at = match place {
            Place::End => w.tabs.len(),
            Place::Next | Place::Background => (cur + 1).min(w.tabs.len()),
        };
        w.tabs.insert(at, tab);
        if place != Place::Background {
            w.active = id;
        }
        Some(id)
    }

    /// Pone adelante una pestaña. Devuelve la que estaba adelante antes (si cambió).
    pub fn activate(&mut self, id: u64, now: u64) -> Option<u64> {
        let (wi, ti) = self.find(id)?;
        let w = &mut self.windows[wi];
        let prev = w.active;
        w.active = id;
        w.tabs[ti].last_active = now;
        w.tabs[ti].unread = false;
        if prev != id {
            if let Some(p) = w.tabs.iter_mut().find(|t| t.id == prev) {
                p.last_active = now;
            }
            Some(prev)
        } else {
            None
        }
    }

    /// ⌘1…⌘8 la n-ésima, ⌘9 la última.
    pub fn nth(&self, label: &str, n: usize) -> Option<u64> {
        let w = self.win(label)?;
        if n == 0 || w.tabs.is_empty() {
            return None;
        }
        if n >= 9 {
            return w.tabs.last().map(|t| t.id);
        }
        w.tabs.get(n - 1).map(|t| t.id)
    }

    /// ⌃Tab (+1) y ⌃⇧Tab (-1), dando la vuelta.
    pub fn cycle(&self, label: &str, delta: i64) -> Option<u64> {
        let w = self.win(label)?;
        let n = w.tabs.len() as i64;
        if n < 2 {
            return None;
        }
        let cur = w.tabs.iter().position(|t| t.id == w.active).unwrap_or(0) as i64;
        Some(w.tabs[((cur + delta) % n + n) as usize % n as usize].id)
    }

    /// Cierra una pestaña. Devuelve (ventana, nueva adelante si cambió, ventana vacía).
    pub fn close_tab(&mut self, id: u64) -> Option<(String, Option<u64>, bool)> {
        let (wi, ti) = self.find(id)?;
        let w = &mut self.windows[wi];
        let tab = w.tabs.remove(ti);
        let label = w.label.clone();
        let mut next = None;
        if w.active == id && !w.tabs.is_empty() {
            // Como los navegadores: la de la derecha, o la de la izquierda si era la última.
            let n = w.tabs[ti.min(w.tabs.len() - 1)].id;
            w.active = n;
            next = Some(n);
        }
        let empty = w.tabs.is_empty();
        self.remember(tab, &label, ti);
        Some((label, next, empty))
    }

    fn remember(&mut self, tab: Tab, window: &str, index: usize) {
        self.closed.push(Closed { path: tab.path, title: tab.title, window: window.to_string(), index });
        if self.closed.len() > MAX_CLOSED {
            self.closed.remove(0);
        }
    }

    /// Saca una ventana (cerrada con su botón): sus pestañas quedan para ⌘⇧T.
    pub fn remove_window(&mut self, label: &str) -> Option<Win> {
        let i = self.windows.iter().position(|w| w.label == label)?;
        let w = self.windows.remove(i);
        for (ti, t) in w.tabs.iter().enumerate() {
            self.remember(t.clone(), label, ti);
        }
        Some(w)
    }

    /// ⌘⇧T: la última cerrada vuelve a su ventana y lugar (o a `fallback` si su ventana ya no está).
    pub fn reopen(&mut self, fallback: &str) -> Option<(String, u64)> {
        let c = self.closed.pop()?;
        let label = if self.win(&c.window).is_some() { c.window.clone() } else { fallback.to_string() };
        let mut tab = self.tab(&c.path);
        tab.title = c.title;
        let id = tab.id;
        let w = match self.win_mut(&label) {
            Some(w) if w.tabs.len() < MAX_TABS => w,
            _ => {
                self.closed.push(Closed { path: tab.path, title: tab.title, window: c.window, index: c.index });
                return None;
            }
        };
        let at = c.index.min(w.tabs.len());
        w.tabs.insert(at, tab);
        w.active = id;
        Some((label, id))
    }

    /// Mueve una pestaña a otra ventana (o a otro lugar en la misma). Devuelve la nueva adelante de
    /// la ventana de origen si la que se fue estaba adelante, y si quedó vacía.
    pub fn move_tab(&mut self, id: u64, to: &str, index: usize) -> Option<(String, Option<u64>, bool)> {
        let (wi, ti) = self.find(id)?;
        let from = self.windows[wi].label.clone();
        if from != to && self.win(to).map(|w| w.tabs.len() >= MAX_TABS).unwrap_or(true) {
            return None;
        }
        let w = &mut self.windows[wi];
        let tab = w.tabs.remove(ti);
        let mut next = None;
        if from != to && w.active == id && !w.tabs.is_empty() {
            let n = w.tabs[ti.min(w.tabs.len() - 1)].id;
            w.active = n;
            next = Some(n);
        }
        let empty = w.tabs.is_empty();
        let dest = self.win_mut(to)?;
        let at = index.min(dest.tabs.len());
        dest.tabs.insert(at, tab);
        dest.active = id;
        let empty = empty && from != to;
        Some((from, next, empty))
    }

    /// Ventana nueva para una pestaña que ya existe (arrastrarla afuera, "Mover a ventana nueva").
    pub fn detach(&mut self, id: u64, bounds: Option<Bounds>) -> Option<(String, String, Option<u64>)> {
        let (wi, _) = self.find(id)?;
        if self.windows[wi].tabs.len() < 2 || self.windows.len() >= MAX_WINDOWS {
            return None;
        }
        let from = self.windows[wi].label.clone();
        let (label, placeholder) = self.new_window(HOME, bounds)?;
        let (_, next, _) = self.move_tab(id, &label, 0)?;
        // La pestaña provisoria de la ventana nueva se va (no cuenta como cerrada).
        if let Some(w) = self.win_mut(&label) {
            w.tabs.retain(|t| t.id != placeholder);
            w.active = id;
        }
        Some((from, label, next))
    }

    /// Pestañas para suspender: con webview, atrás, sin grabar, quietas hace más de `minutes`.
    pub fn discardable(&self, now: u64) -> Vec<u64> {
        if !self.prefs.suspend {
            return vec![];
        }
        let limit = self.prefs.suspend_minutes.max(1) as u64 * 60_000;
        self.windows
            .iter()
            .flat_map(|w| w.tabs.iter().filter(move |t| t.id != w.active))
            .filter(|t| t.loaded && !t.recording && t.last_active > 0 && now.saturating_sub(t.last_active) >= limit)
            .map(|t| t.id)
            .collect()
    }

    pub fn set_title(&mut self, id: u64, title: &str) -> bool {
        let title = clip(title.trim(), MAX_TITLE);
        match self.get_mut(id) {
            Some(t) if t.title != title => {
                t.title = title;
                true
            }
            _ => false,
        }
    }

    pub fn set_path(&mut self, id: u64, path: &str) -> bool {
        if !valid_path(path) {
            return false;
        }
        match self.get_mut(id) {
            Some(t) if t.path != path => {
                t.path = path.to_string();
                true
            }
            _ => false,
        }
    }

    /// Puntos de "hay algo nuevo" por producto (los que no están adelante). Devuelve si cambió algo.
    pub fn set_unread(&mut self, products: &[String], focused: Option<&str>) -> bool {
        let mut changed = false;
        for w in &mut self.windows {
            let front = focused == Some(w.label.as_str());
            for t in &mut w.tabs {
                let p = product_of(&t.path);
                let on = !p.is_empty() && products.iter().any(|x| x == p) && !(front && t.id == w.active);
                if t.unread != on {
                    t.unread = on;
                    changed = true;
                }
            }
        }
        changed
    }

    pub fn to_json(&self) -> Value {
        serde_json::json!({ "version": 1, "windows": self.windows, "prefs": self.prefs })
    }

    /// session.json (o lo que sea) → sesión válida. Sin `restore`, solo las preferencias.
    pub fn from_json(raw: &Value) -> Session {
        let prefs = parse_prefs(raw.get("prefs").unwrap_or(&Value::Null), &Prefs::default());
        let mut s = Session::new(prefs);
        if !s.prefs.restore {
            return s;
        }
        let wins: Vec<Win> = raw.get("windows").cloned().and_then(|v| serde_json::from_value(v).ok()).unwrap_or_default();
        for w in wins.into_iter().take(MAX_WINDOWS) {
            let tabs: Vec<(String, String, bool)> = w
                .tabs
                .iter()
                .filter(|t| valid_path(&t.path))
                .take(MAX_TABS)
                .map(|t| (t.path.clone(), clip(&t.title, MAX_TITLE), t.id == w.active))
                .collect();
            if tabs.is_empty() {
                continue;
            }
            let bounds = w.bounds.filter(|b| b.w >= 300.0 && b.h >= 300.0 && b.w < 20_000.0 && b.h < 20_000.0 && b.x.abs() < 50_000.0 && b.y.abs() < 50_000.0);
            let Some((label, first)) = s.new_window(&tabs[0].0, bounds) else { break };
            if let Some(t) = s.get_mut(first) {
                t.title = tabs[0].1.clone();
            }
            let mut active = first;
            for (path, title, is_active) in tabs.iter().skip(1) {
                if let Some(id) = s.add_tab(&label, path, Place::End) {
                    if let Some(t) = s.get_mut(id) {
                        t.title = title.clone();
                    }
                    if *is_active {
                        active = id;
                    }
                }
            }
            if let Some(w) = s.win_mut(&label) {
                w.active = active;
            }
        }
        s
    }
}

/// Preferencias desde JSON: solo pisa lo válido.
pub fn parse_prefs(raw: &Value, base: &Prefs) -> Prefs {
    let mut p = base.clone();
    if let Some(b) = raw.get("suspend").and_then(Value::as_bool) {
        p.suspend = b;
    }
    if let Some(m) = raw.get("suspendMinutes").and_then(Value::as_u64) {
        if SUSPEND_MINUTES.contains(&(m as u32)) {
            p.suspend_minutes = m as u32;
        }
    }
    if let Some(b) = raw.get("restore").and_then(Value::as_bool) {
        p.restore = b;
    }
    if let Some(l) = raw.get("links").and_then(Value::as_str) {
        if l == "tab" || l == "window" {
            p.links = l.to_string();
        }
    }
    p
}

pub fn load(dir: &Path) -> Session {
    let raw = std::fs::read_to_string(dir.join("session.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()).unwrap_or(Value::Null);
    Session::from_json(&raw)
}

pub fn save(dir: &Path, s: &Session) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join("session.json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(&s.to_json()).unwrap_or_default())?;
    std::fs::rename(tmp, dir.join("session.json"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn one() -> (Session, u64) {
        let mut s = Session::new(Prefs::default());
        let (l, id) = s.new_window("/app/track", None).unwrap();
        assert_eq!(l, MAIN);
        (s, id)
    }

    #[test]
    fn paths_and_products() {
        assert!(valid_path("/app/track/issue/ZS-1?view=x#c"));
        for bad in ["", "app", "//evil.com/app", "/app\\x", "/app/\n", "/app/a b"] {
            assert!(!valid_path(bad), "{bad:?}");
        }
        assert_eq!(product_of("/app/track/issue/1"), "track");
        assert_eq!(product_of("/es/app/crm?x=1"), "crm");
        assert_eq!(product_of("/app"), "");
        assert_eq!(product_of("/pricing"), "");
    }

    #[test]
    fn open_and_place() {
        let (mut s, a) = one();
        let b = s.add_tab(MAIN, "/app/crm", Place::End).unwrap();
        assert_eq!(s.active_of(MAIN), Some(b));
        s.activate(a, 1);
        // ⌘-clic: al lado de la actual y atrás.
        let c = s.add_tab(MAIN, "/app/docs", Place::Background).unwrap();
        let ids: Vec<u64> = s.win(MAIN).unwrap().tabs.iter().map(|t| t.id).collect();
        assert_eq!(ids, vec![a, c, b]);
        assert_eq!(s.active_of(MAIN), Some(a));
        let d = s.add_tab(MAIN, "/app/talk", Place::Next).unwrap();
        assert_eq!(s.win(MAIN).unwrap().tabs[1].id, d);
        assert_eq!(s.active_of(MAIN), Some(d));
        // Path inválido → inicio.
        let e = s.add_tab(MAIN, "https://evil.com", Place::End).unwrap();
        assert_eq!(s.get(e).unwrap().path, HOME);
    }

    #[test]
    fn select_and_cycle() {
        let (mut s, a) = one();
        let b = s.add_tab(MAIN, "/app/crm", Place::End).unwrap();
        let c = s.add_tab(MAIN, "/app/docs", Place::End).unwrap();
        assert_eq!(s.nth(MAIN, 1), Some(a));
        assert_eq!(s.nth(MAIN, 2), Some(b));
        assert_eq!(s.nth(MAIN, 9), Some(c));
        assert_eq!(s.nth(MAIN, 5), None);
        assert_eq!(s.cycle(MAIN, 1), Some(a)); // c → a, da la vuelta
        assert_eq!(s.cycle(MAIN, -1), Some(b));
    }

    #[test]
    fn close_and_reopen() {
        let (mut s, a) = one();
        let b = s.add_tab(MAIN, "/app/crm", Place::End).unwrap();
        let c = s.add_tab(MAIN, "/app/docs", Place::End).unwrap();
        s.activate(b, 1);
        let (w, next, empty) = s.close_tab(b).unwrap();
        assert_eq!((w.as_str(), next, empty), (MAIN, Some(c), false));
        // La de la derecha; si era la última, la de la izquierda.
        let (_, next, _) = s.close_tab(c).unwrap();
        assert_eq!(next, Some(a));
        let (_, id) = s.reopen(MAIN).unwrap();
        assert_eq!(s.get(id).unwrap().path, "/app/docs");
        let (_, id2) = s.reopen(MAIN).unwrap();
        let tabs: Vec<&str> = s.win(MAIN).unwrap().tabs.iter().map(|t| t.path.as_str()).collect();
        assert_eq!(tabs, vec!["/app/track", "/app/crm", "/app/docs"]);
        assert_eq!(s.active_of(MAIN), Some(id2));
        assert!(s.reopen(MAIN).is_none());
        let (_, _, empty) = s.close_tab(a).unwrap();
        assert!(!empty);
    }

    #[test]
    fn windows_move_and_detach() {
        let (mut s, a) = one();
        let b = s.add_tab(MAIN, "/app/crm", Place::End).unwrap();
        // Una sola pestaña no se separa (ya es su ventana).
        let (l2, x) = s.new_window("/app/talk", None).unwrap();
        assert_eq!(l2, "w1");
        assert!(s.detach(x, None).is_none());
        let (from, l3, next) = s.detach(b, None).unwrap();
        assert_eq!((from.as_str(), next), (MAIN, Some(a)));
        assert_eq!(s.win(&l3).unwrap().tabs.len(), 1);
        assert_eq!(s.window_of(b), Some(l3.as_str()));
        // Mover de vuelta: la ventana de origen queda vacía.
        let (from, _, empty) = s.move_tab(b, MAIN, 0).unwrap();
        assert_eq!(from, l3);
        assert!(empty);
        assert_eq!(s.win(MAIN).unwrap().tabs[0].id, b);
        // Reordenar en la misma ventana.
        s.move_tab(b, MAIN, 5).unwrap();
        assert_eq!(s.win(MAIN).unwrap().tabs.last().unwrap().id, b);
        // Cerrar una ventana deja sus pestañas para ⌘⇧T, en otra ventana si la suya ya no está.
        s.remove_window(&l2).unwrap();
        let (l, _) = s.reopen(MAIN).unwrap();
        assert_eq!(l, MAIN);
    }

    #[test]
    fn caps() {
        let (mut s, _) = one();
        for _ in 1..MAX_TABS {
            s.add_tab(MAIN, "/app", Place::End).unwrap();
        }
        assert!(s.add_tab(MAIN, "/app", Place::End).is_none());
        for _ in 1..MAX_WINDOWS {
            s.new_window("/app", None).unwrap();
        }
        assert!(s.new_window("/app", None).is_none());
    }

    #[test]
    fn suspend_candidates() {
        let (mut s, a) = one();
        let b = s.add_tab(MAIN, "/app/crm", Place::End).unwrap();
        let c = s.add_tab(MAIN, "/app/talk", Place::End).unwrap();
        for id in [a, b, c] {
            s.get_mut(id).unwrap().loaded = true;
        }
        s.activate(a, 1_000);
        s.activate(c, 2_000);
        s.get_mut(c).unwrap().last_active = 2_000;
        s.get_mut(b).unwrap().last_active = 1_000;
        let min = 60_000 * 30;
        // La de adelante nunca; la que graba tampoco.
        assert_eq!(s.discardable(1_500 + min), vec![b]);
        assert_eq!(s.discardable(2_000 + min), vec![a, b]);
        s.get_mut(a).unwrap().recording = true;
        assert_eq!(s.discardable(2_000 + min), vec![b]);
        s.prefs.suspend = false;
        s.get_mut(a).unwrap().recording = false;
        assert!(s.discardable(10 * min).is_empty());
    }

    #[test]
    fn unread_dots() {
        let (mut s, a) = one();
        let b = s.add_tab(MAIN, "/app/talk/c/1", Place::End).unwrap();
        s.activate(a, 1);
        assert!(s.set_unread(&["talk".into()], Some(MAIN)));
        assert!(s.get(b).unwrap().unread && !s.get(a).unwrap().unread);
        // Adelante en la ventana con foco: sin punto.
        s.activate(b, 2);
        s.set_unread(&["talk".into()], Some(MAIN));
        assert!(!s.get(b).unwrap().unread);
        assert!(!s.set_unread(&["talk".into()], Some(MAIN)));
    }

    #[test]
    fn persist_roundtrip_and_sanitize() {
        let (mut s, _) = one();
        let b = s.add_tab(MAIN, "/app/crm/deals", Place::End).unwrap();
        s.set_title(b, "Deals · CRM · zerosoft");
        let (l2, _) = s.new_window("/app/talk", Some(Bounds { x: 10.0, y: 20.0, w: 900.0, h: 700.0 })).unwrap();
        s.add_tab(&l2, "/app/docs", Place::Background).unwrap();
        let back = Session::from_json(&s.to_json());
        assert_eq!(back.windows.len(), 2);
        assert_eq!(back.win(MAIN).unwrap().tabs.len(), 2);
        let active = back.active_of(MAIN).unwrap();
        assert_eq!(back.get(active).unwrap().path, "/app/crm/deals");
        assert_eq!(back.get(active).unwrap().title, "Deals · CRM · zerosoft");
        assert_eq!(back.win(&l2).unwrap().bounds.unwrap().w, 900.0);
        // Nada se carga solo: la de adelante la carga tabs.rs al crear la ventana.
        assert!(back.windows.iter().flat_map(|w| &w.tabs).all(|t| !t.loaded));
        // Basura, paths malos, ventanas vacías y tamaños absurdos.
        let raw = json!({ "windows": [
            { "label": "x", "active": 9, "tabs": [{ "id": 9, "path": "//evil.com" }] },
            { "label": "y", "active": 1, "bounds": { "x": 0, "y": 0, "w": 5, "h": 5 }, "tabs": [{ "id": 1, "path": "/app/crm" }, { "id": 2, "path": "javascript:x" }] },
            "nope"
        ], "prefs": { "suspendMinutes": 7, "links": "popup", "suspend": false } });
        let s2 = Session::from_json(&raw);
        assert!(s2.windows.is_empty() || s2.windows.len() == 1);
        let s3 = Session::from_json(&json!({ "windows": [{ "label": "y", "active": 1, "bounds": { "x": 0, "y": 0, "w": 5, "h": 5 }, "tabs": [{ "id": 1, "path": "/app/crm" }, { "id": 2, "path": "javascript:x" }] }] }));
        assert_eq!(s3.windows.len(), 1);
        assert_eq!(s3.windows[0].label, MAIN);
        assert_eq!(s3.windows[0].tabs.len(), 1);
        assert!(s3.windows[0].bounds.is_none());
        assert_eq!(s2.prefs, Prefs { suspend: false, ..Prefs::default() });
        // Sin restaurar: solo las preferencias.
        let s4 = Session::from_json(&json!({ "windows": s.to_json()["windows"], "prefs": { "restore": false } }));
        assert!(s4.windows.is_empty() && !s4.prefs.restore);
        assert!(Session::from_json(&Value::Null).windows.is_empty());
    }
}
