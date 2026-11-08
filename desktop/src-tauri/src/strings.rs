//! Textos del escritorio (bandeja, avisos, HUD, Ajustes) en en/es/pt: desktop/strings.json.

use serde_json::{Map, Value};
use std::sync::OnceLock;

static ALL: OnceLock<Value> = OnceLock::new();

fn all() -> &'static Value {
    ALL.get_or_init(|| serde_json::from_str(include_str!("../../strings.json")).unwrap_or(Value::Null))
}

pub fn pick_locale(system: Option<&str>) -> &'static str {
    let l = system.unwrap_or("").to_ascii_lowercase();
    if l.starts_with("es") {
        "es"
    } else if l.starts_with("pt") {
        "pt"
    } else {
        "en"
    }
}

pub fn system_locale() -> &'static str {
    pick_locale(sys_locale::get_locale().as_deref())
}

pub fn table(locale: &str) -> Map<String, Value> {
    all().get(locale).or_else(|| all().get("en")).and_then(Value::as_object).cloned().unwrap_or_default()
}

pub fn t(locale: &str, key: &str) -> String {
    all()
        .get(locale)
        .and_then(|m| m.get(key))
        .or_else(|| all().get("en").and_then(|m| m.get(key)))
        .and_then(Value::as_str)
        .unwrap_or(key)
        .to_string()
}

/// "{key}" → valor.
pub fn fill(text: &str, vars: &[(&str, &str)]) -> String {
    let mut out = text.to_string();
    for (k, v) in vars {
        out = out.replace(&format!("{{{k}}}"), v);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn locales_and_keys() {
        assert_eq!(pick_locale(Some("es-AR")), "es");
        assert_eq!(pick_locale(Some("pt_BR")), "pt");
        assert_eq!(pick_locale(Some("fr")), "en");
        assert_eq!(pick_locale(None), "en");
        for l in ["en", "es", "pt"] {
            let tab = table(l);
            assert_eq!(tab.len(), table("en").len(), "{l}");
            for k in ["errOffline", "savedToRetry", "hudHandsFreeHint", "retryPendingItem", "tabHistory", "pasteNeedsAccessibility"] {
                assert!(tab.get(k).and_then(Value::as_str).is_some_and(|v| !v.is_empty()), "{l}.{k}");
            }
        }
        assert_eq!(fill("Dictar: mantené {key}", &[("key", "Option + Space")]), "Dictar: mantené Option + Space");
    }
}
