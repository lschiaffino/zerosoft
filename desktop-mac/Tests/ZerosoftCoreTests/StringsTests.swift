import Foundation
import Testing
@testable import ZerosoftCore

@Test func everyKeyInEveryLanguage() {
    for lang in Lang.allCases {
        for key in StringKey.allCases {
            let s = Strings.table[lang]?[key]
            #expect(s != nil && !(s!.isEmpty), "\(lang) \(key)")
            // House style (AGENTS.md): no em dashes.
            #expect(!(s ?? "").contains("\u{2014}"), "\(lang) \(key)")
        }
    }
}

@Test func placeholdersMatchAcrossLanguages() {
    let re = try! NSRegularExpression(pattern: "\\{[a-z]+\\}")
    func vars(_ s: String) -> Set<String> {
        Set(re.matches(in: s, range: NSRange(s.startIndex..., in: s)).map { String(s[Range($0.range, in: s)!]) })
    }
    for key in StringKey.allCases {
        let en = vars(Strings.table[.en]![key]!)
        for lang in Lang.allCases { #expect(vars(Strings.table[lang]![key]!) == en, "\(lang) \(key)") }
    }
}

@Test func pickLanguage() {
    #expect(Lang.pick(["es-AR", "en-US"]) == .es)
    #expect(Lang.pick(["pt-BR"]) == .pt)
    #expect(Lang.pick(["fr-FR", "pt_PT"]) == .pt)
    #expect(Lang.pick(["de"]) == .en)
    #expect(Lang.pick([]) == .en)
}

@Test func messages() {
    #expect(Strings.message(for: .unreachable, .es, server: "http://127.0.0.1:4100") == "No se pudo llegar a 127.0.0.1. Revisá la dirección o probá de nuevo en un momento.")
    #expect(Strings.message(for: .server(status: 503), .en, server: "https://zerosoft.ai") == "The server answered with an error (503).")
    #expect(Strings.text(.reasonCode, .pt, ["code": "blank"]) == "Motivo: blank")
    #expect(Strings.text(.retry, .es) == "Reintentar")
}
