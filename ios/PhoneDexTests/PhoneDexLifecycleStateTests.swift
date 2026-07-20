import XCTest
@testable import PhoneDex

final class PhoneDexLifecycleStateTests: XCTestCase {
    func testOnlySendingStateBlocksAnotherManagedAction() {
        XCTAssertTrue(PhoneDexAppModel.LifecycleState.sending.isInFlight)
        XCTAssertFalse(PhoneDexAppModel.LifecycleState.idle.isInFlight)
        XCTAssertFalse(PhoneDexAppModel.LifecycleState.queued("Retry queued").isInFlight)
        XCTAssertFalse(PhoneDexAppModel.LifecycleState.accepted("Accepted").isInFlight)
        XCTAssertFalse(PhoneDexAppModel.LifecycleState.failed("Failed").isInFlight)
    }
}
