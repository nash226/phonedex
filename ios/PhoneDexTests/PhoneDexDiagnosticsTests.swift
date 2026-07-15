import XCTest
@testable import PhoneDex

final class PhoneDexDiagnosticsTests: XCTestCase {
    func testDeviceHealthMapsProtocolStatesAndUnknownValues() {
        XCTAssertEqual(PhoneDexDeviceHealth(status: "online"), .online)
        XCTAssertEqual(PhoneDexDeviceHealth(status: "stale"), .stale)
        XCTAssertEqual(PhoneDexDeviceHealth(status: "missing"), .missing)
        XCTAssertEqual(PhoneDexDeviceHealth(status: "revoked"), .revoked)
        XCTAssertEqual(PhoneDexDeviceHealth(status: "future_state"), .unknown)
        XCTAssertEqual(PhoneDexDeviceHealth(status: nil), .unknown)
    }

    func testDeviceDiagnosticExplainsRecoveryForRevokedDevice() {
        let device = makeDevice(status: "revoked")

        XCTAssertEqual(device.health, .revoked)
        XCTAssertEqual(device.diagnostic.title, "Access has been revoked")
        XCTAssertTrue(device.diagnostic.nextStep.localizedCaseInsensitiveContains("re-pair"))
    }

    func testProjectDetailsSummarizeActiveAndAttentionWork() {
        let project = PhoneDexProject(tasks: [
            makeTask(id: "running", status: "running", at: "2026-07-15T12:00:00.000Z"),
            makeTask(id: "question", status: "needs_input", at: "2026-07-15T12:01:00.000Z"),
            makeTask(id: "done", status: "completed", at: "2026-07-15T12:02:00.000Z")
        ])

        XCTAssertEqual(project.activeTaskCount, 1)
        XCTAssertEqual(project.attentionTaskCount, 1)
        XCTAssertEqual(project.latestTask?.id, "done")
    }

    func testConnectionStateTreatsStaleCacheAsBlockingEmptyContent() {
        let state = PhoneDexAppModel.ConnectionState.stale(Date(timeIntervalSince1970: 0))

        XCTAssertTrue(state.blocksEmptyContent)
        XCTAssertFalse(state.isInitialLoading)
    }

    func testDeviceDiagnosticsKeepReachabilitySeparateFromComponentHealth() {
        let device = makeDevice(status: "online")

        XCTAssertEqual(device.reachabilityHealth, .online)
        XCTAssertEqual(device.agentHealth, .degraded)
        XCTAssertEqual(device.adapterHealth, .unknown)
        XCTAssertTrue(device.adapterHealth.isActionable)
    }

    func testDeviceCapabilitiesExplainAvailableAndUnavailableActions() {
        let device = PhoneDexDevice(
            deviceId: "windows",
            machineName: "Windows Workstation",
            platform: "windows",
            role: "agent",
            status: "online",
            lastSeenAt: "2026-07-15T12:00:00Z",
            version: "0.1.0",
            publicUrl: nil,
            expected: true,
            capabilityDetails: [
                PhoneDexCapability(capabilityId: "task.reply", version: "1", scope: "task", supported: true),
                PhoneDexCapability(capabilityId: "task.cancel", version: "1", scope: "task", supported: false)
            ]
        )

        XCTAssertEqual(device.capabilityDetails.map(\.identity), ["task.reply.v1", "task.cancel.v1"])
        XCTAssertEqual(device.capabilityDetails.map(\.displayName), ["Task Reply", "Task Cancel"])
        XCTAssertFalse(device.capabilityDetails[0].isActionable)
        XCTAssertTrue(device.capabilityDetails[1].isActionable)
    }

    private func makeDevice(status: String) -> PhoneDexDevice {
        PhoneDexDevice(
            deviceId: "macbook",
            machineName: "MacBook",
            platform: "darwin",
            role: "agent",
            status: status,
            lastSeenAt: "2026-07-15T12:00:00Z",
            version: "1.0.0",
            publicUrl: nil,
            expected: true,
            componentHealth: PhoneDexDeviceHealthSummary(
                reachability: status,
                agent: "degraded",
                adapter: "unknown"
            )
        )
    }

    private func makeTask(id: String, status: String, at: String) -> PhoneDexTask {
        PhoneDexTask(
            id: id,
            at: at,
            source: "test",
            title: id,
            text: "Task \(id)",
            cwd: "/workspace/phonedex",
            workspaceName: nil,
            machineName: "MacBook",
            sessionId: id,
            status: status,
            branch: nil,
            repository: nil
        )
    }
}
