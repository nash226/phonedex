import SwiftUI
import UIKit

enum PhoneDexReviewState: Equatable {
    case ready
    case failed
    case running
    case incomplete
    case unavailable

    var title: String {
        switch self {
        case .ready: return "Validation complete"
        case .failed: return "Validation needs attention"
        case .running: return "Validation in progress"
        case .incomplete: return "Validation incomplete"
        case .unavailable: return "Validation not reported"
        }
    }

    var message: String {
        switch self {
        case .ready: return "Review the exported file summary and reported checks before continuing."
        case .failed: return "One or more exported checks failed. Review the details before treating this work as complete."
        case .running: return "The originating agent is still reporting checks. The summary may change after the next sync."
        case .incomplete: return "One or more exported checks use a status this app does not recognize yet. Review the raw result on the originating computer."
        case .unavailable: return "This agent has not exported validation results for this task."
        }
    }

    var symbol: String {
        switch self {
        case .ready: return "checkmark.shield.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .running: return "arrow.triangle.2.circlepath"
        case .incomplete: return "questionmark.circle"
        case .unavailable: return "questionmark.circle"
        }
    }

    var color: Color {
        switch self {
        case .ready: return .green
        case .failed: return .red
        case .running: return .orange
        case .incomplete: return .orange
        case .unavailable: return .secondary
        }
    }
}

struct PhoneDexReviewSummary: Equatable {
    let files: [PhoneDexChangedFile]
    let validations: [PhoneDexValidationReceipt]
    let totalAdditions: Int
    let totalDeletions: Int
    let passedValidationCount: Int
    let failedValidationCount: Int
    let runningValidationCount: Int
    let skippedValidationCount: Int
    let unknownValidationCount: Int
    let state: PhoneDexReviewState

    init(evidence: PhoneDexTaskEvidence?) {
        files = evidence?.changedFiles ?? []
        validations = evidence?.validations ?? []
        totalAdditions = files.reduce(0) { $0 + ($1.additions ?? 0) }
        totalDeletions = files.reduce(0) { $0 + ($1.deletions ?? 0) }
        passedValidationCount = validations.count { $0.status == "passed" }
        failedValidationCount = validations.count { $0.status == "failed" }
        runningValidationCount = validations.count { $0.status == "running" }
        skippedValidationCount = validations.count { $0.status == "skipped" }
        unknownValidationCount = validations.count {
            !["passed", "failed", "running", "skipped"].contains($0.status)
        }

        if failedValidationCount > 0 {
            state = .failed
        } else if runningValidationCount > 0 {
            state = .running
        } else if unknownValidationCount > 0 {
            state = .incomplete
        } else if !validations.isEmpty {
            state = .ready
        } else {
            state = .unavailable
        }
    }

    var hasReviewContent: Bool {
        !files.isEmpty || !validations.isEmpty
    }

    var fileCountLabel: String {
        "\(files.count) file\(files.count == 1 ? "" : "s") changed"
    }

    var lineChangeLabel: String {
        "+\(totalAdditions)  −\(totalDeletions)"
    }

    var validationCountLabel: String {
        "\(validations.count) check\(validations.count == 1 ? "" : "s")"
    }

    var validationBreakdown: String {
        var parts = [String]()
        if passedValidationCount > 0 { parts.append("\(passedValidationCount) passed") }
        if failedValidationCount > 0 { parts.append("\(failedValidationCount) failed") }
        if runningValidationCount > 0 { parts.append("\(runningValidationCount) running") }
        if skippedValidationCount > 0 { parts.append("\(skippedValidationCount) skipped") }
        if unknownValidationCount > 0 { parts.append("\(unknownValidationCount) unknown") }
        return parts.isEmpty ? "No checks reported" : parts.joined(separator: " · ")
    }
}

struct PhoneDexReviewSummaryView: View {
    let task: PhoneDexTask
    @Environment(\.dismiss) private var dismiss
    @State private var selectedDiffFile: PhoneDexChangedFile?

    private var summary: PhoneDexReviewSummary {
        PhoneDexReviewSummary(evidence: task.evidence)
    }

    private var diffFiles: [PhoneDexChangedFile] {
        summary.files.filter(\.hasPatch)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 18) {
                    reviewHeader
                    reviewMetrics
                    validationsSection
                    filesSection
                    privacyNote
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .background(Color(uiColor: .systemBackground))
            .navigationTitle("Review changes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(item: $selectedDiffFile) { file in
                PhoneDexDiffViewer(files: diffFiles, initialFileID: file.id)
            }
        }
    }

    private var reviewHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(summary.state.title, systemImage: summary.state.symbol)
                .font(.headline)
                .foregroundStyle(summary.state.color)

            Text(summary.state.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)

            Text(task.title)
                .font(.title3.weight(.semibold))

            HStack(spacing: 12) {
                Label(task.displayMachine, systemImage: "desktopcomputer")
                Label(task.displayWorkspace, systemImage: "folder")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let repository = task.repository, !repository.isEmpty {
                Label(repository, systemImage: "shippingbox")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var reviewMetrics: some View {
        HStack(spacing: 10) {
            metric(summary.fileCountLabel, summary.lineChangeLabel, symbol: "doc.text")
            metric(summary.validationCountLabel, summary.validationBreakdown, symbol: "checkmark.shield")
        }
    }

    private func metric(_ title: String, _ detail: String, symbol: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Image(systemName: symbol)
                .foregroundStyle(.tint)
            Text(title)
                .font(.subheadline.weight(.semibold))
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, minHeight: 74, alignment: .topLeading)
        .padding(12)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var validationsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeading("Validation results", count: summary.validations.count, symbol: "checkmark.shield")

            if summary.validations.isEmpty {
                ContentUnavailableView {
                    Label("No validation results", systemImage: "checkmark.shield")
                } description: {
                    Text("The originating agent has not exported checks for this task.")
                }
                .frame(maxWidth: .infinity)
            } else {
                ForEach(summary.validations) { validation in
                    validationRow(validation)
                }
            }
        }
    }

    @ViewBuilder
    private var filesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            sectionHeading("Changed files", count: summary.files.count, symbol: "doc.text")

            if summary.files.isEmpty {
                ContentUnavailableView {
                    Label("No changed files", systemImage: "doc.text.magnifyingglass")
                } description: {
                    Text("The originating agent has not exported file-level review metadata.")
                }
                .frame(maxWidth: .infinity)
            } else {
                ForEach(summary.files) { file in
                    fileRow(file)
                }
            }
        }
    }

    private func sectionHeading(_ title: String, count: Int, symbol: String) -> some View {
        Label("\(title) · \(count)", systemImage: symbol)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.blue)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private func fileRow(_ file: PhoneDexChangedFile) -> some View {
        let content = VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: file.status == "deleted" ? "minus.circle" : file.hasPatch ? "doc.text.magnifyingglass" : "doc.text")
                    .foregroundStyle(file.status == "deleted" ? .red : .secondary)
                Text(file.path)
                    .font(.subheadline.weight(.medium))
                    .lineLimit(2)
                Spacer(minLength: 0)
                Text(file.displayStatus)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let summary = file.summary, !summary.isEmpty {
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 10) {
                Text("+\(file.additions ?? 0)")
                    .foregroundStyle(.green)
                Text("−\(file.deletions ?? 0)")
                    .foregroundStyle(.red)
                if file.hasPatch {
                    Label("View diff", systemImage: "arrow.up.right")
                        .foregroundStyle(.tint)
                } else {
                    Text("Patch not exported")
                        .foregroundStyle(.tertiary)
                }
            }
            .font(.caption.weight(.medium).monospacedDigit())

            if let sourceRef = file.sourceRef, !sourceRef.isEmpty {
                Text(sourceRef)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.tertiary)
                    .textSelection(.enabled)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)

        if file.hasPatch {
            Button {
                selectedDiffFile = file
            } label: {
                content
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the exported patch for this file")
        } else {
            content
        }
    }

    private func validationRow(_ validation: PhoneDexValidationReceipt) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: validation.symbol)
                .foregroundStyle(validation.status == "failed" ? .red : validation.status == "passed" ? .green : .secondary)
                .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(validation.name)
                        .font(.subheadline.weight(.medium))
                    Spacer(minLength: 8)
                    Text(validation.displayStatus)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let summary = validation.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if let durationMs = validation.durationMs {
                    Text("Completed in \(durationMs) ms")
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var privacyNote: some View {
        Text("Evidence is exported by the originating agent. Source references are relative metadata and do not grant iPhone file access; artifacts are not downloaded or executed here.")
            .font(.caption)
            .foregroundStyle(.tertiary)
            .accessibilityElement(children: .combine)
    }
}
