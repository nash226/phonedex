import SwiftUI
import UIKit

enum PhoneDexDiffLineKind: Equatable {
    case context
    case addition
    case deletion
    case hunk
    case metadata

    var label: String {
        switch self {
        case .context: return "Context"
        case .addition: return "Added"
        case .deletion: return "Removed"
        case .hunk: return "Hunk"
        case .metadata: return "Diff metadata"
        }
    }
}

struct PhoneDexDiffLine: Equatable, Identifiable {
    let id: Int
    let text: String
    let kind: PhoneDexDiffLineKind
    let oldLineNumber: Int?
    let newLineNumber: Int?
}

struct PhoneDexDiffDocument: Equatable {
    let lines: [PhoneDexDiffLine]
    let totalLineCount: Int
    let isTruncated: Bool
    let hasMalformedHunk: Bool

    func document(showingContext: Bool) -> PhoneDexDiffDocument {
        guard !showingContext else { return self }
        return PhoneDexDiffDocument(
            lines: lines.filter { $0.kind != .context },
            totalLineCount: totalLineCount,
            isTruncated: isTruncated,
            hasMalformedHunk: hasMalformedHunk
        )
    }
}

enum PhoneDexDiffParser {
    static let defaultLineLimit = 5_000
    static let interactiveOpenBudget: TimeInterval = 1.0

    static func parse(_ patch: String, lineLimit: Int = defaultLineLimit) -> PhoneDexDiffDocument {
        // Keep source rows as substrings and materialize only rows that can be
        // rendered. This avoids an extra copy when a large export is received
        // on an older phone.
        let rawLines = patch.split(separator: "\n", omittingEmptySubsequences: false)
        let boundedLimit = max(1, lineLimit)
        var oldLineNumber: Int?
        var newLineNumber: Int?
        var hasMalformedHunk = false
        var parsed = [PhoneDexDiffLine]()

        for (index, rawLine) in rawLines.enumerated() {
            guard parsed.count < boundedLimit else { break }
            let line = parseLine(
                String(rawLine),
                id: index,
                oldLineNumber: &oldLineNumber,
                newLineNumber: &newLineNumber,
                hasMalformedHunk: &hasMalformedHunk
            )
            parsed.append(line)
        }

        return PhoneDexDiffDocument(
            lines: parsed,
            totalLineCount: rawLines.count,
            isTruncated: rawLines.count > parsed.count,
            hasMalformedHunk: hasMalformedHunk
        )
    }

    private static func parseLine(
        _ text: String,
        id: Int,
        oldLineNumber: inout Int?,
        newLineNumber: inout Int?,
        hasMalformedHunk: inout Bool
    ) -> PhoneDexDiffLine {
        if text.hasPrefix("@@") {
            if !updateLineNumbers(from: text, oldLineNumber: &oldLineNumber, newLineNumber: &newLineNumber) {
                hasMalformedHunk = true
            }
            return PhoneDexDiffLine(id: id, text: text, kind: .hunk, oldLineNumber: nil, newLineNumber: nil)
        }

        if text.hasPrefix("+") && !text.hasPrefix("+++") {
            let line = PhoneDexDiffLine(id: id, text: text, kind: .addition, oldLineNumber: nil, newLineNumber: newLineNumber)
            newLineNumber = newLineNumber.map { $0 + 1 }
            return line
        }

        if text.hasPrefix("-") && !text.hasPrefix("---") {
            let line = PhoneDexDiffLine(id: id, text: text, kind: .deletion, oldLineNumber: oldLineNumber, newLineNumber: nil)
            oldLineNumber = oldLineNumber.map { $0 + 1 }
            return line
        }

        if text.hasPrefix(" ") {
            let line = PhoneDexDiffLine(id: id, text: text, kind: .context, oldLineNumber: oldLineNumber, newLineNumber: newLineNumber)
            oldLineNumber = oldLineNumber.map { $0 + 1 }
            newLineNumber = newLineNumber.map { $0 + 1 }
            return line
        }

        return PhoneDexDiffLine(id: id, text: text, kind: .metadata, oldLineNumber: nil, newLineNumber: nil)
    }

    private static func updateLineNumbers(
        from text: String,
        oldLineNumber: inout Int?,
        newLineNumber: inout Int?
    ) -> Bool {
        let numbers = text.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: true)
        guard numbers.count >= 3 else {
            oldLineNumber = nil
            newLineNumber = nil
            return false
        }

        let parsedOldLineNumber = lineNumber(from: numbers[1])
        let parsedNewLineNumber = lineNumber(from: numbers[2])
        guard let parsedOldLineNumber, let parsedNewLineNumber else {
            oldLineNumber = nil
            newLineNumber = nil
            return false
        }
        oldLineNumber = parsedOldLineNumber
        newLineNumber = parsedNewLineNumber
        return true
    }

    private static func lineNumber(from range: Substring) -> Int? {
        let value = range.dropFirst().split(separator: ",", maxSplits: 1).first
        return value.flatMap { Int($0) }
    }
}

struct PhoneDexDiffViewer: View {
    let files: [PhoneDexChangedFile]
    @Environment(\.dismiss) private var dismiss
    @State private var selectedFileID: String

    init(files: [PhoneDexChangedFile], initialFileID: String) {
        self.files = files
        _selectedFileID = State(initialValue: files.contains { $0.id == initialFileID } ? initialFileID : files.first?.id ?? "")
    }

    private var selectedFile: PhoneDexChangedFile? {
        files.first { $0.id == selectedFileID }
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if files.count > 1 {
                    Picker("Changed file", selection: $selectedFileID) {
                        ForEach(files) { file in
                            Text(file.path).tag(file.id)
                        }
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 10)
                    .background(Color(uiColor: .secondarySystemBackground))
                    .accessibilityLabel("Changed file")
                }

                if let selectedFile {
                    PhoneDexDiffContent(file: selectedFile)
                        // Reset the parsed 5,000-line cache when selection
                        // changes so a reused SwiftUI identity cannot show
                        // the previous file's projection.
                        .id(selectedFile.id)
                } else {
                    ContentUnavailableView("No patch available", systemImage: "doc.text.magnifyingglass")
                }
            }
            .navigationTitle("Diff review")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
                if let patch = selectedFile?.patch, !patch.isEmpty {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button("Copy diff", systemImage: "doc.on.doc") {
                                UIPasteboard.general.string = patch
                            }
                            ShareLink(item: patch) {
                                Label("Share diff", systemImage: "square.and.arrow.up")
                            }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                        .accessibilityLabel("Diff actions")
                    }
                }
            }
        }
    }
}

private struct PhoneDexDiffContent: View {
    let file: PhoneDexChangedFile
    @State private var showingContext = false

    @State private var parsedDocument: PhoneDexDiffDocument
    @State private var document: PhoneDexDiffDocument

    init(file: PhoneDexChangedFile) {
        self.file = file
        let parsed = PhoneDexDiffParser.parse(file.patch ?? "")
        _parsedDocument = State(initialValue: parsed)
        _document = State(initialValue: parsed.document(showingContext: false))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: file.status == "deleted" ? "minus.circle" : "doc.text.magnifyingglass")
                    .foregroundStyle(file.status == "deleted" ? .red : .secondary)
                Text(file.path)
                    .font(.headline)
                    .lineLimit(2)
                Spacer(minLength: 0)
                Text("+\(file.additions ?? 0)  −\(file.deletions ?? 0)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)

            if file.patchTruncated == true || document.isTruncated {
                Label("This patch is truncated to keep mobile review responsive. Use the originating computer for the complete diff.", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .accessibilityElement(children: .combine)
            }

            if document.hasMalformedHunk {
                Label("This diff includes an incomplete hunk header, so some line numbers may be unavailable. Use the originating computer for the complete diff.", systemImage: "questionmark.folder")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
                    .accessibilityElement(children: .combine)
            }

            Button {
                let nextValue = !showingContext
                showingContext = nextValue
                document = parsedDocument.document(showingContext: nextValue)
            } label: {
                Label(
                    showingContext ? "Hide unchanged context" : "Show unchanged context",
                    systemImage: showingContext ? "rectangle.compress.vertical" : "rectangle.expand.vertical"
                )
            }
            .buttonStyle(.bordered)
            .controlSize(.small)
            .padding(.horizontal, 16)
            .padding(.bottom, 8)
            .accessibilityHint("Changes whether unchanged lines around edits are visible")

            ScrollView([.horizontal, .vertical]) {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(document.lines) { line in
                        PhoneDexDiffLineView(line: line)
                            .equatable()
                    }
                }
                .padding(.vertical, 8)
            }
            .background(Color(uiColor: .systemBackground))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .privacySensitive()
    }
}

private struct PhoneDexDiffLineView: View, Equatable {
    let line: PhoneDexDiffLine

    private var background: Color {
        switch line.kind {
        case .addition: return Color.green.opacity(0.16)
        case .deletion: return Color.red.opacity(0.16)
        case .hunk: return Color.blue.opacity(0.14)
        case .context, .metadata: return Color.clear
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            Text(line.oldLineNumber.map(String.init) ?? "·")
                .frame(width: 34, alignment: .trailing)
            Text(line.newLineNumber.map(String.init) ?? "·")
                .frame(width: 34, alignment: .trailing)
            Text(line.text.isEmpty ? " " : line.text)
                .fixedSize(horizontal: true, vertical: false)
        }
        .font(.system(.footnote, design: .monospaced))
        .foregroundStyle(line.kind == .metadata ? .secondary : .primary)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(background)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(line.kind.label): \(line.text.isEmpty ? "blank line" : line.text)")
    }
}
