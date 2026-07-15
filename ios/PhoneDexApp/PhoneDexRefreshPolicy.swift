import Foundation

/// Controls automatic foreground refreshes without delaying user-requested refreshes.
struct PhoneDexRefreshPolicy: Equatable {
    enum Trigger: Equatable {
        case initialLaunch
        case becameActive
    }

    static let `default` = PhoneDexRefreshPolicy(automaticMinimumInterval: 30)

    let automaticMinimumInterval: TimeInterval

    func shouldRefresh(
        trigger: Trigger,
        now: Date,
        lastAutomaticRefreshAt: Date?
    ) -> Bool {
        if trigger == .initialLaunch { return true }
        guard let lastAutomaticRefreshAt else { return true }
        return now.timeIntervalSince(lastAutomaticRefreshAt) >= automaticMinimumInterval
    }
}
