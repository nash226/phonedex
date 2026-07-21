import Foundation
import Network

@MainActor
final class PhoneDexNetworkConstraintMonitor: ObservableObject {
    @Published private(set) var isConstrained = false

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.nash226.PhoneDex.network-constraint")

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                self?.isConstrained = path.isConstrained
            }
        }
        monitor.start(queue: queue)
    }

    deinit {
        monitor.cancel()
    }
}

/// Controls automatic foreground refreshes without delaying user-requested refreshes.
struct PhoneDexRefreshPolicy: Equatable {
    enum Trigger: Equatable {
        case initialLaunch
        case becameActive
    }

    static let `default` = PhoneDexRefreshPolicy(
        automaticMinimumInterval: 30,
        automaticMaximumInterval: 5 * 60,
        lowPowerModeMaximumInterval: 15 * 60,
        lowDataModeMaximumInterval: 10 * 60,
        jitterFraction: 0.2
    )

    let automaticMinimumInterval: TimeInterval
    let automaticMaximumInterval: TimeInterval
    let lowPowerModeMaximumInterval: TimeInterval
    let lowDataModeMaximumInterval: TimeInterval
    let jitterFraction: Double

    init(
        automaticMinimumInterval: TimeInterval,
        automaticMaximumInterval: TimeInterval? = nil,
        lowPowerModeMaximumInterval: TimeInterval? = nil,
        lowDataModeMaximumInterval: TimeInterval? = nil,
        jitterFraction: Double = 0
    ) {
        self.automaticMinimumInterval = max(0, automaticMinimumInterval)
        self.automaticMaximumInterval = max(
            self.automaticMinimumInterval,
            automaticMaximumInterval ?? automaticMinimumInterval
        )
        self.lowPowerModeMaximumInterval = max(
            self.automaticMaximumInterval,
            lowPowerModeMaximumInterval ?? self.automaticMaximumInterval
        )
        self.lowDataModeMaximumInterval = max(
            self.automaticMaximumInterval,
            lowDataModeMaximumInterval ?? self.automaticMaximumInterval
        )
        self.jitterFraction = min(max(0, jitterFraction), 1)
    }

    func shouldRefresh(
        trigger: Trigger,
        now: Date,
        lastAutomaticRefreshAt: Date?,
        consecutiveFailures: Int = 0,
        jitter: Double = 0,
        lowPowerModeEnabled: Bool = false,
        lowDataModeEnabled: Bool = false
    ) -> Bool {
        if trigger == .initialLaunch { return true }
        guard let lastAutomaticRefreshAt else { return true }
        return now.timeIntervalSince(lastAutomaticRefreshAt) >= automaticDelay(
            consecutiveFailures: consecutiveFailures,
            jitter: jitter,
            lowPowerModeEnabled: lowPowerModeEnabled,
            lowDataModeEnabled: lowDataModeEnabled
        )
    }

    func automaticDelay(
        consecutiveFailures: Int,
        jitter: Double = 0,
        lowPowerModeEnabled: Bool = false,
        lowDataModeEnabled: Bool = false
    ) -> TimeInterval {
        let exponent = min(max(0, consecutiveFailures), 8)
        let exponentialDelay = automaticMinimumInterval * pow(2, Double(exponent))
        let maximumInterval = [
            automaticMaximumInterval,
            lowPowerModeEnabled ? lowPowerModeMaximumInterval : 0,
            lowDataModeEnabled ? lowDataModeMaximumInterval : 0
        ].max() ?? automaticMaximumInterval
        let boundedDelay = min(maximumInterval, exponentialDelay)
        let boundedJitter = consecutiveFailures > 0
            ? min(max(-1, jitter), 1) * jitterFraction
            : 0
        return boundedDelay * (1 + boundedJitter)
    }
}

/// Identifies the most recent refresh so an older response cannot replace a
/// newer trusted projection when foreground refreshes overlap.
struct PhoneDexRefreshCoordinator: Equatable {
    private(set) var latestRequestID = 0

    mutating func begin() -> Int {
        latestRequestID += 1
        return latestRequestID
    }

    func accepts(_ requestID: Int) -> Bool {
        requestID == latestRequestID
    }

    /// A superseded refresh should be cancelled so its network work and
    /// pagination can stop, not merely ignored after producing a response.
    func shouldCancel(_ requestID: Int) -> Bool {
        !accepts(requestID)
    }
}
