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
