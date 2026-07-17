import XCTest

final class PhoneDexNotificationContentTests: XCTestCase {
    func testMissingValuesUseSafeAccessibleFallbacks() {
        let content = PhoneDexNotificationContent(title: "   ", body: nil)

        XCTAssertEqual(content.app, "PhoneDex")
        XCTAssertEqual(content.title, "Codex update")
        XCTAssertEqual(content.body, "No notification body was provided.")
    }

    func testOversizedContentIsBoundedAndMarkedIncomplete() {
        let title = String(repeating: "t", count: PhoneDexNotificationContent.maxTitleLength + 40)
        let body = String(repeating: "b", count: PhoneDexNotificationContent.maxBodyLength + 40)
        let content = PhoneDexNotificationContent(title: title, body: body)

        XCTAssertEqual(content.title.count, PhoneDexNotificationContent.maxTitleLength)
        XCTAssertEqual(content.title.last, "…")
        XCTAssertEqual(content.body.count, PhoneDexNotificationContent.maxBodyLength)
        XCTAssertEqual(content.body.last, "…")
    }

    func testWhitespaceAndLineBreaksRemainReadable() {
        let content = PhoneDexNotificationContent(title: "  Needs input  ", body: " first\nsecond ")

        XCTAssertEqual(content.title, "Needs input")
        XCTAssertEqual(content.body, "first\nsecond")
    }
}
