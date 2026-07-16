import XCTest
@testable import PhoneDex

@MainActor
final class PhoneDexBrowserTests: XCTestCase {
    func testShareURLIsAvailableForAValidAddress() {
        let model = PhoneDexBrowserModel()

        XCTAssertEqual(model.shareURL?.absoluteString, "https://github.com/nash226/phonedex")
    }

    func testShareURLFailsClosedForMalformedAddress() {
        let model = PhoneDexBrowserModel()
        model.address = "not a valid URL"

        XCTAssertNil(model.shareURL)
    }
}
