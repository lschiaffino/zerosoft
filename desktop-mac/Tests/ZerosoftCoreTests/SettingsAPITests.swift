import Foundation
import Testing
@testable import ZerosoftCore

private let server = "https://zerosoft.ai"
private func data(_ s: String) -> Data { Data(s.utf8) }

// MARK: Endpoints

@Test func endpointList() {
    #expect(SettingsEndpoint.all.map(\.fact) == [
        "GET /api/desktop/badge", "GET /api/voice/settings", "PATCH /api/voice/settings",
        "GET /api/voice/dictionary", "POST /api/voice/dictionary", "DELETE /api/voice/dictionary/{id}",
        "GET /api/voice/sessions", "GET /api/auth/csrf", "POST /api/auth/signout",
    ])
    #expect(SettingsEndpoint.history.path == "/api/voice/sessions?kind=dictation&limit=50")
    #expect(SettingsEndpoint.deleteDictionaryEntry("ab_c-1").path == "/api/voice/dictionary/ab_c-1")
}

/// Every request of the Settings window is listed in desktop/privacy-facts.json (the facts the
/// public privacy page shows), so a new endpoint cannot ship without saying so there.
@Test func endpointsAreInThePrivacyFacts() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
    let facts = try Data(contentsOf: root.appendingPathComponent("desktop/privacy-facts.json"))
    let json = try #require(try JSONSerialization.jsonObject(with: facts) as? [String: Any])
    let network = try #require(json["network"] as? [[String: Any]])
    let listed = Set(network.flatMap { ($0["endpoints"] as? [String]) ?? [] })
    for endpoint in SettingsEndpoint.all { #expect(listed.contains(endpoint.fact), "\(endpoint.fact)") }
}

@Test func requestsStayOnTheServer() throws {
    let get = try #require(SettingsEndpoint.dictionary.request(server: server))
    #expect(get.url?.absoluteString == "https://zerosoft.ai/api/voice/dictionary")
    #expect(get.httpMethod == "GET")
    #expect(get.value(forHTTPHeaderField: "Origin") == nil)
    let patch = try #require(SettingsEndpoint.saveVoiceSettings.request(server: server, body: data("{}")))
    #expect(patch.httpMethod == "PATCH")
    #expect(patch.value(forHTTPHeaderField: "Origin") == server)
    #expect(patch.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let form = try #require(SettingsEndpoint.signOut.request(server: server, body: data("a=b"), form: true))
    #expect(form.value(forHTTPHeaderField: "Content-Type") == "application/x-www-form-urlencoded")
    // An id that is not a plain id never becomes a path.
    for bad in ["", "../x", "a/b", "a?b", "a b", "%2e", String(repeating: "a", count: 65), "é"] {
        #expect(SettingsEndpoint.deleteDictionaryEntry(bad).request(server: server) == nil, "\(bad)")
    }
    #expect(SettingsEndpoint.history.request(server: "http://127.0.0.1:4100")?.url?.host == "127.0.0.1")
}

@Test func remoteStates() {
    let parse: (Data) -> Int? = { _ in 1 }
    #expect(Remote.from(status: nil, body: nil, parse) == .offline)
    #expect(Remote.from(status: 401, body: data("{}"), parse) == .signedOut)
    #expect(Remote.from(status: 500, body: data("{}"), parse) == .failed)
    #expect(Remote.from(status: 200, body: nil, parse) == .failed)
    #expect(Remote.from(status: 200, body: data("{}"), { _ in nil as Int? }) == .failed)
    #expect(Remote.from(status: 201, body: data("{}"), parse) == .ok(1))
}

// MARK: Account

@Test func accountFromTheBadge() {
    let ok = AccountInfo.parse(data(#"{"total":1,"user":{"email":"ana@example.com","name":"Ana"}}"#))
    #expect(ok == AccountInfo(email: "ana@example.com", name: "Ana"))
    #expect(AccountInfo.parse(data(#"{"total":1}"#)) == nil)
    #expect(AccountInfo.parse(data(#"{"user":{"email":""}}"#)) == nil)
    #expect(AccountInfo.parse(data(#"{"user":{"email":"a@b.c","name":3}}"#))?.name == "")
}

// MARK: Voice settings

@Test func voiceSettingsParseAndPatch() throws {
    let v = try #require(VoiceSettings.parse(data(#"{"settings":{"language":"es","cleanupMode":"formal","cleanupDepth":"light","aiCleanup":false,"styles":{}}}"#)))
    #expect(v == VoiceSettings(language: "es", cleanupMode: .formal, cleanupDepth: .light, aiCleanup: false))
    // Unknown values keep the defaults.
    let odd = try #require(VoiceSettings.parse(data(#"{"settings":{"language":"spanish","cleanupMode":"loud","aiCleanup":1}}"#)))
    #expect(odd == VoiceSettings())
    #expect(VoiceSettings.parse(data(#"{"nope":{}}"#)) == nil)

    var changed = v
    changed.cleanupMode = .perApp
    let body = try #require(changed.patch(from: v))
    #expect(String(decoding: body, as: UTF8.self) == #"{"cleanupMode":"per_app"}"#)
    #expect(v.patch(from: v) == nil)
    var bad = v
    bad.language = "../"
    #expect(bad.patch(from: v) == nil)
    #expect(VoiceSettings.validLanguage("auto") && VoiceSettings.validLanguage("fr"))
    #expect(!VoiceSettings.validLanguage("EN") && !VoiceSettings.validLanguage("eng"))
}

// MARK: Dictionary

@Test func dictionaryParse() throws {
    let list = try #require(DictionaryEntry.parseList(data("""
    {"entries":[
      {"id":"e1","kind":"word","phrase":"zerosoft","replacement":""},
      {"id":"e2","kind":"replace","phrase":"zero soft","replacement":"zerosoft","shared":true},
      {"id":"bad id","kind":"word","phrase":"x"},
      {"id":"e3","kind":"emoji","phrase":"x"},
      {"id":"e4","kind":"word","phrase":""},
      "junk"
    ],"canEditTeam":false}
    """)))
    #expect(list.map(\.id) == ["e1", "e2"])
    #expect(list[1].shared && !list[0].shared)
    #expect(list[1].replacement == "zerosoft")
    #expect(DictionaryEntry.parseList(data(#"{"entries":"x"}"#)) == nil)
    let member = try #require(DictionaryList.parse(data(#"{"entries":[{"id":"t1","kind":"word","phrase":"x","shared":true},{"id":"o1","kind":"word","phrase":"y"}],"canEditTeam":false}"#)))
    #expect(!member.canDelete(member.entries[0]) && member.canDelete(member.entries[1]))
    let admin = try #require(DictionaryList.parse(data(#"{"entries":[{"id":"t1","kind":"word","phrase":"x","shared":true}],"canEditTeam":true}"#)))
    #expect(admin.canDelete(admin.entries[0]))
}

@Test func dictionaryAddBody() throws {
    let word = try #require(DictionaryEntry.addBody(kind: .word, phrase: "  zerosoft ", replacement: "ignored"))
    #expect(String(decoding: word, as: UTF8.self) == #"{"kind":"word","phrase":"zerosoft"}"#)
    let rep = try #require(DictionaryEntry.addBody(kind: .replace, phrase: "zero soft", replacement: "zerosoft"))
    #expect(String(decoding: rep, as: UTF8.self) == #"{"kind":"replace","phrase":"zero soft","replacement":"zerosoft"}"#)
    #expect(DictionaryEntry.addBody(kind: .word, phrase: "   ", replacement: "") == nil)
    #expect(DictionaryEntry.addBody(kind: .snippet, phrase: "sig", replacement: "  ") == nil)
    let long = try #require(DictionaryEntry.addBody(kind: .word, phrase: String(repeating: "a", count: 300), replacement: ""))
    let parsed = try #require(try JSONSerialization.jsonObject(with: long) as? [String: String])
    #expect(parsed["phrase"]?.count == DictionaryEntry.maxPhrase)
    #expect(DictionaryEntry.parseAdded(data(#"{"id":"new_1"}"#)) == "new_1")
    #expect(DictionaryEntry.parseAdded(data(#"{"id":"../x"}"#)) == nil)
}

// MARK: History

@Test func historyParse() throws {
    let list = try #require(HistoryItem.parseList(data("""
    {"sessions":[
      {"id":"s1","kind":"dictation","text":"hello there","durationMs":2500,"startedAt":"2026-11-22T10:00:00.000Z"},
      {"id":"s2","kind":"dictation","text":"","durationMs":10},
      {"id":"s3","text":"no date","durationMs":-5,"startedAt":"yesterday"}
    ]}
    """)))
    #expect(list.map(\.id) == ["s1", "s3"])
    #expect(list[0].durationMs == 2500 && list[0].startedAt != nil)
    #expect(list[1].durationMs == 0 && list[1].startedAt == nil)
    let many = "{\"sessions\":[" + (0 ..< 80).map { "{\"id\":\"s\($0)\",\"text\":\"t\"}" }.joined(separator: ",") + "]}"
    #expect(HistoryItem.parseList(data(many))?.count == SettingsEndpoint.historyLimit)
}

// MARK: Sign-out

@Test func signOutForm() {
    #expect(SignOut.csrfToken(data(#"{"csrfToken":"abc123"}"#)) == "abc123")
    #expect(SignOut.csrfToken(data(#"{"csrfToken":""}"#)) == nil)
    #expect(SignOut.csrfToken(data("{\"csrfToken\":\"" + String(repeating: "a", count: 201) + "\"}")) == nil)
    #expect(SignOut.csrfToken(data(#"{"csrfToken":"a\nb"}"#)) == nil)
    #expect(String(decoding: SignOut.form(token: "a+b/c=d"), as: UTF8.self) == "csrfToken=a%2Bb%2Fc%3Dd&json=true")
}
