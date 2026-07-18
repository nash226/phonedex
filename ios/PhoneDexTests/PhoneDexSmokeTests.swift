import XCTest
@testable import PhoneDex

final class PhoneDexSmokeTests: XCTestCase {
    func testPrivacyShieldCoversInactiveAndBackgroundSnapshots() {
        XCTAssertFalse(PhoneDexPrivacyShieldPolicy.shouldShield(.active))
        XCTAssertTrue(PhoneDexPrivacyShieldPolicy.shouldShield(.inactive))
        XCTAssertTrue(PhoneDexPrivacyShieldPolicy.shouldShield(.background))
    }

    func testPrimaryTabRestoresKnownValuesAndDefaultsSafely() {
        XCTAssertEqual(PhoneDexPrimaryTab.restored(from: "settings"), .settings)
        XCTAssertEqual(PhoneDexPrimaryTab.restored(from: "projects"), .projects)
        XCTAssertEqual(PhoneDexPrimaryTab.restored(from: nil), .chats)
        XCTAssertEqual(PhoneDexPrimaryTab.restored(from: "future-tab"), .chats)
    }

    func testPrimaryTabStorageKeyIsStableAndContainsNoTaskContext() {
        XCTAssertEqual(PhoneDexPrimaryTab.storageKey, "phonedex.primaryTab")
        XCTAssertFalse(PhoneDexPrimaryTab.storageKey.contains("task"))
        XCTAssertEqual(PhoneDexPrimaryTab.allCases.count, 5)
    }

    func testDeepLinkDiagnosticsExcludeCredentialsAndQueryValues() {
        let url = URL(string: "phonedex://configure?bridgeUrl=https%3A%2F%2Fbridge.test&token=secret")!

        let description = PhoneDexDeepLinkDiagnostics.redactedDescription(for: url)

        XCTAssertEqual(description, "phonedex://configure")
        XCTAssertFalse(description.contains("bridge.test"))
        XCTAssertFalse(description.contains("secret"))
        XCTAssertFalse(description.contains("?"))
    }

    func testAppLaunchAndTaskModelDecode() throws {
        _ = PhoneDexApp()

        let data = Data(
            """
            {
              "id": "task_smoke",
              "at": "2026-07-15T00:00:00.000Z",
              "source": "stop-hook",
              "title": "Smoke test task",
              "text": "The bridge returned a completed task.",
              "cwd": "/Users/example/project",
              "machineName": "MacBook Pro",
              "sessionId": "session_smoke"
            }
            """.utf8
        )

        let task = try JSONDecoder().decode(PhoneDexTask.self, from: data)

        XCTAssertEqual(task.id, "task_smoke")
        XCTAssertEqual(task.title, "Smoke test task")
        XCTAssertEqual(task.machineName, "MacBook Pro")
        XCTAssertEqual(task.sessionId, "session_smoke")
    }

    func testTaskDecoderRejectsOverlongDisplayText() {
        let data = Data("""
        {"id":"task_large","text":"\(String(repeating: "x", count: PhoneDexNativeDecodeBounds.taskText + 1))"}
        """.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexTask.self, from: data)) { error in
            guard case DecodingError.dataCorrupted = error else {
                return XCTFail("Expected a bounded native decoding error, got \(error)")
            }
        }
    }

    func testRequiredNativeModelFieldsFailClosedWithoutForceUnwraps() throws {
        let malformedPayloads: [(String, String)] = [
            ("task id", "{\"id\":null}"),
            ("question id", "{\"id\":\"task\",\"question\":{\"id\":null,\"prompt\":\"Choose\",\"choices\":[],\"allowsFreeText\":false}}"),
            ("question prompt", "{\"id\":\"task\",\"question\":{\"id\":\"question\",\"prompt\":null,\"choices\":[],\"allowsFreeText\":false}}")
        ]

        for (label, json) in malformedPayloads {
            XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexTask.self, from: Data(json.utf8)), label) { error in
                guard case DecodingError.valueNotFound = error else {
                    return XCTFail("Expected a required-field decoding error for \(label), got \(error)")
                }
            }
        }

        XCTAssertThrowsError(
            try JSONDecoder().decode(PhoneDexChangedFile.self, from: Data("{\"path\":null,\"status\":\"modified\"}".utf8))
        )
        XCTAssertThrowsError(
            try JSONDecoder().decode(PhoneDexEvent.self, from: Data("{\"id\":\"event\",\"taskId\":\"task\",\"createdAt\":\"now\",\"sequence\":1,\"type\":null}".utf8))
        )
    }

    func testEvidenceDecoderRejectsOversizedPatchAndCollections() throws {
        let oversizedPatch = String(repeating: "+line\n", count: PhoneDexNativeDecodeBounds.patch / 6 + 1)
        let oversizedPatchPayload: [String: Any] = [
            "changedFiles": [["path": "Sources/App.swift", "status": "modified", "patch": oversizedPatch]]
        ]
        let oversizedPatchData = try JSONSerialization.data(withJSONObject: oversizedPatchPayload)
        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexTaskEvidence.self, from: oversizedPatchData))

        let oversizedCollectionPayload: [String: Any] = [
            "validations": (0...PhoneDexNativeDecodeBounds.evidenceItems).map { index in
                ["id": "validation_\(index)", "name": "Tests", "status": "passed"]
            }
        ]
        let oversizedCollectionData = try JSONSerialization.data(withJSONObject: oversizedCollectionPayload)
        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexTaskEvidence.self, from: oversizedCollectionData))
    }

    func testProjectsCombineMatchingNamesAcrossDevices() throws {
        let first = try decodeTask(
            id: "task_mac",
            cwd: "/Users/example/PhoneDex",
            machineName: "MacBook Pro"
        )
        let second = try decodeTask(
            id: "task_windows",
            cwd: "C:/Users/example/PhoneDex",
            machineName: "Windows PC"
        )

        XCTAssertEqual(first.projectID, second.projectID)

        let projects = Dictionary(grouping: [first, second], by: \PhoneDexTask.projectID)
            .values
            .compactMap(PhoneDexProject.init(tasks:))

        XCTAssertEqual(projects.count, 1)
        XCTAssertEqual(projects[0].machineNames, ["MacBook Pro", "Windows PC"])
        XCTAssertEqual(projects[0].deviceSummary, "2 devices")
        XCTAssertEqual(projects[0].paths.count, 2)
        XCTAssertEqual(projects[0].tasks.count, 2)
    }

    func testEmptyProjectInputIsRejectedWithoutIndexingACollection() {
        XCTAssertNil(PhoneDexProject(tasks: []))
    }

    func testSyncDecoderRejectsUnknownRecordKindsWithoutAdvancingState() throws {
        let data = Data("""
        {
          "position": 42,
          "kind": "future_record",
          "id": "future_1",
          "deleted": false,
          "record": {"id": "future_1"}
        }
        """.utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexSyncChange.self, from: data)) { error in
            guard case let DecodingError.dataCorrupted(context) = error else {
                return XCTFail("Expected an explicit compatibility decoding error, got \(error)")
            }
            XCTAssertTrue(context.debugDescription.contains("unsupported record kind"))
            XCTAssertTrue(context.debugDescription.contains("future_record"))
        }
    }

    func testProjectsKeepDifferentWorkspaceNamesSeparate() throws {
        let first = try decodeTask(
            id: "task_phonedex",
            cwd: "/Users/example/PhoneDex",
            machineName: "MacBook Pro"
        )
        let second = try decodeTask(
            id: "task_website",
            cwd: "/Users/example/Website",
            machineName: "MacBook Pro"
        )

        XCTAssertNotEqual(first.projectID, second.projectID)
    }

    func testWindowsPathsProduceTheExpectedProjectName() throws {
        let task = try decodeTask(
            id: "task_windows",
            cwd: "C:\\Users\\example\\PhoneDex",
            machineName: "Windows PC"
        )

        XCTAssertEqual(task.displayWorkspace, "PhoneDex")
        XCTAssertEqual(task.projectID, "phonedex")
    }

    func testTaskActivityUsesLifecycleAndCaptureProvenance() throws {
        let task = try JSONDecoder().decode(
            PhoneDexTask.self,
            from: Data(
                """
                {
                  "id": "task_activity",
                  "createdAt": "2026-07-15T12:00:00.000Z",
                  "updatedAt": "2026-07-15T12:05:00.000Z",
                  "version": 3,
                  "source": "stop-hook",
                  "title": "Review the bridge",
                  "text": "The bridge is ready.",
                  "machineName": "Windows PC",
                  "status": "completed",
                  "captureSources": [
                    {"source": "stop-hook", "messageId": "message_1", "observedAt": "2026-07-15T12:04:00.000Z"}
                  ]
                }
                """.utf8
            )
        )

        XCTAssertEqual(task.version, 3)
        XCTAssertEqual(task.displaySource, "Stop hook")
        XCTAssertEqual(task.activity.count, 3)
        XCTAssertEqual(task.activity[1].title, "Captured by Stop hook")
        XCTAssertEqual(task.activity[1].detail, "Message message_1")
    }

    func testManagedTaskCapabilitiesAndDeviceWorkspacesDecode() throws {
        let task = try JSONDecoder().decode(
            PhoneDexTask.self,
            from: Data("""
            {"id":"managed_task","status":"canceling","lifecycleCapabilities":["task.cancel.v1","task.retry.v1"]}
            """.utf8)
        )
        let device = try JSONDecoder().decode(
            PhoneDexDevice.self,
            from: Data("""
            {"deviceId":"agent_1","machineName":"Studio Mac","platform":"macos","status":"online","capabilities":["task.create.v1"],"workspaces":["PhoneDex","Website"]}
            """.utf8)
        )

        XCTAssertTrue(task.supportsLifecycle("task.cancel.v1"))
        XCTAssertEqual(task.displayStatus, "Cancelling")
        XCTAssertTrue(device.supportsCapability("task.create.v1"))
        XCTAssertEqual(device.workspaces, ["PhoneDex", "Website"])
    }

    func testStructuredQuestionDecodesChoicesAndFreeTextPolicy() throws {
        let task = try JSONDecoder().decode(
            PhoneDexTask.self,
            from: Data(
                """
                {
                  "id": "task_question",
                  "createdAt": "2026-07-15T12:00:00.000Z",
                  "title": "Choose a target",
                  "text": "The release is ready.",
                  "status": "needs_input",
                  "question": {
                    "id": "deploy-target",
                    "prompt": "Where should it go?",
                    "choices": [
                      {"id": "staging", "label": "Deploy to staging"},
                      {"id": "production", "label": "Deploy to production"}
                    ],
                    "allowsFreeText": true
                  }
                }
                """.utf8
            )
        )

        XCTAssertEqual(task.question?.id, "deploy-target")
        XCTAssertEqual(task.question?.choices.map(\.label), ["Deploy to staging", "Deploy to production"])
        XCTAssertTrue(task.question?.allowsFreeText == true)
    }

    func testApprovalRequestDecodesBoundedReviewMetadataAndExpiry() throws {
        let task = try JSONDecoder().decode(
            PhoneDexTask.self,
            from: Data(
                """
                {
                  "id": "task_approval",
                  "createdAt": "2026-07-15T12:00:00.000Z",
                  "version": 4,
                  "status": "awaiting_approval",
                  "title": "Review a file operation",
                  "approvalRequest": {
                    "id": "approval_1",
                    "taskVersion": 4,
                    "operation": "Write generated files",
                    "scope": "PhoneDex workspace",
                    "origin": {"deviceId": "mac_1", "machineName": "Build Mac", "workspaceName": "PhoneDex"},
                    "reason": "The task is ready to update the generated project.",
                    "risk": "Changes files in the selected workspace.",
                    "requestedAt": "2026-07-15T12:00:00.000Z",
                    "expiresAt": "2099-07-15T12:15:00.000Z",
                    "state": "pending"
                  }
                }
                """.utf8
            )
        )

        XCTAssertEqual(task.approvalRequest?.id, "approval_1")
        XCTAssertEqual(task.approvalRequest?.taskVersion, 4)
        XCTAssertEqual(task.approvalRequest?.origin.workspaceName, "PhoneDex")
        XCTAssertEqual(task.approvalRequest?.displayState, "Awaiting your review")
        XCTAssertFalse(task.approvalRequest?.isExpired == true)
    }

    func testLifecycleEventDecodesBoundedSummary() throws {
        let event = try JSONDecoder().decode(
            PhoneDexEvent.self,
            from: Data("""
            {
              "id": "event_1",
              "taskId": "task_1",
              "createdAt": "2026-07-15T12:00:01.000Z",
              "sequence": 2,
              "type": "progress",
              "data": {"summary": "Running focused tests"}
            }
            """.utf8)
        )

        XCTAssertEqual(event.displayTitle, "Progress")
        XCTAssertEqual(event.summary, "Running focused tests")
        XCTAssertEqual(event.sequence, 2)
    }

    func testDesktopHandoffDecodesStableTaskContext() throws {
        let response = try JSONDecoder().decode(
            PhoneDexLifecycleResponse.self,
            from: Data("""
            {
              "state": "completed",
              "handoff": {
                "schema": "phonedex.desktop-handoff.v1",
                "protocolVersion": 1,
                "capability": "desktop.handoff.v1",
                "taskId": "task_1",
                "sessionId": "session_1",
                "machineName": "Windows PC",
                "workspaceName": "PhoneDex",
                "platform": "windows",
                "adapterId": "codex.app-server",
                "adapterMode": "app-server",
                "branch": "main"
              },
              "receipt": {
                "commandId": "command_1",
                "state": "completed"
              }
            }
            """.utf8)
        )

        XCTAssertEqual(response.handoff?.capability, "desktop.handoff.v1")
        XCTAssertEqual(response.handoff?.sessionId, "session_1")
        XCTAssertEqual(response.handoff?.copyText.contains("/"), false)
        XCTAssertEqual(response.receipt.state, "completed")
    }

    func testTaskEvidenceDecodesReviewMetadataWithoutWorkspacePaths() throws {
        let task = try JSONDecoder().decode(
            PhoneDexTask.self,
            from: Data("""
            {
              "id": "task_evidence",
              "createdAt": "2026-07-15T12:00:00.000Z",
              "title": "Review evidence",
              "text": "The change is ready.",
              "evidence": {
                "changedFiles": [
                  {
                    "path": "ios/PhoneDexApp/ContentView.swift",
                    "status": "modified",
                    "sourceRef": "ios/PhoneDexApp/ContentView.swift#L10-L30",
                    "additions": 12,
                    "deletions": 3,
                    "patch": "@@ -10,1 +10,2 @@\\n-old\\n+new\\n"
                  }
                ],
                "artifacts": [
                  {
                    "id": "build-log",
                    "name": "iOS build log",
                    "kind": "log",
                    "sourceRef": "artifacts/ios-build.log",
                    "sizeBytes": 1024
                  }
                ],
                "validations": [
                  {
                    "id": "ios-build",
                    "name": "Unsigned iOS build",
                    "status": "passed",
                    "summary": "Build completed"
                  }
                ]
              }
            }
            """.utf8)
        )

        XCTAssertEqual(task.evidence?.changedFiles.first?.path, "ios/PhoneDexApp/ContentView.swift")
        XCTAssertEqual(task.evidence?.changedFiles.first?.additions, 12)
        XCTAssertTrue(task.evidence?.changedFiles.first?.hasPatch == true)
        XCTAssertEqual(task.evidence?.artifacts.first?.displaySize, "1 KB")
        XCTAssertEqual(task.evidence?.validations.first?.displayStatus, "Passed")
    }

    private func decodeTask(id: String, cwd: String, machineName: String) throws -> PhoneDexTask {
        let payload: [String: Any] = [
            "id": id,
            "at": "2026-07-15T00:00:00.000Z",
            "source": "stop-hook",
            "title": "Completed task",
            "text": "Done",
            "cwd": cwd,
            "machineName": machineName,
            "sessionId": "session_\(id)"
        ]
        return try JSONDecoder().decode(
            PhoneDexTask.self,
            from: JSONSerialization.data(withJSONObject: payload)
        )
    }
}
