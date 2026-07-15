import SwiftUI
import UIKit

struct ContentView: View {
    @StateObject private var model: PhoneDexAppModel
    @Environment(\.scenePhase) private var scenePhase

    init(settings: PhoneDexSettings) {
        _model = StateObject(wrappedValue: PhoneDexAppModel(settings: settings))
    }

    var body: some View {
        TabView {
            PhoneDexChatsView(model: model)
                .tabItem { Label("Chats", systemImage: "bubble.left.and.bubble.right") }

            PhoneDexProjectsView(model: model)
                .tabItem { Label("Projects", systemImage: "folder") }

            PhoneDexBrowserView()
                .tabItem { Label("Browser", systemImage: "safari") }

            PhoneDexDevicesView(model: model)
                .tabItem { Label("Devices", systemImage: "desktopcomputer") }

            PhoneDexSettingsView(model: model)
                .tabItem { Label("Settings", systemImage: "gearshape") }
        }
        .tint(.blue)
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            model.loadNotificationReplyResult()
            Task { await model.refresh() }
        }
        .onReceive(NotificationCenter.default.publisher(for: NotificationReplyResult.didChange)) { _ in
            model.loadNotificationReplyResult()
        }
    }
}

private struct PhoneDexChatsView: View {
    @ObservedObject var model: PhoneDexAppModel
    @State private var filter = PhoneDexTaskFilter()

    private var filteredTasks: [PhoneDexTask] {
        filter.filteredTasks(model.tasks)
    }

    var body: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                Picker("Conversation scope", selection: $filter.scope) {
                    ForEach(PhoneDexChatScope.allCases) { scope in
                        Text(scope.title).tag(scope)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityLabel("Conversation scope")
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(.bar)

                Divider()

                List(selection: $model.selectedTaskID) {
                    Section {
                        ForEach(filteredTasks) { task in
                            NavigationLink(value: task.id) {
                                PhoneDexTaskRow(task: task)
                            }
                        }
                    } header: {
                        PhoneDexConnectionHeader(state: model.connectionState)
                    }
                }
                .listStyle(.plain)
                .overlay { emptyState }
                .refreshable { await model.refresh() }
            }
            .navigationTitle("PhoneDex")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh conversations")
                }

                ToolbarItem(placement: .topBarTrailing) {
                    filterMenu
                }
            }
            .searchable(text: $filter.searchText, placement: .navigationBarDrawer(displayMode: .always), prompt: "Search conversations")
            .onChange(of: filter) { _, _ in keepSelectionVisible() }
            .onChange(of: model.tasks) { _, _ in keepSelectionVisible() }
        } detail: {
            if let task = model.selectedTask {
                PhoneDexTaskDetailView(task: task, model: model)
                    .id(task.id)
            } else {
                ContentUnavailableView(
                    "Choose a conversation",
                    systemImage: "sidebar.left",
                    description: Text("Select Codex work from the sidebar.")
                )
            }
        }
    }

    @ViewBuilder
    private var emptyState: some View {
        if filteredTasks.isEmpty {
            if model.tasks.isEmpty && model.connectionState.blocksEmptyContent {
                PhoneDexSyncUnavailableView(state: model.connectionState) {
                    Task { await model.refresh() }
                }
            } else {
                ContentUnavailableView {
                    Label(filter.scope.emptyTitle, systemImage: "bubble.left.and.bubble.right")
                } description: {
                    Text(filter.hasFilters ? "Try a different search or filter." : filter.scope.emptyDescription)
                } actions: {
                    if filter.hasFilters {
                        Button("Clear filters") { clearFilters() }
                    }
                }
            }
        }
    }

    private var filterMenu: some View {
        Menu {
            Section("Machine") {
                Picker("Machine", selection: $filter.machineName) {
                    Text("All machines").tag(nil as String?)
                    ForEach(filter.machineOptions(from: model.tasks), id: \.self) { machine in
                        Text(machine).tag(machine as String?)
                    }
                }
            }

            Section("Workspace") {
                Picker("Workspace", selection: $filter.workspaceName) {
                    Text("All workspaces").tag(nil as String?)
                    ForEach(filter.workspaceOptions(from: model.tasks), id: \.self) { workspace in
                        Text(workspace).tag(workspace as String?)
                    }
                }
            }

            if filter.hasFilters {
                Divider()
                Button("Clear filters", systemImage: "line.3.horizontal.decrease.circle") {
                    clearFilters()
                }
            }
        } label: {
            Image(systemName: filter.hasFilters ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .accessibilityLabel(filter.hasFilters ? "Conversation filters active" : "Filter conversations")
    }

    private func clearFilters() {
        filter.searchText = ""
        filter.machineName = nil
        filter.workspaceName = nil
    }

    private func keepSelectionVisible() {
        guard let selectedTaskID = model.selectedTaskID,
              filteredTasks.contains(where: { $0.id == selectedTaskID })
        else {
            model.selectedTaskID = filteredTasks.first?.id
            return
        }
    }
}

struct PhoneDexTaskRow: View {
    let task: PhoneDexTask

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.blue.opacity(0.14))
                Image(systemName: "terminal.fill")
                    .foregroundStyle(.blue)
            }
            .frame(width: 42, height: 42)

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(task.title)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    if let date = task.displayDate {
                        Text(date, style: .relative)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Text(task.text)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)

                Label(task.displayStatus, systemImage: task.statusSymbol)
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Label("\(task.displayWorkspace) · \(task.displayMachine)", systemImage: "desktopcomputer")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

struct PhoneDexConnectionHeader: View {
    let state: PhoneDexAppModel.ConnectionState

    var body: some View {
        HStack(alignment: .top, spacing: 7) {
            Image(systemName: symbol)
                .foregroundStyle(color)
                .frame(width: 14)

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                if let detail {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .textCase(nil)
        .font(.caption)
        .foregroundStyle(.secondary)
        .accessibilityElement(children: .combine)
    }

    private var color: Color {
        switch state {
        case .online: return .green
        case .stale, .offline, .partial: return .orange
        case .revoked, .incompatible, .failed: return .red
        case .syncing: return .blue
        case .idle: return .secondary
        }
    }

    private var label: String {
        switch state {
        case .online: return "Hub connected"
        case .stale: return "Cached data is stale"
        case .offline: return "Working offline"
        case .revoked: return "Hub access revoked"
        case .incompatible: return "Hub needs an update"
        case .partial(let dataSet, _, _): return "Partial sync · \(dataSet.title.capitalized) available"
        case .failed: return "Refresh failed"
        case .syncing: return "Loading PhoneDex data"
        case .idle: return "Waiting for hub"
        }
    }

    private var symbol: String {
        switch state {
        case .online: return "checkmark.circle.fill"
        case .stale: return "clock.badge.exclamationmark.fill"
        case .offline: return "wifi.exclamationmark"
        case .revoked: return "lock.slash.fill"
        case .incompatible: return "arrow.triangle.2.circlepath.circle"
        case .partial: return "exclamationmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .syncing: return "arrow.triangle.2.circlepath"
        case .idle: return "circle.dashed"
        }
    }

    private var detail: String? {
        switch state {
        case .online(let date): return "Synced \(relative(date))"
        case .stale(let date): return "Last synced \(relative(date)); refresh when the hub is reachable."
        case .offline(let date): return date.map { "Last synced \(relative($0))" } ?? "No cached sync yet"
        case .incompatible(let message, let date): return date.map { "\(message) Last read \(relative($0))." } ?? message
        case .partial(_, let message, let date): return date.map { "\(message) Last complete sync \(relative($0))." } ?? message
        case .failed(let message, let date): return date.map { "\(message) Last synced \(relative($0))." } ?? message
        case .revoked: return "Re-pair this iPhone before sending replies."
        case .syncing, .idle: return nil
        }
    }

    private func relative(_ date: Date) -> String {
        RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}

struct PhoneDexSyncUnavailableView: View {
    let state: PhoneDexAppModel.ConnectionState
    let retry: () -> Void

    var body: some View {
        switch state {
        case .syncing:
            VStack(spacing: 12) {
                ProgressView()
                    .controlSize(.large)
                Text("Loading PhoneDex data")
                    .font(.headline)
                Text("The latest conversations and device status will appear here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .accessibilityElement(children: .combine)
        default:
            ContentUnavailableView {
                Label(title, systemImage: symbol)
            } description: {
                Text(message)
            } actions: {
                Button("Try again", action: retry)
            }
        }
    }

    private var title: String {
        switch state {
        case .stale: return "Stale cached data"
        case .offline: return "Working offline"
        case .revoked: return "Access revoked"
        case .incompatible: return "Hub needs an update"
        case .partial(let dataSet, _, _): return "Only \(dataSet.title) are available"
        case .failed: return "Couldn’t refresh"
        case .idle, .online, .syncing: return "PhoneDex is ready"
        }
    }

    private var symbol: String {
        switch state {
        case .stale: return "clock.badge.exclamationmark.fill"
        case .offline: return "wifi.exclamationmark"
        case .revoked: return "lock.slash.fill"
        case .incompatible: return "arrow.triangle.2.circlepath.circle"
        case .partial: return "exclamationmark.circle.fill"
        case .failed: return "exclamationmark.triangle.fill"
        case .idle, .online, .syncing: return "bubble.left.and.bubble.right"
        }
    }

    private var message: String {
        switch state {
        case .stale(let date):
            return "The hub cannot be reached and the cached data is from \(relative(date)). Refresh before relying on current task or device state."
        case .offline(let date):
            return date.map { "The hub cannot be reached. Cached data from \(relative($0)) remains available when it exists." } ?? "The hub cannot be reached and no cached data is available yet."
        case .revoked:
            return "The hub no longer trusts this iPhone. Re-pair it before relying on task state or sending replies."
        case .incompatible(let message, _):
            return message
        case .partial(let dataSet, let message, _):
            return "\(message) Previously loaded data remains visible while \(dataSet.title) recover."
        case .failed(let message, _):
            return message
        case .idle, .online, .syncing:
            return "Refresh to check the hub."
        }
    }

    private func relative(_ date: Date) -> String {
        RelativeDateTimeFormatter().localizedString(for: date, relativeTo: Date())
    }
}

struct PhoneDexTaskDetailView: View {
    let task: PhoneDexTask
    @ObservedObject var model: PhoneDexAppModel
    @State private var draft: String
    @State private var showNewActivity = false
    @State private var draftSaveTask: Task<Void, Never>?
    @State private var hasRestoredReadingPosition = false
    @FocusState private var composerFocused: Bool

    init(task: PhoneDexTask, model: PhoneDexAppModel) {
        self.task = task
        self.model = model
        _draft = State(initialValue: model.draft(for: task.id))
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 20) {
                    detailSection(.header) { taskHeader }
                    detailSection(.status) { statusSummary }
                    detailSection(.transcript) { transcript }
                    detailSection(.activity) { activity }
                    detailSection(.evidence) { evidence }
                    replyStatus

                    Color.clear
                        .frame(height: 1)
                        .id(PhoneDexTaskDetailAnchor.bottom.rawValue)
                        .background(anchorPreference(.bottom))
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 24)
            }
            .coordinateSpace(name: "task-detail-scroll")
            .background(Color(uiColor: .systemBackground))
            .overlay(alignment: .bottom) {
                if showNewActivity {
                    Button {
                        withAnimation(.default) {
                            proxy.scrollTo(PhoneDexTaskDetailAnchor.bottom.rawValue, anchor: .bottom)
                        }
                        showNewActivity = false
                    } label: {
                        Label("Show new activity", systemImage: "arrow.down")
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .shadow(radius: 5, y: 2)
                    .padding(.bottom, 12)
                    .accessibilityHint("Moves to the latest task activity")
                }
            }
            .onChange(of: task.updatedAt) { _, _ in
                showNewActivity = true
                UIAccessibility.post(
                    notification: .announcement,
                    argument: "New activity available in \(task.title)."
                )
            }
            .onPreferenceChange(PhoneDexTaskDetailAnchorPreferenceKey.self) { values in
                guard hasRestoredReadingPosition else { return }
                model.updateReadingPosition(currentAnchor(in: values), for: task.id)
            }
            .task(id: task.id) {
                hasRestoredReadingPosition = false
                guard let position = model.readingPosition(for: task.id) else {
                    hasRestoredReadingPosition = true
                    return
                }
                await Task.yield()
                guard !Task.isCancelled else { return }
                withAnimation(.none) {
                    proxy.scrollTo(position, anchor: .top)
                }
                hasRestoredReadingPosition = true
            }
        }
        .navigationTitle(task.displayWorkspace)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { composer }
        .onDisappear {
            draftSaveTask?.cancel()
            model.updateDraft(draft, for: task.id)
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Copy response", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = task.text
                    }
                    if let cwd = task.cwd {
                        Button("Copy workspace path", systemImage: "folder") {
                            UIPasteboard.general.string = cwd
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Conversation actions")
            }
        }
    }

    private func detailSection<Content: View>(
        _ anchor: PhoneDexTaskDetailAnchor,
        @ViewBuilder content: () -> Content
    ) -> some View {
        content()
            .id(anchor.rawValue)
            .background(anchorPreference(anchor))
    }

    private func anchorPreference(_ anchor: PhoneDexTaskDetailAnchor) -> some View {
        GeometryReader { proxy in
            Color.clear.preference(
                key: PhoneDexTaskDetailAnchorPreferenceKey.self,
                value: [anchor.rawValue: proxy.frame(in: .named("task-detail-scroll")).minY]
            )
        }
    }

    private func currentAnchor(in values: [String: CGFloat]) -> String? {
        let visible = values.filter { $0.value <= 80 }
        return (visible.max { lhs, rhs in lhs.value < rhs.value } ?? values.min { lhs, rhs in lhs.value < rhs.value })?.key
    }

    private var taskHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label(task.displayStatus, systemImage: task.statusSymbol)
                    .foregroundStyle(statusColor)
                Spacer()
                if let date = task.lastUpdatedDate {
                    Text(date, style: .relative)
                        .foregroundStyle(.secondary)
                }
            }
            .font(.subheadline.weight(.semibold))

            Text(task.title)
                .font(.title2.weight(.bold))

            HStack(spacing: 12) {
                Label(task.displayMachine, systemImage: "desktopcomputer")
                Label(task.displayWorkspace, systemImage: "folder")
            }
            .font(.caption)
            .foregroundStyle(.secondary)

            if let branch = task.branch, !branch.isEmpty {
                Label(branch, systemImage: "arrow.triangle.branch")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
    }

    private var statusSummary: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(statusSummaryTitle)
                .font(.headline)
            Text("Latest known state from " + task.displayMachine + ". Refresh PhoneDex before relying on a changing task.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var transcript: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Transcript", systemImage: "text.bubble")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.blue)

            if task.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                Text("No response text was exported for this task.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
                    .background(Color(uiColor: .secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Codex", systemImage: "sparkles")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)

                    Text(task.text)
                        .font(.body)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .padding(14)
                .background(Color(uiColor: .secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }

            Text("The current bridge provides the latest response. Structured session messages appear when the originating agent exports them.")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    private var activity: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Activity", systemImage: "timeline.selection")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.blue)

            if task.activity.isEmpty {
                Text("No timestamped activity was exported.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(task.activity) { item in
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: item.symbol)
                                .foregroundStyle(.secondary)
                                .frame(width: 20)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.subheadline.weight(.medium))
                                if let detail = item.detail {
                                    Text(detail)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Text(item.date, style: .date)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(.vertical, 8)
                        .accessibilityElement(children: .combine)
                    }
                }
            }
        }
    }

    private var evidence: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Evidence", systemImage: "checklist")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.blue)

            if let repository = task.repository, !repository.isEmpty {
                evidenceRow("Repository", repository, symbol: "shippingbox")
            }
            if let branch = task.branch, !branch.isEmpty {
                evidenceRow("Branch", branch, symbol: "arrow.triangle.branch")
            }
            if task.repository == nil && task.branch == nil {
                ContentUnavailableView {
                    Label("No exported evidence", systemImage: "doc.text.magnifyingglass")
                } description: {
                    Text("Changed files, diffs, and validation results are not available from this agent yet.")
                }
                .frame(maxWidth: .infinity)
            } else {
                Text("Files, diffs, and validation results are shown only when the agent exports them.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func evidenceRow(_ title: String, _ value: String, symbol: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.subheadline)
                    .lineLimit(2)
                    .textSelection(.enabled)
            }
        } icon: {
            Image(systemName: symbol)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Color(uiColor: .secondarySystemBackground))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var replyStatus: some View {
        switch model.replyState {
        case .sent(let prompt):
            Label("Sent: \(prompt)", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
                .font(.subheadline)
        case .failed(let error):
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
                .font(.subheadline)
        case .sending:
            HStack(spacing: 8) {
                ProgressView().controlSize(.small)
                Text("Sending reply…")
            }
            .font(.subheadline)
            .foregroundStyle(.secondary)
        case .idle:
            EmptyView()
        }
    }

    private var composer: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                quickReply("What's next", icon: "arrow.right.circle", choice: .okayWhatsNext)
                quickReply("Do that", icon: "checkmark.circle", choice: .letsDoThat)
                Spacer(minLength: 0)
            }

            HStack(alignment: .bottom, spacing: 10) {
                TextField("Message Codex", text: $draft, axis: .vertical)
                    .lineLimit(1...5)
                    .focused($composerFocused)
                    .submitLabel(.send)
                    .onSubmit { sendDraft() }
                    .onChange(of: draft) { _, newValue in
                        draftSaveTask?.cancel()
                        draftSaveTask = Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(350))
                            guard !Task.isCancelled else { return }
                            model.updateDraft(newValue, for: task.id)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color(uiColor: .secondarySystemBackground))
                    .clipShape(RoundedRectangle(cornerRadius: 8))

                Button(action: sendDraft) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 32))
                }
                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.replyState == .sending)
                .accessibilityLabel("Send reply")
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 6)
        .background(.bar)
    }

    private func quickReply(_ title: String, icon: String, choice: PhoneDexReplyChoice) -> some View {
        Button {
            Task { _ = await model.send(choice, to: task) }
        } label: {
            Label(title, systemImage: icon)
                .font(.caption.weight(.semibold))
        }
        .buttonStyle(.bordered)
        .disabled(model.replyState == .sending)
        .accessibilityHint("Sends the exact suggested reply to this task")
    }

    private func sendDraft() {
        let prompt = draft
        Task {
            if await model.send(.custom, prompt: prompt, to: task) {
                draft = ""
                composerFocused = false
            }
        }
    }

    private var statusSummaryTitle: String {
        switch task.status {
        case "needs_input": return "Codex is waiting for your answer"
        case "awaiting_approval": return "This task is waiting for approval"
        case "needs_review": return "This task is ready for review"
        case "running": return "Codex is still working"
        case "failed": return "Codex reported a failure"
        case "cancelled": return "This task was cancelled"
        case "completed": return "Codex reported completion"
        default: return "Task state is not yet known"
        }
    }

    private var statusColor: Color {
        switch task.status {
        case "completed": return .green
        case "failed", "awaiting_approval", "needs_input", "needs_review": return .orange
        default: return .blue
        }
    }
}

private enum PhoneDexTaskDetailAnchor: String {
    case header
    case status
    case transcript
    case activity
    case evidence
    case bottom
}

private struct PhoneDexTaskDetailAnchorPreferenceKey: PreferenceKey {
    static var defaultValue: [String: CGFloat] = [:]

    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue(), uniquingKeysWith: { _, latest in latest })
    }
}

private struct PhoneDexProjectsView: View {
    @ObservedObject var model: PhoneDexAppModel

    var body: some View {
        NavigationStack {
            List(model.projects) { project in
                NavigationLink {
                    PhoneDexWorkspaceDetailView(project: project, model: model)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "folder.fill")
                            .foregroundStyle(.purple)
                            .frame(width: 32)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(project.name).font(.headline)
                            Text("\(project.machineName) · \(project.tasks.count) conversation\(project.tasks.count == 1 ? "" : "s")")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if project.activeTaskCount > 0 || project.attentionTaskCount > 0 {
                                Text(workspaceStatus(project))
                                    .font(.caption2.weight(.medium))
                                    .foregroundStyle(project.attentionTaskCount > 0 ? .orange : .blue)
                            }
                            if let path = project.path {
                                Text(path)
                                    .font(.caption2)
                                    .foregroundStyle(.tertiary)
                                    .lineLimit(1)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Projects")
            .refreshable { await model.refresh() }
            .overlay {
                if model.projects.isEmpty {
                    if model.tasks.isEmpty && model.connectionState.blocksEmptyContent {
                        PhoneDexSyncUnavailableView(state: model.connectionState) {
                            Task { await model.refresh() }
                        }
                    } else {
                        ContentUnavailableView("No projects", systemImage: "folder")
                    }
                }
            }
        }
    }

    private func workspaceStatus(_ project: PhoneDexProject) -> String {
        if project.attentionTaskCount > 0 {
            return "\(project.attentionTaskCount) need attention"
        }
        return "\(project.activeTaskCount) active"
    }
}

private struct PhoneDexDevicesView: View {
    @ObservedObject var model: PhoneDexAppModel

    var body: some View {
        NavigationStack {
            List(model.devices) { device in
                NavigationLink {
                    PhoneDexDeviceDetailView(device: device, model: model)
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: device.isMacPlatform ? "desktopcomputer" : "pc")
                            .foregroundStyle(device.health.isActionable ? .orange : .green)
                            .frame(width: 34)

                        VStack(alignment: .leading, spacing: 3) {
                            Text(device.displayName).font(.headline)
                            Text(deviceSummary(device))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: device.health.symbol)
                            .foregroundStyle(device.health.isActionable ? .orange : .green)
                            .accessibilityLabel(device.health.title)
                    }
                    .padding(.vertical, 4)
                }
            }
            .navigationTitle("Devices")
            .refreshable { await model.refresh() }
            .overlay {
                if model.devices.isEmpty {
                    if model.connectionState.blocksEmptyContent {
                        PhoneDexSyncUnavailableView(state: model.connectionState) {
                            Task { await model.refresh() }
                        }
                    } else {
                        ContentUnavailableView("No devices", systemImage: "desktopcomputer")
                    }
                }
            }
        }
    }

    private func deviceSummary(_ device: PhoneDexDevice) -> String {
        [device.health.title, device.platform?.capitalized, device.version.map { "v\($0)" }]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

private struct PhoneDexSettingsView: View {
    @ObservedObject var model: PhoneDexAppModel
    @ObservedObject private var settings: PhoneDexSettings
    @State private var notificationStatus = ""

    init(model: PhoneDexAppModel) {
        self.model = model
        self.settings = model.settings
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Connection") {
                    TextField("Bridge URL", text: $settings.bridgeURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)

                    SecureField("Token", text: $settings.token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if let credentialStorageError = settings.credentialStorageError {
                        Label(credentialStorageError, systemImage: "lock.trianglebadge.exclamationmark")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button("Test Connection", systemImage: "bolt.horizontal.circle") {
                        Task { await model.refresh() }
                    }

                    PhoneDexConnectionHeader(state: model.connectionState)
                }

                Section("Notifications") {
                    Button("Allow Notifications", systemImage: "bell.badge") {
                        Task {
                            do {
                                let allowed = try await PhoneDexNotificationScheduler.requestAuthorization()
                                notificationStatus = allowed ? "Notifications are enabled." : "Notifications are disabled."
                            } catch {
                                notificationStatus = error.localizedDescription
                            }
                        }
                    }

                    Button("Notify Latest Task", systemImage: "paperplane") {
                        Task { await notifyLatest() }
                    }

                    if !notificationStatus.isEmpty {
                        Text(notificationStatus)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("About") {
                    LabeledContent("Version", value: "0.1 development")
                    Link("PhoneDex on GitHub", destination: URL(string: "https://github.com/nash226/phonedex")!)
                }
            }
            .navigationTitle("Settings")
        }
    }

    private func notifyLatest() async {
        guard let task = model.tasks.first,
              let bridgeURL = settings.normalizedBridgeURL
        else {
            notificationStatus = "Connect to the hub and fetch a task first."
            return
        }

        do {
            let allowed = try await PhoneDexNotificationScheduler.requestAuthorization()
            guard allowed else {
                notificationStatus = "Notifications are disabled."
                return
            }
            try await PhoneDexNotificationScheduler.scheduleTaskNotification(
                task,
                bridgeURL: bridgeURL
            )
            notificationStatus = "Notification scheduled."
        } catch {
            notificationStatus = error.localizedDescription
        }
    }
}
