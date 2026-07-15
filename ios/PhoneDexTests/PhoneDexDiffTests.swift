import XCTest
@testable import PhoneDex

final class PhoneDexDiffTests: XCTestCase {
    func testParserClassifiesLinesAndTracksHunkNumbers() {
        let document = PhoneDexDiffParser.parse("""
        diff --git a/README.md b/README.md
        @@ -2,2 +2,3 @@
         keep
        -remove
        +add
        """)

        XCTAssertFalse(document.isTruncated)
        XCTAssertEqual(document.lines.map(\.kind), [.metadata, .hunk, .context, .deletion, .addition])
        XCTAssertEqual(document.lines[2].oldLineNumber, 2)
        XCTAssertEqual(document.lines[2].newLineNumber, 2)
        XCTAssertEqual(document.lines[3].oldLineNumber, 3)
        XCTAssertNil(document.lines[3].newLineNumber)
        XCTAssertEqual(document.lines[4].newLineNumber, 3)
    }

    func testParserBoundsLargePatchesForResponsiveReview() {
        let document = PhoneDexDiffParser.parse(
            (0..<20).map { "+line \($0)" }.joined(separator: "\n"),
            lineLimit: 5
        )

        XCTAssertEqual(document.lines.count, 5)
        XCTAssertEqual(document.totalLineCount, 20)
        XCTAssertTrue(document.isTruncated)
    }

    func testParserHandlesTheMobilePerformanceBudgetWithoutExtraRenderedRows() {
        let patch = (0..<PhoneDexDiffParser.defaultLineLimit)
            .map { index in index.isMultiple(of: 2) ? "+added \(index)" : " context \(index)" }
            .joined(separator: "\n")

        let document = PhoneDexDiffParser.parse(patch)

        XCTAssertEqual(document.lines.count, PhoneDexDiffParser.defaultLineLimit)
        XCTAssertEqual(document.totalLineCount, PhoneDexDiffParser.defaultLineLimit)
        XCTAssertFalse(document.isTruncated)
        XCTAssertEqual(document.document(showingContext: false).lines.count, PhoneDexDiffParser.defaultLineLimit / 2)
    }

    func testChangingContextVisibilityReusesParsedLineIdentities() {
        let document = PhoneDexDiffParser.parse("@@ -1,2 +1,2 @@\n keep\n+new")

        XCTAssertEqual(document.document(showingContext: false).lines.map(\.id), [0, 2])
        XCTAssertEqual(document.document(showingContext: true).lines.map(\.id), [0, 1, 2])
    }
}
