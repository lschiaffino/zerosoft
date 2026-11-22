import AppKit
import AVFoundation

/// Camera permission (AVCaptureDevice video, the same TCC entry WebKit's getUserMedia uses for the
/// app). macOS asks only on first use (a page's camera, Rec's bubble) or from Settings ›
/// Permissions' "Turn on the camera"; never at launch.
@MainActor
protocol CameraPermission: AnyObject {
    func current() -> PermissionAccess
    /// Shows the system prompt (only while it is not determined) and returns the answer.
    func request() async -> PermissionAccess
    func openSystemSettings()
}

@MainActor
final class SystemCameraPermission: CameraPermission {
    func current() -> PermissionAccess {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: return .allowed
        case .denied, .restricted: return .denied
        case .notDetermined: return .notDetermined
        @unknown default: return .notDetermined
        }
    }

    func request() async -> PermissionAccess {
        if current() == .notDetermined {
            _ = await AVCaptureDevice.requestAccess(for: .video)
        }
        return current()
    }

    func openSystemSettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Camera") {
            NSWorkspace.shared.open(url)
        }
    }
}

/// The live picture of Rec's camera bubble (section 4.2: `AVCaptureVideoPreviewLayer`). Nothing
/// is recorded or kept: the capture session has the camera as input and only the preview layer
/// as output, so frames go to the screen and nowhere else. The page's screen recording then
/// records the bubble where the person left it.
@MainActor
protocol CameraPreview: AnyObject {
    /// What the bubble shows.
    var layer: CALayer { get }
    var isRunning: Bool { get }
    /// Opens the camera named `label` (the one the page used; device ids differ between the page
    /// and the app) or the default one. False when there is no camera or it cannot open.
    func start(label: String) -> Bool
    /// Releases the camera (its light goes off).
    func stop()
    /// The camera stopped by itself while running (an error, another app took it).
    var onFailure: () -> Void { get set }
}

/// AVCaptureSession is not Sendable; it is only touched on its own queue after configuration.
/// The preview layer is configured on the session queue with its connection (AVFoundation
/// allows that); nothing else touches it there.
private final class PreviewBox: @unchecked Sendable {
    let layer: AVCaptureVideoPreviewLayer
    init(_ layer: AVCaptureVideoPreviewLayer) { self.layer = layer }
}

/// The new input, handed to the session queue once.
private final class InputBox: @unchecked Sendable {
    let input: AVCaptureDeviceInput
    init(_ input: AVCaptureDeviceInput) { self.input = input }
}

/// A weak reference the session queue can carry back to the main thread.
private final class WeakPreview: @unchecked Sendable {
    weak var value: SystemCameraPreview?
    init(_ value: SystemCameraPreview) { self.value = value }
}

private final class SessionBox: @unchecked Sendable {
    let session = AVCaptureSession()
    let queue = DispatchQueue(label: "ai.zerosoft.mac.camera")
}

/// Every change to the session (inputs, start, stop) runs on its own serial queue, so a quick
/// hide and show never touches it from two threads or leaves it without its input.
@MainActor
final class SystemCameraPreview: CameraPreview {
    private let box = SessionBox()
    private let preview: AVCaptureVideoPreviewLayer
    private(set) var isRunning = false
    var onFailure: () -> Void = {}
    private var observers: [NSObjectProtocol] = []

    init() {
        preview = AVCaptureVideoPreviewLayer(session: box.session)
        preview.videoGravity = .resizeAspectFill
        let center = NotificationCenter.default
        for name in [Notification.Name.AVCaptureSessionRuntimeError, .AVCaptureSessionWasInterrupted] {
            observers.append(center.addObserver(forName: name, object: box.session, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated {
                    guard let self, self.isRunning else { return }
                    self.stop()
                    self.onFailure()
                }
            })
        }
    }

    var layer: CALayer { preview }

    private static func cameras() -> [AVCaptureDevice] {
        let types: [AVCaptureDevice.DeviceType]
        if #available(macOS 14.0, *) {
            types = [.builtInWideAngleCamera, .external]
        } else {
            types = [.builtInWideAngleCamera, .externalUnknown]
        }
        return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: .video, position: .unspecified).devices
    }

    func start(label: String) -> Bool {
        if isRunning { return true }
        let devices = Self.cameras()
        let named = label.isEmpty ? nil : devices.first { $0.localizedName == label }
        guard let device = named ?? AVCaptureDevice.default(for: .video) ?? devices.first,
              let input = try? AVCaptureDeviceInput(device: device) else { return false }
        isRunning = true
        let box = self.box
        let preview = PreviewBox(preview)
        let me = WeakPreview(self)
        let given = InputBox(input)
        // Configuration and startRunning (which blocks until the camera is on) on the session's
        // queue, after any stop queued before.
        box.queue.async {
            let session = box.session
            session.beginConfiguration()
            let input = given.input
            for old in session.inputs { session.removeInput(old) }
            guard session.canAddInput(input) else {
                session.commitConfiguration()
                DispatchQueue.main.async { MainActor.assumeIsolated { me.value?.failedToStart() } }
                return
            }
            session.addInput(input)
            if session.canSetSessionPreset(.vga640x480) { session.sessionPreset = .vga640x480 }
            session.commitConfiguration()
            // A mirror, as people expect to see themselves (rec bubble of the Tauri app).
            if let connection = preview.layer.connection, connection.isVideoMirroringSupported {
                connection.automaticallyAdjustsVideoMirroring = false
                connection.isVideoMirrored = true
            }
            session.startRunning()
        }
        return true
    }

    private func failedToStart() {
        guard isRunning else { return }
        isRunning = false
        onFailure()
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        let box = self.box
        box.queue.async {
            box.session.stopRunning()
            for input in box.session.inputs { box.session.removeInput(input) }
        }
    }
}

#if DEBUG
/// UI tests only: the camera permission without the system. `-ZSCamera allowed` starts allowed,
/// `denied` denied; anything else is not determined and the first request allows it. It records
/// how often the app asked.
@MainActor
final class FakeCameraPermission: CameraPermission {
    private(set) var access: PermissionAccess
    private(set) var asked = 0
    var onChange: (() -> Void)?

    init(_ access: PermissionAccess) {
        self.access = access
    }

    func current() -> PermissionAccess { access }

    func request() async -> PermissionAccess {
        asked += 1
        if access == .notDetermined { access = .allowed }
        onChange?()
        return access
    }

    func openSystemSettings() {}

    var summary: String { "asked=\(asked) camera=\(access.rawValue)" }
}

/// UI tests only: a gray picture instead of the camera (CI has none). `-ZSCameraMissing YES`
/// makes it fail to open, as a Mac without a camera.
@MainActor
final class FakeCameraPreview: CameraPreview {
    let layer = CALayer()
    private let works: Bool
    private(set) var isRunning = false
    private(set) var opens = 0
    var onChange: (() -> Void)?
    var onFailure: () -> Void = {}

    init(works: Bool) {
        self.works = works
        layer.backgroundColor = NSColor.systemGray.cgColor
    }

    func start(label: String) -> Bool {
        guard works else { return false }
        if !isRunning { opens += 1 }
        isRunning = true
        onChange?()
        return true
    }

    func stop() {
        guard isRunning else { return }
        isRunning = false
        onChange?()
    }

    var summary: String { "camera \(isRunning ? "on" : "off") opens=\(opens)" }
}
#endif
