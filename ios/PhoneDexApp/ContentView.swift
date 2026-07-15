import SwiftUI

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

    var body: some View {
        NavigationSplitView {
            List(selection: $model.selectedTaskID) {
                Section {
                    ForEach(model.tasks) { task in
                        NavigationLink(value: task.id) {
                            PhoneDexTaskRow(task: task)
                        }
                    }
                } header: {
                    PhoneDexConnectionHeader(state: model.connectionState)
                }
            }
            .listStyle(.plain)
            .navigationTitle("PhoneDex")
            .overlay {
                if model.tasks.isEmpty {
                    ContentUnavailableView(
                        "No conversations yet",
                        systemImage: "bubble.left.and.bubble.right",
                        description: Text("Completed Codex work will appear here.")
                    )
                }
            }
            .refreshable { await model.refresh() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await model.refresh() }
                    } label: {
                        Image(systemName: "arrow.clockwise")
                    }
                    .accessibilityLabel("Refresh conversations")
                }
            }
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
}

private struct PhoneDexTaskRow: View {
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

private struct PhoneDexConnectionHeader: View {
    let state: PhoneDexAppModel.ConnectionState

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(label)
        }
        .textCase(nil)
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    private var color: Color {
        switch state {
        case .online: return .green
        case .failed: return .red
        case .syncing: return .orange
        case .idle: return .secondary
        }
    }

    private var label: String {
        switch state {
        case .online: return "Hub connected"
        case .failed: return "Hub unavailable"
        case .syncing: return "Syncing"
        case .idle: return "Waiting for hub"
        }
    }
}

private struct PhoneDexTaskDetailView: View {
    let task: PhoneDexTask
    @ObservedObject var model: PhoneDexAppModel
    @State private var draft = ""
    @FocusState private var composerFocused: Bool

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 18) {
                taskHeader
                Divider()
                message
                replyStatus
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
        .background(Color(uiColor: .systemBackground))
        .navigationTitle(task.displayWorkspace)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { composer }
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

    private var taskHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Label("Completed", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Spacer()
                if let date = task.displayDate {
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
        }
    }

    private var message: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Codex", systemImage: "sparkles")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.blue)

            Text(task.text)
                .font(.body)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
                .background(Color(uiColor: .secondarySystemBackground))
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
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
}

private struct PhoneDexProjectsView: View {
    @ObservedObject var model: PhoneDexAppModel

    var body: some View {
        NavigationStack {
            List(model.projects) { project in
                NavigationLink {
                    List(project.tasks) { task in
                        NavigationLink {
                            PhoneDexTaskDetailView(task: task, model: model)
                        } label: {
                            PhoneDexTaskRow(task: task)
                        }
                    }
                    .navigationTitle(project.name)
                    .navigationBarTitleDisplayMode(.inline)
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
                    ContentUnavailableView("No projects", systemImage: "folder")
                }
            }
        }
    }
}

private struct PhoneDexDevicesView: View {
    @ObservedObject var model: PhoneDexAppModel

    var body: some View {
        NavigationStack {
            List(model.devices) { device in
                HStack(spacing: 12) {
                    Image(systemName: device.platform == "darwin" ? "desktopcomputer" : "pc")
                        .foregroundStyle(device.isOnline ? .green : .orange)
                        .frame(width: 34)

                    VStack(alignment: .leading, spacing: 3) {
                        Text(device.displayName).font(.headline)
                        Text(deviceSummary(device))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Circle()
                        .fill(device.isOnline ? Color.green : Color.orange)
                        .frame(width: 9, height: 9)
                        .accessibilityLabel(device.isOnline ? "Online" : (device.status ?? "Unavailable"))
                }
                .padding(.vertical, 4)
            }
            .navigationTitle("Devices")
            .refreshable { await model.refresh() }
            .overlay {
                if model.devices.isEmpty {
                    ContentUnavailableView("No devices", systemImage: "desktopcomputer")
                }
            }
        }
    }

    private func deviceSummary(_ device: PhoneDexDevice) -> String {
        [device.status?.capitalized, device.platform?.capitalized, device.version.map { "v\($0)" }]
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
                bridgeURL: bridgeURL,
                token: settings.token
            )
            notificationStatus = "Notification scheduled."
        } catch {
            notificationStatus = error.localizedDescription
        }
    }
}
