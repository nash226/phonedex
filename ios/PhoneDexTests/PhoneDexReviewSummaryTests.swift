import XCTest
@testable import PhoneDex

final class PhoneDexReviewSummaryTests: XCTestCase {
    func testSummaryAggregatesFilesAndValidationResults() {
        let summary = PhoneDexReviewSummary(
            evidence: PhoneDexTaskEvidence(
                changedFiles: [
                    changedFile(path: "Sources/App.swift", additions: 12, deletions: 4),
                    changedFile(path: "README.md", additions: 3, deletions: 0)
                ],
                validations: [
                    validation(id: "build", status: "passed"),
                    validation(id: "tests", status: "passed", durationMs: 1200),
                    validation(id: "lint", status: "skipped")
                ]
            )
        )

        XCTAssertEqual(summary.files.count, 2)
        XCTAssertEqual(summary.totalAdditions, 15)
        XCTAssertEqual(summary.totalDeletions, 4)
        XCTAssertEqual(summary.passedValidationCount, 2)
        XCTAssertEqual(summary.skippedValidationCount, 1)
        XCTAssertEqual(summary.state, .ready)
        XCTAssertEqual(summary.fileCountLabel, "2 files changed")
        XCTAssertEqual(summary.lineChangeLabel, "+15  −4")
        XCTAssertEqual(summary.validationBreakdown, "2 passed · 1 skipped")
    }

    func testFailedValidationTakesPriorityOverRunningState() {
        let summary = PhoneDexReviewSummary(
            evidence: PhoneDexTaskEvidence(
                validations: [
                    validation(id: "tests", status: "running"),
                    validation(id: "lint", status: "failed")
                ]
            )
        )

        XCTAssertEqual(summary.state, .failed)
        XCTAssertEqual(summary.failedValidationCount, 1)
        XCTAssertEqual(summary.runningValidationCount, 1)
    }

    func testMissingValidationIsExplicitEvenWhenFilesExist() {
        let summary = PhoneDexReviewSummary(
            evidence: PhoneDexTaskEvidence(
                changedFiles: [changedFile(path: "Sources/App.swift", additions: 1, deletions: 0)]
            )
        )

        XCTAssertEqual(summary.state, .unavailable)
        XCTAssertTrue(summary.hasReviewContent)
        XCTAssertEqual(summary.validationBreakdown, "No checks reported")
    }

    func testUnknownValidationStatusIsNotPresentedAsComplete() {
        let summary = PhoneDexReviewSummary(
            evidence: PhoneDexTaskEvidence(
                validations: [validation(id: "custom", status: "blocked")]
            )
        )

        XCTAssertEqual(summary.state, .incomplete)
        XCTAssertEqual(summary.unknownValidationCount, 1)
        XCTAssertEqual(summary.validationBreakdown, "1 unknown")
    }

    func testEmptyEvidenceHasNoReviewContent() {
        let summary = PhoneDexReviewSummary(evidence: nil)

        XCTAssertEqual(summary.state, .unavailable)
        XCTAssertFalse(summary.hasReviewContent)
        XCTAssertEqual(summary.fileCountLabel, "0 files changed")
        XCTAssertEqual(summary.validationCountLabel, "0 checks")
    }

    private func changedFile(path: String, additions: Int, deletions: Int) -> PhoneDexChangedFile {
        PhoneDexChangedFile(
            path: path,
            status: "modified",
            sourceRef: "\(path)#L1-L10",
            summary: "Updated exported content",
            additions: additions,
            deletions: deletions,
            patch: nil,
            patchTruncated: nil
        )
    }

    private func validation(id: String, status: String, durationMs: Int? = nil) -> PhoneDexValidationReceipt {
        PhoneDexValidationReceipt(
            id: id,
            name: id.capitalized,
            status: status,
            summary: "Reported by the originating agent",
            durationMs: durationMs,
            completedAt: nil
        )
    }
}
