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

    func testParserMarksMalformedHunkHeadersWithoutCrashingOrInventingLineNumbers() {
        let document = PhoneDexDiffParser.parse("@@ -not-a-number +2 @@\n+added")

        XCTAssertTrue(document.hasMalformedHunk)
        XCTAssertEqual(document.lines.map(\.kind), [.hunk, .addition])
        XCTAssertNil(document.lines[1].newLineNumber)
        XCTAssertNil(document.lines[1].oldLineNumber)
    }

    func testParserKeepsValidHunksOutOfIncompleteWarning() {
        let document = PhoneDexDiffParser.parse("@@ -2,1 +4,2 @@\n context\n+added")

        XCTAssertFalse(document.hasMalformedHunk)
        XCTAssertEqual(document.lines[1].oldLineNumber, 2)
        XCTAssertEqual(document.lines[1].newLineNumber, 4)
        XCTAssertEqual(document.lines[2].newLineNumber, 5)
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

    func testFiveThousandLineReviewPathStaysWithinInteractiveOpenBudget() {
        let patch = (0..<PhoneDexDiffParser.defaultLineLimit)
            .map { index in index.isMultiple(of: 2) ? "+added \(index)" : " context \(index)" }
            .joined(separator: "\n")

        let start = CFAbsoluteTimeGetCurrent()
        let document = PhoneDexDiffParser.parse(patch)
        let visibleDocument = document.document(showingContext: false)
        let elapsed = CFAbsoluteTimeGetCurrent() - start

        XCTAssertEqual(visibleDocument.lines.count, PhoneDexDiffParser.defaultLineLimit / 2)
        XCTAssertLessThan(
            elapsed,
            PhoneDexDiffParser.interactiveOpenBudget,
            "Parsing and preparing the bounded review document took \(elapsed)s"
        )
    }

    func testWorstCaseFiveThousandLineReviewPathStaysWithinInteractiveOpenBudget() {
        let payload = String(repeating: "x", count: 160)
        let patch = (0..<PhoneDexDiffParser.defaultLineLimit)
            .map { index in
                switch index % 4 {
                case 0: return "@@ -\(index + 1),1 +\(index + 1),1 @@"
                case 1: return "+added \(index) \(payload)"
                case 2: return "-removed \(index) \(payload)"
                default: return " context \(index) \(payload)"
                }
            }
            .joined(separator: "\n")

        let start = CFAbsoluteTimeGetCurrent()
        let document = PhoneDexDiffParser.parse(patch)
        let changedDocument = document.document(showingContext: false)
        let elapsed = CFAbsoluteTimeGetCurrent() - start

        XCTAssertEqual(document.lines.count, PhoneDexDiffParser.defaultLineLimit)
        XCTAssertEqual(changedDocument.lines.count, PhoneDexDiffParser.defaultLineLimit * 3 / 4)
        XCTAssertFalse(document.isTruncated)
        XCTAssertLessThan(
            elapsed,
            PhoneDexDiffParser.interactiveOpenBudget,
            "Worst-case parsing and projection took \(elapsed)s"
        )
    }

    func testChangingContextVisibilityReusesParsedLineIdentities() {
        let document = PhoneDexDiffParser.parse("@@ -1,2 +1,2 @@\n keep\n+new")

        XCTAssertEqual(document.document(showingContext: false).lines.map(\.id), [0, 2])
        XCTAssertEqual(document.document(showingContext: true).lines.map(\.id), [0, 1, 2])
    }
}
