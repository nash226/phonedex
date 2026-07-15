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
}
