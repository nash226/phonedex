import Foundation
import Combine

/// Keeps a content-free marker for an app launch that has not reached its first
/// rendered view. This gives the next launch a bounded recovery signal without
/// persisting task text, credentials, or local paths.
@MainActor
final class PhoneDexLaunchRecovery: ObservableObject {
    @Published private(set) var wasInterrupted = false

    private let defaults: UserDefaults
    private let clock: () -> Date

    init(defaults: UserDefaults = .standard, clock: @escaping () -> Date = Date.init) {
        self.defaults = defaults
        self.clock = clock
    }

    func beginLaunch() {
        wasInterrupted = defaults.object(forKey: Keys.startedAt) != nil
        defaults.set(clock().timeIntervalSince1970, forKey: Keys.startedAt)
    }

    func markFirstViewRendered() {
        defaults.removeObject(forKey: Keys.startedAt)
        defaults.set(clock().timeIntervalSince1970, forKey: Keys.completedAt)
    }

    func dismissRecoveryNotice() {
        wasInterrupted = false
    }

    private enum Keys {
        static let startedAt = "phonedex.launch.startedAt"
        static let completedAt = "phonedex.launch.completedAt"
    }
}
