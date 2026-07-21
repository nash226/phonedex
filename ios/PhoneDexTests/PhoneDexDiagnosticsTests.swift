import XCTest
@testable import PhoneDex

final class PhoneDexDiagnosticsTests: XCTestCase {
    func testDiagnosticsDecodeAndShareTextRemainContentFree() throws {
        let data = Data(#"{"schema":"phonedex.diagnostics.v1","generatedAt":"2026-07-17T00:00:00Z","startedAt":"2026-07-16T00:00:00Z","service":"watchdex","role":"hub","version":"0.1.0","protocolVersion":1,"components":{"hub":"healthy","agent":"unknown"},"metrics":{"requests":4,"failures":1,"commands":2,"routes":{"/sync":{"requests":4,"failures":1,"averageLatencyMs":12}}},"recentRequests":[],"capabilities":[{"id":"sync.snapshot.v1","supported":true}]}"#.utf8)
        let snapshot = try JSONDecoder().decode(PhoneDexDiagnosticsSnapshot.self, from: data)

        XCTAssertEqual(snapshot.schema, "phonedex.diagnostics.v1")
        XCTAssertEqual(snapshot.metrics.failures, 1)
        XCTAssertTrue(snapshot.shareText.contains("sync.snapshot.v1=available"))
        XCTAssertFalse(snapshot.shareText.contains("/workspace"))
        XCTAssertFalse(snapshot.shareText.contains("token"))
    }

    func testDiagnosticsExposeBoundedComponentHealthAndSafeRecentFailures() throws {
        let data = Data(#"{"schema":"phonedex.diagnostics.v1","generatedAt":"2026-07-17T00:00:00Z","startedAt":"2026-07-16T00:00:00Z","service":"watchdex","role":"hub","version":"0.1.0","protocolVersion":1,"components":{"hub":"healthy","agent":"degraded","adapter":"unknown","push":"unhealthy","extra":"healthy","extra2":"healthy","extra3":"healthy","extra4":"healthy","extra5":"healthy"},"metrics":{"requests":6,"failures":2,"commands":0,"routes":{}},"recentRequests":[{"at":"2026-07-17T00:00:00Z","correlationId":"safe-request-1","route":"/sync?token=secret","status":409,"latencyMs":10,"errorClass":"private text"},{"at":"2026-07-17T00:01:00Z","correlationId":"safe-request-2","route":"bad route","status":500,"latencyMs":11}],"capabilities":[]}"#.utf8)
        let snapshot = try JSONDecoder().decode(PhoneDexDiagnosticsSnapshot.self, from: data)

        XCTAssertEqual(snapshot.componentRows.count, 8)
        XCTAssertEqual(snapshot.overallHealth, .unhealthy)
        XCTAssertEqual(snapshot.recentFailures.count, 2)
        XCTAssertEqual(snapshot.recentFailures[0].routeLabel, "/sync")
        XCTAssertEqual(snapshot.recentFailures[1].routeLabel, "Unknown endpoint")
        XCTAssertFalse(snapshot.recentFailures[0].routeLabel.contains("token"))
    }

    func testDiagnosticsRejectOversizedCollectionsBeforeMaterializingThem() {
        let components = (0...PhoneDexDiagnosticsSnapshot.maxComponents)
            .map { "\"component\($0)\":\"healthy\"" }
            .joined(separator: ",")
        let payload = #"{"schema":"phonedex.diagnostics.v1","generatedAt":"2026-07-17T00:00:00Z","startedAt":"2026-07-16T00:00:00Z","service":"watchdex","role":"hub","version":"0.1.0","protocolVersion":1,"components":{"# + components + #"},"metrics":{"requests":0,"failures":0,"commands":0,"routes":{}},"recentRequests":[],"capabilities":[]}"#
        let data = Data(payload.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexDiagnosticsSnapshot.self, from: data))
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
        ])!

        XCTAssertEqual(project.activeTaskCount, 1)
        XCTAssertEqual(project.attentionTaskCount, 1)
        XCTAssertEqual(project.latestTask?.id, "done")
    }

    func testWorkspaceConversationProjectionContainsOneRowPerConversation() {
        let project = PhoneDexProject(tasks: [
            makeTask(id: "older", status: "running", at: "2026-07-15T12:00:00.000Z"),
            makeTask(id: "newer", status: "completed", at: "2026-07-15T12:01:00.000Z")
        ])!

        XCTAssertEqual(project.tasks.map(\.id), ["newer", "older"])
        XCTAssertEqual(Set(project.tasks.map(\.id)).count, project.tasks.count)
    }

    func testArtifactLibraryItemRetainsTaskAndMachineContext() {
        let artifact = PhoneDexArtifact(
            id: "report",
            name: "report.json",
            kind: "validation",
            sourceRef: "artifacts/report.json",
            sizeBytes: 12,
            sha256: String(repeating: "a", count: 64),
            downloadId: "artifact_report_123",
            mediaType: "application/json"
        )
        let item = PhoneDexArtifactLibraryItem(
            taskID: "task-1",
            taskTitle: "Run checks",
            workspaceName: "PhoneDex",
            machineName: "Build PC",
            artifact: artifact
        )

        XCTAssertEqual(item.id, "task-1-report")
        XCTAssertEqual(item.workspaceName, "PhoneDex")
        XCTAssertEqual(item.machineName, "Build PC")
        XCTAssertTrue(item.artifact.isDownloadable)
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

    func testDeviceConversationProjectionKeepsOwnedLatestRowsAndSeparatesMachines() {
        let device = makeDevice(status: "online")
        let tasks = [
            makeTask(id: "older", status: "running", at: "2026-07-15T12:00:00.000Z"),
            makeTask(id: "newer", status: "completed", at: "2026-07-15T12:01:00.000Z"),
            PhoneDexTask(
                id: "other-machine",
                at: "2026-07-15T12:02:00.000Z",
                source: "test",
                title: "Other machine",
                text: "Task",
                cwd: "/workspace/phonedex",
                workspaceName: "PhoneDex",
                machineName: "Windows Workstation",
                sessionId: "other",
                status: "running",
                branch: nil,
                repository: nil
            )
        ]

        XCTAssertEqual(device.conversations(from: tasks).map(\.id), ["newer", "older"])
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

    func testDeviceTaskAttributionPrefersStableIdentityOverDisplayName() {
        let device = makeDevice(status: "online")
        let sameNameOtherDevice = PhoneDexTask(
            id: "other-task",
            at: "2026-07-15T12:00:00Z",
            source: "remote-agent",
            title: "Other machine",
            text: "Done",
            cwd: "/workspace/other",
            workspaceName: "Other",
            machineName: device.machineName,
            sessionId: "other-session",
            status: "completed",
            branch: nil,
            repository: nil,
            deviceId: "other-device"
        )
        let matchingTask = PhoneDexTask(
            id: "matching-task",
            at: "2026-07-15T12:00:00Z",
            source: "remote-agent",
            title: "Matching machine",
            text: "Done",
            cwd: "/workspace/matching",
            workspaceName: "Matching",
            machineName: device.machineName,
            sessionId: "matching-session",
            status: "completed",
            branch: nil,
            repository: nil,
            deviceId: device.deviceId
        )

        XCTAssertFalse(device.owns(sameNameOtherDevice))
        XCTAssertTrue(device.owns(matchingTask))
    }

    func testLegacyTaskAttributionRequiresNonEmptyMachineIdentity() {
        let device = makeDevice(status: "online")
        let legacyTask = makeTask(id: "legacy", status: "completed", at: "2026-07-15T12:00:00Z")
        let unknownDevice = PhoneDexDevice(
            deviceId: "unknown-device",
            machineName: nil,
            platform: "windows",
            role: "agent",
            status: "online",
            lastSeenAt: nil,
            version: nil,
            publicUrl: nil,
            expected: nil
        )

        XCTAssertTrue(device.owns(legacyTask))
        XCTAssertFalse(unknownDevice.owns(legacyTask))
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
