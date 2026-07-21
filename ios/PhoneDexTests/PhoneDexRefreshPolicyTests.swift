import XCTest
@testable import PhoneDex

final class PhoneDexRefreshPolicyTests: XCTestCase {
    private let policy = PhoneDexRefreshPolicy(
        automaticMinimumInterval: 30,
        automaticMaximumInterval: 120,
        lowPowerModeMaximumInterval: 300,
        jitterFraction: 0.2
    )
    private let baseline = Date(timeIntervalSince1970: 1_000)

    func testInitialLaunchAlwaysRefreshes() {
        XCTAssertTrue(policy.shouldRefresh(
            trigger: .initialLaunch,
            now: baseline,
            lastAutomaticRefreshAt: baseline.addingTimeInterval(1)
        ))
    }

    func testBecomingActiveSkipsRecentAutomaticRefresh() {
        XCTAssertFalse(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline.addingTimeInterval(29.9),
            lastAutomaticRefreshAt: baseline
        ))
    }

    func testBecomingActiveRefreshesAtTheMinimumInterval() {
        XCTAssertTrue(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline.addingTimeInterval(30),
            lastAutomaticRefreshAt: baseline
        ))
    }

    func testFailuresBackOffAutomaticallyButRespectMaximum() {
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 0), 30)
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 1), 60)
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 2), 120)
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 8), 120)
    }

    func testJitterIsBoundedAndAppliedToTheBackoffWindow() {
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 0, jitter: -1), 30)
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 1, jitter: -1), 48)
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 1, jitter: 1), 72)
        XCTAssertEqual(policy.automaticDelay(consecutiveFailures: 1, jitter: 4), 72)
    }

    func testLowPowerModeUsesLongerAutomaticRefreshCeiling() {
        XCTAssertEqual(
            policy.automaticDelay(consecutiveFailures: 4, lowPowerModeEnabled: true),
            300
        )
        XCTAssertEqual(
            policy.automaticDelay(consecutiveFailures: 4, lowPowerModeEnabled: false),
            120
        )
    }

    func testLowPowerModeStillHonorsFailureBackoffAndJitter() {
        XCTAssertEqual(
            policy.automaticDelay(
                consecutiveFailures: 1,
                jitter: -1,
                lowPowerModeEnabled: true
            ),
            48
        )
        XCTAssertFalse(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline.addingTimeInterval(299.9),
            lastAutomaticRefreshAt: baseline,
            consecutiveFailures: 4,
            lowPowerModeEnabled: true
        ))
        XCTAssertTrue(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline.addingTimeInterval(300),
            lastAutomaticRefreshAt: baseline,
            consecutiveFailures: 4,
            lowPowerModeEnabled: true
        ))
    }

    func testFailureBackoffDelaysForegroundRefresh() {
        XCTAssertFalse(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline.addingTimeInterval(59.9),
            lastAutomaticRefreshAt: baseline,
            consecutiveFailures: 1
        ))
        XCTAssertTrue(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline.addingTimeInterval(60),
            lastAutomaticRefreshAt: baseline,
            consecutiveFailures: 1
        ))
    }

    func testBecomingActiveRefreshesWhenThereIsNoPriorAutomaticRefresh() {
        XCTAssertTrue(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline,
            lastAutomaticRefreshAt: nil
        ))
    }

    func testOverlappingRefreshesOnlyAcceptTheNewestResponse() {
        var coordinator = PhoneDexRefreshCoordinator()

        let olderRequest = coordinator.begin()
        let newerRequest = coordinator.begin()

        XCTAssertFalse(coordinator.accepts(olderRequest))
        XCTAssertTrue(coordinator.accepts(newerRequest))
        XCTAssertTrue(coordinator.shouldCancel(olderRequest))
        XCTAssertFalse(coordinator.shouldCancel(newerRequest))
    }

    func testRefreshCoordinatorRejectsUnknownRequestIDs() {
        var coordinator = PhoneDexRefreshCoordinator()
        _ = coordinator.begin()

        XCTAssertFalse(coordinator.accepts(0))
        XCTAssertFalse(coordinator.accepts(99))
    }
}
