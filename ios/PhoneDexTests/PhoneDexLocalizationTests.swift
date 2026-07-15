import XCTest
@testable import PhoneDex

final class PhoneDexLocalizationTests: XCTestCase {
    func testCriticalNonSwiftUIStringsHaveStableEnglishDefaults() {
        let english = Locale(identifier: "en_US")

        XCTAssertEqual(
            PhoneDexLocalization.approvalReason(locale: english),
            "Confirm this approval decision in PhoneDex."
        )
        XCTAssertEqual(
            PhoneDexLocalization.bridgeHTTPStatus(503, locale: english),
            "Bridge returned HTTP 503."
        )
    }

    func testRelativeDatesUseTheSystemLocaleFormatter() {
        let reference = Date(timeIntervalSince1970: 1_000_000)
        let date = reference.addingTimeInterval(-3600)

        XCTAssertFalse(PhoneDexLocalization.relativeDate(date, relativeTo: reference).isEmpty)
    }
}
