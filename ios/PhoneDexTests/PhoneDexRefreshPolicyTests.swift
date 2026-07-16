import XCTest
@testable import PhoneDex

final class PhoneDexRefreshPolicyTests: XCTestCase {
    private let policy = PhoneDexRefreshPolicy(automaticMinimumInterval: 30)
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

    func testBecomingActiveRefreshesWhenThereIsNoPriorAutomaticRefresh() {
        XCTAssertTrue(policy.shouldRefresh(
            trigger: .becameActive,
            now: baseline,
            lastAutomaticRefreshAt: nil
        ))
    }
}
