import Foundation

/// Controls automatic foreground refreshes without delaying user-requested refreshes.
struct PhoneDexRefreshPolicy: Equatable {
    enum Trigger: Equatable {
        case initialLaunch
        case becameActive
    }

    static let `default` = PhoneDexRefreshPolicy(
        automaticMinimumInterval: 30,
        automaticMaximumInterval: 5 * 60,
        jitterFraction: 0.2
    )

    let automaticMinimumInterval: TimeInterval
    let automaticMaximumInterval: TimeInterval
    let jitterFraction: Double

    init(
        automaticMinimumInterval: TimeInterval,
        automaticMaximumInterval: TimeInterval? = nil,
        jitterFraction: Double = 0
    ) {
        self.automaticMinimumInterval = max(0, automaticMinimumInterval)
        self.automaticMaximumInterval = max(
            self.automaticMinimumInterval,
            automaticMaximumInterval ?? automaticMinimumInterval
        )
        self.jitterFraction = min(max(0, jitterFraction), 1)
    }

    func shouldRefresh(
        trigger: Trigger,
        now: Date,
        lastAutomaticRefreshAt: Date?,
        consecutiveFailures: Int = 0,
        jitter: Double = 0
    ) -> Bool {
        if trigger == .initialLaunch { return true }
        guard let lastAutomaticRefreshAt else { return true }
        return now.timeIntervalSince(lastAutomaticRefreshAt) >= automaticDelay(
            consecutiveFailures: consecutiveFailures,
            jitter: jitter
        )
    }

    func automaticDelay(consecutiveFailures: Int, jitter: Double = 0) -> TimeInterval {
        let exponent = min(max(0, consecutiveFailures), 8)
        let exponentialDelay = automaticMinimumInterval * pow(2, Double(exponent))
        let boundedDelay = min(automaticMaximumInterval, exponentialDelay)
        let boundedJitter = consecutiveFailures > 0
            ? min(max(-1, jitter), 1) * jitterFraction
            : 0
        return boundedDelay * (1 + boundedJitter)
    }
}
