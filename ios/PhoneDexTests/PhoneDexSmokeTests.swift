import XCTest
@testable import PhoneDex

final class PhoneDexSmokeTests: XCTestCase {
    func testOfflineOutboxSummaryExplainsEmptyAndQueuedActions() {
        XCTAssertEqual(PhoneDexOfflineOutboxSummary.empty.totalCount, 0)
        XCTAssertEqual(
            PhoneDexOfflineOutboxSummary(replyCount: 1, lifecycleCount: 0, taskCount: 1).detail,
            "1 reply for 1 conversation. They will retry after a successful sync."
        )
        XCTAssertEqual(
            PhoneDexOfflineOutboxSummary(replyCount: 2, lifecycleCount: 1, taskCount: 2).detail,
            "2 replies and 1 task action across 2 conversations. They will retry after a successful sync."
        )
    }

    func testTaskDeepLinkAcceptsBoundedOpaqueTaskIDWithoutQueryData() throws {
        let url = try XCTUnwrap(URL(string: "phonedex://task/task_123-abc"))

        XCTAssertEqual(PhoneDexDeepLinkRoute(url: url), .task("task_123-abc"))
    }

    func testTaskDeepLinkRejectsQueryDataAndUnsafeOrUnboundedIDs() throws {
        let queryURL = try XCTUnwrap(URL(string: "phonedex://task/task_123?token=secret"))
        let unsafeURL = try XCTUnwrap(URL(string: "phonedex://task/task%2F123"))
        let oversizedID = String(repeating: "a", count: 129)
        let oversizedURL = try XCTUnwrap(URL(string: "phonedex://task/\(oversizedID)"))

        XCTAssertNil(PhoneDexDeepLinkRoute(url: queryURL))
        XCTAssertNil(PhoneDexDeepLinkRoute(url: unsafeURL))
        XCTAssertNil(PhoneDexDeepLinkRoute(url: oversizedURL))
    }

    func testTaskDeepLinkPreservesSupportedUtilityRoutes() throws {
        XCTAssertEqual(PhoneDexDeepLinkRoute(url: URL(string: "phonedex://preview")!), .preview)
        XCTAssertEqual(PhoneDexDeepLinkRoute(url: URL(string: "phonedex://notify-latest")!), .notifyLatest)
        XCTAssertEqual(PhoneDexDeepLinkRoute(url: URL(string: "phonedex://status")!), .status)
    }

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

    func testDuplicateNotificationResultSurvivesPersistenceAsNeutralOutcome() {
        let defaults = UserDefaults.standard
        let keys = [
            "phonedex.notificationReply.state",
            "phonedex.notificationReply.message",
            "phonedex.notificationReply.updatedAt"
        ]
        defer { keys.forEach(defaults.removeObject(forKey:)) }

        NotificationReplyResult.record(.duplicate("This notification action was already handled."))

        XCTAssertEqual(
            NotificationReplyResult.latest(now: Date()),
            .duplicate("This notification action was already handled.")
        )
    }

    func testNotificationReplyResultExpiresAfterBoundedFreshnessWindow() {
        let defaults = UserDefaults.standard
        let keys = [
            "phonedex.notificationReply.state",
            "phonedex.notificationReply.message",
            "phonedex.notificationReply.updatedAt"
        ]
        defer { keys.forEach(defaults.removeObject(forKey:)) }

        let now = Date(timeIntervalSince1970: 1_000_000)
        defaults.set("sent", forKey: "phonedex.notificationReply.state")
        defaults.set("Reply sent", forKey: "phonedex.notificationReply.message")
        defaults.set(now.timeIntervalSince1970 - NotificationReplyResult.maxAge - 1, forKey: "phonedex.notificationReply.updatedAt")

        XCTAssertNil(NotificationReplyResult.latest(now: now))
    }

    func testNotificationReplyResultRejectsFutureOrMalformedTimestamps() {
        let defaults = UserDefaults.standard
        let keys = [
            "phonedex.notificationReply.state",
            "phonedex.notificationReply.message",
            "phonedex.notificationReply.updatedAt"
        ]
        defer { keys.forEach(defaults.removeObject(forKey:)) }

        defaults.set("failed", forKey: "phonedex.notificationReply.state")
        defaults.set("Try again", forKey: "phonedex.notificationReply.message")
        defaults.set(Date().addingTimeInterval(60).timeIntervalSince1970, forKey: "phonedex.notificationReply.updatedAt")
        XCTAssertNil(NotificationReplyResult.latest())

        defaults.set("not-a-timestamp", forKey: "phonedex.notificationReply.updatedAt")
        XCTAssertNil(NotificationReplyResult.latest())
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
              "transcript": [
                {"id":"turn_1","role":"assistant","text":"The first update.","createdAt":"2026-07-15T00:00:01.000Z","source":"codex-session-watch"},
                {"id":"turn_2","role":"assistant","text":"The final update.","createdAt":"2026-07-15T00:00:02.000Z","source":"codex-session-watch"}
              ],
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
        XCTAssertEqual(task.transcript.count, 2)
        XCTAssertEqual(task.transcript.last?.displayRole, "Codex")
        XCTAssertEqual(task.transcript.last?.text, "The final update.")
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

    func testRequiredBoundedFieldsRejectOversizedDataWithoutTrapping() throws {
        let oversizedID = String(repeating: "x", count: PhoneDexNativeDecodeBounds.id + 1)
        let oversizedPath = String(repeating: "x", count: PhoneDexNativeDecodeBounds.path + 1)
        let oversizedType = String(repeating: "x", count: PhoneDexNativeDecodeBounds.status + 1)
        let taskData = Data("{\"id\":\"\(oversizedID)\"}".utf8)
        let questionData = Data("{\"id\":\"\(oversizedID)\",\"prompt\":\"Choose\",\"choices\":[],\"allowsFreeText\":false}".utf8)
        let fileData = Data("{\"path\":\"\(oversizedPath)\",\"status\":\"modified\"}".utf8)
        let eventData = Data("{\"id\":\"event_1\",\"taskId\":\"task_1\",\"createdAt\":\"2026-07-15T00:00:00.000Z\",\"sequence\":1,\"type\":\"\(oversizedType)\"}".utf8)

        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexTask.self, from: taskData))
        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexTaskQuestion.self, from: questionData))
        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexChangedFile.self, from: fileData))
        XCTAssertThrowsError(try JSONDecoder().decode(PhoneDexEvent.self, from: eventData))
    }

    func testLiveActivityKeepsLatestEventVisibleUntilExpanded() {
        let events = (1...3).map { sequence in
            PhoneDexEvent(
                id: "event_\(sequence)",
                taskId: "task_live",
                createdAt: "2026-07-15T12:0\(sequence):00.000Z",
                sequence: sequence,
                type: "progress"
            )
        }

        XCTAssertEqual(
            PhoneDexLiveActivityPresentation.visibleEvents(events, expanded: false).map(\.sequence),
            [3]
        )
        XCTAssertEqual(
            PhoneDexLiveActivityPresentation.visibleEvents(events, expanded: true).map(\.sequence),
            [1, 2, 3]
        )
        XCTAssertEqual(
            PhoneDexLiveActivityPresentation.disclosureTitle(eventCount: 3, expanded: false),
            "Show 2 older events"
        )
        XCTAssertNil(PhoneDexLiveActivityPresentation.disclosureTitle(eventCount: 1, expanded: false))
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
