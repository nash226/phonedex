import XCTest
@testable import PhoneDex

final class PhoneDexDiagnosticsTests: XCTestCase {
    @MainActor
    func testModelSurfacesCacheRecoveryWithoutBlockingFreshSync() {
        let model = PhoneDexAppModel(
            settings: PhoneDexSettings(),
            cache: FailingCache()
        )

        XCTAssertEqual(model.cacheRecoveryState, .unavailable)
        XCTAssertEqual(
            model.cacheRecoveryState.message,
            "Local history could not be restored. PhoneDex will keep working with fresh hub data when it is reachable."
        )
        XCTAssertTrue(model.tasks.isEmpty)
        XCTAssertEqual(model.connectionState, .idle)
    }

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

    func testTaskControlsExplainMissingCapabilityWithoutAdvertisingUnsupportedActions() {
        let task = PhoneDexTask(
            id: "running",
            at: "2026-07-15T12:00:00.000Z",
            source: "remote-agent",
            title: "Running task",
            text: "Working",
            cwd: "/workspace/phonedex",
            workspaceName: "PhoneDex",
            machineName: "Windows Workstation",
            sessionId: "session-1",
            status: "running",
            branch: nil,
            repository: nil,
            lifecycleCapabilities: ["desktop.handoff.v1"]
        )

        let controls = task.controlAvailability(desktopHandoffAvailable: true)

        XCTAssertEqual(controls.map(\.id), ["cancel", "handoff"])
        XCTAssertFalse(controls[0].isAvailable)
        XCTAssertTrue(controls[0].reason.contains("task.cancel.v1"))
        XCTAssertTrue(controls[1].isAvailable)
        XCTAssertEqual(controls[1].capability, "desktop.handoff.v1")
    }

    func testTaskControlsExplainStableIdentityRequirementForHandoff() {
        let task = PhoneDexTask(
            id: "completed",
            at: "2026-07-15T12:00:00.000Z",
            source: "remote-agent",
            title: "Completed task",
            text: "Done",
            cwd: "/workspace/phonedex",
            workspaceName: "PhoneDex",
            machineName: "MacBook",
            sessionId: nil,
            status: "completed",
            branch: nil,
            repository: nil
        )

        let handoff = try! XCTUnwrap(task.controlAvailability(desktopHandoffAvailable: false).first { $0.id == "handoff" })

        XCTAssertFalse(handoff.isAvailable)
        XCTAssertTrue(handoff.reason.contains("stable Codex session identity"))
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

private struct FailingCache: PhoneDexCacheStoring {
    func load() throws -> PhoneDexCachedState? {
        throw PhoneDexCacheError.invalidData
    }

    func save(_ state: PhoneDexCachedState) throws {}

    func remove() throws {}
}
