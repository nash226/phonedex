import XCTest
@testable import PhoneDex

final class PhoneDexSmokeTests: XCTestCase {
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

    func testProjectsKeepMatchingNamesOnDifferentDevicesDistinct() throws {
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

        XCTAssertNotEqual(first.projectID, second.projectID)

        let projects = Dictionary(grouping: [first, second], by: \PhoneDexTask.projectID)
            .values
            .map(PhoneDexProject.init(tasks:))

        XCTAssertEqual(projects.count, 2)
        XCTAssertEqual(Set(projects.map(\.machineName)), ["MacBook Pro", "Windows PC"])
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
