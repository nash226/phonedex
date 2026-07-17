import XCTest
@testable import PhoneDex

final class PhoneDexChatFilteringTests: XCTestCase {
    func testLatestEventUsesSequenceOrderAndProvidesSafeFallbackSummary() {
        let events = [
            PhoneDexEvent(
                id: "progress-2",
                taskId: "running",
                createdAt: "2026-07-15T12:02:00.000Z",
                sequence: 2,
                type: "progress",
                data: [:]
            ),
            PhoneDexEvent(
                id: "progress-1",
                taskId: "running",
                createdAt: "2026-07-15T12:01:00.000Z",
                sequence: 1,
                type: "progress",
                data: ["summary": "Running focused tests"]
            )
        ]

        let latest = events.sorted { $0.sequence < $1.sequence }.last

        XCTAssertEqual(latest?.id, "progress-2")
        XCTAssertEqual(latest?.displaySummary, "Progress")
        XCTAssertEqual(events[1].displaySummary, "Running focused tests")
    }

    func testScopesSeparateActionableRunningAndRecentWork() {
        let tasks = [
            task("question", status: "needs_input"),
            task("approval", status: "awaiting_approval"),
            task("running", status: "running"),
            task("queued", status: "queued"),
            task("complete", status: "completed"),
            task("legacy", status: nil)
        ]

        XCTAssertEqual(
            PhoneDexTaskFilter(scope: .needsYou).filteredTasks(tasks).map(\.id),
            ["question", "approval"]
        )
        XCTAssertEqual(
            PhoneDexTaskFilter(scope: .running).filteredTasks(tasks).map(\.id),
            ["running", "queued"]
        )
        XCTAssertEqual(
            PhoneDexTaskFilter(scope: .recent).filteredTasks(tasks).map(\.id),
            ["complete", "legacy"]
        )
    }

    func testSearchCoversConversationContextAndCombinesWithFilters() {
        let tasks = [
            task(
                "mac-task",
                status: "completed",
                title: "Review API changes",
                text: "The focused tests passed.",
                cwd: "/Users/nazeer/PhoneDex",
                machineName: "Studio Mac",
                branch: "codex/ios-ui",
                repository: "nash226/phonedex"
            ),
            task(
                "windows-task",
                status: "completed",
                title: "Update docs",
                cwd: "C:\\PhoneDex",
                machineName: "Build PC"
            )
        ]

        var filter = PhoneDexTaskFilter(scope: .recent)
        filter.searchText = "ios-ui"
        XCTAssertEqual(filter.filteredTasks(tasks).map(\.id), ["mac-task"])

        filter.searchText = ""
        filter.machineName = "Build PC"
        XCTAssertEqual(filter.filteredTasks(tasks).map(\.id), ["windows-task"])

        filter.machineName = nil
        filter.workspaceName = "PhoneDex"
        XCTAssertEqual(filter.filteredTasks(tasks).map(\.id), ["mac-task", "windows-task"])
    }

    func testFilterOptionsAreStableAndUnique() {
        let tasks = [
            task("one", status: "completed", cwd: "/work/z", machineName: "Mac"),
            task("two", status: "completed", cwd: "/work/a", machineName: "mac"),
            task("three", status: "completed", cwd: "/work/z", machineName: "Mac")
        ]
        let filter = PhoneDexTaskFilter(scope: .recent)

        XCTAssertEqual(filter.machineOptions(from: tasks), ["Mac", "mac"])
        XCTAssertEqual(filter.workspaceOptions(from: tasks), ["a", "z"])
    }

    func testConversationListKeepsSideChatsSeparateAndUsesLatestCompletion() {
        let parentOlder = task(
            "parent-old",
            status: "completed",
            text: "Older parent result",
            sessionId: "thread-parent",
            at: "2026-07-15T11:00:00.000Z"
        )
        let parentLatest = task(
            "parent-new",
            status: "completed",
            text: "Latest parent result",
            sessionId: "thread-parent",
            at: "2026-07-15T12:00:00.000Z"
        )
        let sideChat = task(
            "side-chat",
            status: "completed",
            text: "Side chat result",
            sessionId: "thread-side",
            at: "2026-07-15T11:30:00.000Z"
        )

        let conversations = PhoneDexTask.latestPerConversation([parentOlder, sideChat, parentLatest])

        XCTAssertEqual(Set(conversations.map(\.id)), ["parent-new", "side-chat"])
        XCTAssertEqual(conversations.count, 2)
    }

    func testWorkspaceSearchCoversMachinePathAndCachedTaskContext() {
        let project = PhoneDexProject(tasks: [
            task(
                "workspace-task",
                status: "completed",
                title: "Review sync boundary",
                text: "The iOS reconciliation tests passed.",
                cwd: "/work/PhoneDex",
                machineName: "Build Mac",
                branch: "codex/sync-hardening",
                repository: "nash226/phonedex"
            )
        ])

        XCTAssertTrue(project.matchesSearch("Build Mac"))
        XCTAssertTrue(project.matchesSearch("/work/PhoneDex"))
        XCTAssertTrue(project.matchesSearch("sync-hardening"))
        XCTAssertTrue(project.matchesSearch("reconciliation tests"))
        XCTAssertFalse(project.matchesSearch("unrelated workspace"))
    }

    func testWorkspaceSearchTrimsWhitespaceAndPreservesProjectOrder() {
        let first = PhoneDexProject(tasks: [task("first", status: "completed", cwd: "/work/Alpha")])
        let second = PhoneDexProject(tasks: [task("second", status: "completed", cwd: "/work/Beta")])

        XCTAssertEqual(
            PhoneDexProject.filtered([first, second], by: "  beta ").map(\.id),
            [second.id]
        )
        XCTAssertEqual(PhoneDexProject.filtered([first, second], by: "   ").map(\.id), [first.id, second.id])
    }

    func testTaskAndReviewStatusCopyUsesStableEnglishFallbacks() {
        let task = task("running", status: "running", source: "stop-hook")
        XCTAssertEqual(task.displayStatus, "Running")
        XCTAssertEqual(task.displaySource, "Stop hook")

        let file = PhoneDexChangedFile(path: "Sources/App.swift", status: "modified", sourceRef: nil, summary: nil, additions: 2, deletions: 1, patch: nil, patchTruncated: nil)
        XCTAssertEqual(file.displayStatus, "Modified")

        let validation = PhoneDexValidationReceipt(id: "tests", name: "Tests", status: "passed", summary: nil, durationMs: 120, completedAt: nil)
        XCTAssertEqual(validation.displayStatus, "Passed")
    }

    func testUntrustedDisplayMetadataIsSingleLineAndBounded() {
        let oversizedMachine = String(repeating: "M", count: 400) + "\nsecret"
        let oversizedWorkspace = String(repeating: "W", count: 400)
        let task = PhoneDexTask(
            id: "bounded",
            at: nil,
            source: String(repeating: "S", count: 400),
            title: "Bounded metadata",
            text: "Result",
            cwd: nil,
            workspaceName: oversizedWorkspace,
            machineName: oversizedMachine,
            sessionId: nil,
            status: "completed",
            branch: nil,
            repository: nil
        )

        XCTAssertEqual(task.displayWorkspace.count, PhoneDexDisplayText.metadataLimit)
        XCTAssertEqual(task.displayMachine.count, PhoneDexDisplayText.metadataLimit)
        XCTAssertFalse(task.displayMachine.contains("\n"))
        XCTAssertEqual(task.displaySource.count, PhoneDexDisplayText.metadataLimit)
        XCTAssertTrue(task.displayWorkspace.hasSuffix("…"))
    }

    func testEventAndCaptureLabelsBoundUntrustedSourceText() {
        let source = String(repeating: "x", count: 400)
        let capture = PhoneDexCaptureSource(source: source, messageId: nil, observedAt: nil)
        let event = PhoneDexEvent(
            id: "event",
            taskId: "task",
            createdAt: "2026-07-15T12:00:00.000Z",
            sequence: 1,
            type: "progress",
            data: ["summary": String(repeating: "p", count: 400)]
        )

        XCTAssertLessThanOrEqual(capture.displayName.count, PhoneDexDisplayText.metadataLimit + 13)
        XCTAssertEqual(event.displaySummary.count, PhoneDexDisplayText.metadataLimit)
    }

    private func task(
        _ id: String,
        status: String?,
        source: String = "codex",
        title: String? = nil,
        text: String = "Codex result",
        cwd: String = "/work/project",
        machineName: String = "Mac",
        branch: String? = nil,
        repository: String? = nil,
        sessionId: String? = nil,
        at: String = "2026-07-15T12:00:00.000Z"
    ) -> PhoneDexTask {
        PhoneDexTask(
            id: id,
            at: at,
            source: source,
            title: title ?? id,
            text: text,
            cwd: cwd,
            workspaceName: nil,
            machineName: machineName,
            sessionId: sessionId,
            status: status,
            branch: branch,
            repository: repository
        )
    }
}
