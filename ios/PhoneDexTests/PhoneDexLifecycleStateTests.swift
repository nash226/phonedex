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

    func testLifecycleReceiptKeepsActionIdentityAndUsesSafeStateLabels() {
        let receipt = PhoneDexReplyReceipt(
            schema: "phonedex.command-receipt.v1",
            protocolVersion: 1,
            commandId: "command-1",
            createdAt: "2026-07-20T12:00:00Z",
            state: "completed",
            taskId: "task-1",
            taskVersion: 4,
            idempotencyKey: "key-1",
            message: "Delivered to Studio Mac",
            duplicateOf: nil,
            approvalId: nil,
            approvalState: nil,
            approvalExpiresAt: nil
        )
        let record = PhoneDexLifecycleDeliveryRecord(receipt: receipt, kind: "cancel", taskId: "task-1")

        XCTAssertEqual(record.id, "command-1")
        XCTAssertEqual(record.actionLabel, "Cancellation")
        XCTAssertEqual(record.displayState, "Delivered to agent")
        XCTAssertTrue(record.isSuccessful)
        XCTAssertEqual(record.message, "Delivered to Studio Mac")
    }

    func testLifecycleReceiptOnlyMatchesCurrentTaskVersion() {
        let receipt = PhoneDexLifecycleDeliveryRecord(
            receipt: PhoneDexReplyReceipt(
                schema: "phonedex.command-receipt.v1",
                protocolVersion: 1,
                commandId: "command-2",
                createdAt: "2026-07-20T12:00:00Z",
                state: "completed",
                taskId: "task-2",
                taskVersion: 4,
                idempotencyKey: "key-2",
                message: nil,
                duplicateOf: nil,
                approvalId: nil,
                approvalState: nil,
                approvalExpiresAt: nil
            ),
            kind: "retry",
            taskId: "task-2"
        )

        XCTAssertTrue(receipt.matchesCurrentTaskVersion(4))
        XCTAssertFalse(receipt.matchesCurrentTaskVersion(5))
        XCTAssertFalse(receipt.matchesCurrentTaskVersion(nil))
    }
}
