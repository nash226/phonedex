import XCTest
@testable import PhoneDex

final class PhoneDexChatFilteringTests: XCTestCase {
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
        XCTAssertEqual(filter.filteredTasks(tasks).map(\.id), ["mac-task"])
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

    private func task(
        _ id: String,
        status: String?,
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
            source: "codex",
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
