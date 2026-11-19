// swift-tools-version:5.9
// ZerosoftCore: the app's logic without AppKit (navigation policy, server URL, load watchdog,
// strings). `swift test` runs its tests here and in CI; the app target compiles the same sources
// (project.yml), so there is one copy of each rule. Plan: docs/desktop-swift.md, section 4.1.
import PackageDescription

let package = Package(
    name: "ZerosoftCore",
    platforms: [.macOS(.v13)],
    products: [.library(name: "ZerosoftCore", targets: ["ZerosoftCore"])],
    targets: [
        .target(name: "ZerosoftCore"),
        .testTarget(name: "ZerosoftCoreTests", dependencies: ["ZerosoftCore"]),
    ]
)
