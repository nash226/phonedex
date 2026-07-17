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

    func testShareURLFailsClosedForUnsupportedScheme() {
        let model = PhoneDexBrowserModel()
        model.address = "javascript:alert(1)"

        XCTAssertNil(model.shareURL)
    }

    func testShareURLFailsClosedForEmbeddedCredentials() {
        let model = PhoneDexBrowserModel()
        model.address = "https://user:password@example.com"

        XCTAssertNil(model.shareURL)
    }

    func testShareURLAllowsHTTPAndHTTPSHosts() {
        let model = PhoneDexBrowserModel()

        model.address = "http://example.com/path"
        XCTAssertEqual(model.shareURL?.absoluteString, "http://example.com/path")

        model.address = "https://example.com/path"
        XCTAssertEqual(model.shareURL?.absoluteString, "https://example.com/path")
    }
}
