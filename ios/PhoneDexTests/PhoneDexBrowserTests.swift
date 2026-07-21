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

    func testLoadFailureExposesSafeRetryState() {
        let model = PhoneDexBrowserModel()

        model.recordLoadFailure()

        XCTAssertEqual(model.loadErrorMessage, "The page could not be loaded. Check your connection and try again.")
        XCTAssertFalse(model.isLoading)
    }

    func testSuccessfulAddressClearsPreviousLoadFailure() {
        let model = PhoneDexBrowserModel()
        model.recordLoadFailure()

        model.address = "https://example.com"
        model.loadAddress()

        XCTAssertNil(model.loadErrorMessage)
    }
}
