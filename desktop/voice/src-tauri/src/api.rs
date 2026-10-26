//! Cliente de la API v1 de zerosoft para Voice (key con scopes voice:read y voice:write).

use anyhow::{anyhow, Result};
use reqwest::blocking::{multipart, Client};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::config::Config;

fn client() -> Client {
    Client::builder().timeout(std::time::Duration::from_secs(120)).build().expect("http client")
}

fn base(cfg: &Config) -> String {
    cfg.server.trim_end_matches('/').to_string()
}

fn check(res: reqwest::blocking::Response) -> Result<Value> {
    let status = res.status();
    let body: Value = res.json().unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body);
    }
    let msg = body["error"]["message"].as_str().unwrap_or("request failed").to_string();
    Err(anyhow!("{} ({})", msg, status.as_u16()))
}

#[derive(Debug, Deserialize)]
pub struct Dictation {
    pub text: String,
}

/// POST /api/v1/voice/dictate: audio WAV → texto limpio.
pub fn dictate(cfg: &Config, wav: Vec<u8>, duration_ms: u64, source_app: &str) -> Result<Dictation> {
    let form = multipart::Form::new()
        .part("audio", multipart::Part::bytes(wav).file_name("dictation.wav").mime_str("audio/wav")?)
        .text("context", cfg.context.clone())
        .text("sourceApp", source_app.to_string())
        .text("durationMs", duration_ms.to_string());
    let res = client()
        .post(format!("{}/voice/dictate", base(cfg)))
        .bearer_auth(&cfg.api_key)
        .multipart(form)
        .send()?;
    let body = check(res)?;
    Ok(Dictation { text: body["data"]["text"].as_str().unwrap_or_default().to_string() })
}

/// POST /api/v1/voice/sessions: reunión nueva.
pub fn create_meeting(cfg: &Config, title: &str) -> Result<String> {
    let res = client()
        .post(format!("{}/voice/sessions", base(cfg)))
        .bearer_auth(&cfg.api_key)
        .json(&json!({ "title": title }))
        .send()?;
    let body = check(res)?;
    body["data"]["id"].as_str().map(str::to_string).ok_or_else(|| anyhow!("missing id"))
}

/// POST /api/v1/voice/sessions/:id/chunks: un trozo de audio ("me" o "them").
pub fn upload_chunk(cfg: &Config, session: &str, source: &str, seq: u64, offset_ms: u64, duration_ms: u64, wav: Vec<u8>) -> Result<()> {
    let form = multipart::Form::new()
        .part("audio", multipart::Part::bytes(wav).file_name("chunk.wav").mime_str("audio/wav")?)
        .text("source", source.to_string())
        .text("seq", seq.to_string())
        .text("offsetMs", offset_ms.to_string())
        .text("durationMs", duration_ms.to_string());
    let res = client()
        .post(format!("{}/voice/sessions/{}/chunks", base(cfg), session))
        .bearer_auth(&cfg.api_key)
        .multipart(form)
        .send()?;
    check(res).map(|_| ())
}

/// PATCH /api/v1/voice/sessions/:id { status: "done" }.
pub fn finish_meeting(cfg: &Config, session: &str) -> Result<()> {
    let res = client()
        .patch(format!("{}/voice/sessions/{}", base(cfg), session))
        .bearer_auth(&cfg.api_key)
        .json(&json!({ "status": "done" }))
        .send()?;
    check(res).map(|_| ())
}

/// GET /api/v1/voice/dictionary: prueba la key (y trae diccionario y ajustes).
pub fn ping(cfg: &Config) -> Result<()> {
    let res = client().get(format!("{}/voice/dictionary", base(cfg))).bearer_auth(&cfg.api_key).send()?;
    check(res).map(|_| ())
}
