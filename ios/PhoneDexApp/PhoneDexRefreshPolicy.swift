import Foundation

enum PhoneDexRefreshCopy {
    static let header = String(localized: "refresh.policy.header", defaultValue: "Refresh behavior", comment: "Settings section explaining automatic and manual PhoneDex refresh behavior.")
    static let summary = String(localized: "refresh.policy.summary", defaultValue: "PhoneDex refreshes when you open the app or return to it. Pull to refresh and Test Connection always run immediately.", comment: "Short explanation of foreground-only refresh behavior and immediate manual refresh.")
    static let lowPower = String(localized: "refresh.policy.lowPower", defaultValue: "Low Power Mode spaces out automatic refreshes to protect battery.", comment: "Settings explanation for Low Power Mode refresh behavior.")
    static let thermal = String(localized: "refresh.policy.thermal", defaultValue: "When iPhone is warm, automatic refreshes back off temporarily. Your cached conversations remain available.", comment: "Settings explanation for thermal refresh backoff and local-first cached data.")
}

/// Controls automatic foreground refreshes without delaying user-requested refreshes.
struct PhoneDexRefreshPolicy: Equatable {
    enum ThermalState: Equatable {
        case nominal
        case fair
        case serious
        case critical

        var refreshMultiplier: Double {
            switch self {
            case .nominal, .fair: return 1
            case .serious: return 2
            case .critical: return 4
            }
        }
    }

    enum Trigger: Equatable {
        case initialLaunch
        case becameActive
    }

    static let `default` = PhoneDexRefreshPolicy(
        automaticMinimumInterval: 30,
        automaticMaximumInterval: 5 * 60,
        lowPowerModeMaximumInterval: 15 * 60,
        jitterFraction: 0.2
    )

    let automaticMinimumInterval: TimeInterval
    let automaticMaximumInterval: TimeInterval
    let lowPowerModeMaximumInterval: TimeInterval
    let jitterFraction: Double

    init(
        automaticMinimumInterval: TimeInterval,
        automaticMaximumInterval: TimeInterval? = nil,
        lowPowerModeMaximumInterval: TimeInterval? = nil,
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
        self.jitterFraction = min(max(0, jitterFraction), 1)
    }

    func shouldRefresh(
        trigger: Trigger,
        now: Date,
        lastAutomaticRefreshAt: Date?,
        consecutiveFailures: Int = 0,
        jitter: Double = 0,
        lowPowerModeEnabled: Bool = false,
        thermalState: ThermalState = .nominal
    ) -> Bool {
        if trigger == .initialLaunch { return true }
        guard let lastAutomaticRefreshAt else { return true }
        return now.timeIntervalSince(lastAutomaticRefreshAt) >= automaticDelay(
            consecutiveFailures: consecutiveFailures,
            jitter: jitter,
            lowPowerModeEnabled: lowPowerModeEnabled,
            thermalState: thermalState
        )
    }

    func automaticDelay(
        consecutiveFailures: Int,
        jitter: Double = 0,
        lowPowerModeEnabled: Bool = false,
        thermalState: ThermalState = .nominal
    ) -> TimeInterval {
        let exponent = min(max(0, consecutiveFailures), 8)
        let exponentialDelay = automaticMinimumInterval * pow(2, Double(exponent))
        let maximumInterval = lowPowerModeEnabled
            ? lowPowerModeMaximumInterval
            : automaticMaximumInterval
        let boundedDelay = min(maximumInterval, exponentialDelay)
        let thermalDelay = min(
            lowPowerModeMaximumInterval * 2,
            boundedDelay * thermalState.refreshMultiplier
        )
        let boundedJitter = consecutiveFailures > 0
            ? min(max(-1, jitter), 1) * jitterFraction
            : 0
        return thermalDelay * (1 + boundedJitter)
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
