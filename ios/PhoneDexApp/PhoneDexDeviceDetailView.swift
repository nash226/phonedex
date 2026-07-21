import SwiftUI

struct PhoneDexDeviceDetailView: View {
    let device: PhoneDexDevice
    @ObservedObject var model: PhoneDexAppModel

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 20) {
                overview
                diagnosticCard
                healthOverview
                capabilityOverview
                details
                visibleWork
                conversationHistory
                refreshAction
            }
            .padding(16)
        }
        .navigationTitle(device.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Copy device ID", systemImage: "doc.on.doc") {
                        UIPasteboard.general.string = device.deviceId
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("Device actions")
            }
        }
    }

    private var overview: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Image(systemName: device.isMacPlatform ? "desktopcomputer" : "pc")
                    .font(.title2)
                    .foregroundStyle(.blue)
                    .frame(width: 48, height: 48)
                    .background(.blue.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))

                VStack(alignment: .leading, spacing: 4) {
                    Text(device.displayName)
                        .font(.title2.weight(.bold))
                    Text(deviceRoleAndPlatform)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }

            Label(device.health.title, systemImage: device.health.symbol)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(device.health.isActionable ? .orange : .green)
                .accessibilityValue(device.health.title)

            if let lastSeenDate = device.lastSeenDate {
                Text("Last heard from \(lastSeenDate, style: .relative).")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            } else {
                Text("PhoneDex has no last-seen time for this device.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var diagnosticCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(device.diagnostic.title, systemImage: device.health.symbol)
                .font(.headline)
            Text(device.diagnostic.message)
                .font(.body)
            Text(device.diagnostic.nextStep)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(device.health.isActionable ? Color.orange.opacity(0.12) : Color.green.opacity(0.1), in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .combine)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Identity")
                .font(.headline)
            LabeledContent("Device ID") {
                Text(device.deviceId)
                    .textSelection(.enabled)
                    .multilineTextAlignment(.trailing)
            }
            LabeledContent("Platform", value: device.platform?.capitalized ?? "Unknown")
            LabeledContent("Role", value: device.role?.capitalized ?? "Unknown")
            if let version = device.version, !version.isEmpty {
                LabeledContent("Agent version", value: version)
            }
            if let expected = device.expected {
                LabeledContent("Coverage", value: expected ? "Expected" : "Unregistered")
            }
        }
        .font(.subheadline)
    }

    private var capabilityOverview: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Supported actions")
                .font(.headline)

            if device.capabilityDetails.isEmpty {
                Text("This agent has not declared versioned capabilities yet.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(device.capabilityDetails) { capability in
                    HStack(spacing: 10) {
                        Image(systemName: capability.symbol)
                            .foregroundStyle(capability.isActionable ? .orange : .green)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(capability.displayName)
                                .font(.subheadline.weight(.medium))
                            Text("v\(capability.version) · \(capability.scopeTitle)")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                        Text(capability.supported ? "Available" : "Unavailable")
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(capability.isActionable ? .orange : .secondary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityValue(capability.supported ? "Available" : "Unavailable")
                }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private var healthOverview: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("System health")
                .font(.headline)
            PhoneDexHealthRow(
                title: "Reachability",
                detail: device.reachabilityHealth.title,
                symbol: device.reachabilityHealth.symbol,
                isActionable: device.reachabilityHealth.isActionable
            )
            PhoneDexHealthRow(
                title: "PhoneDex agent",
                detail: device.agentHealth.title,
                symbol: device.agentHealth.symbol,
                isActionable: device.agentHealth.isActionable
            )
            PhoneDexHealthRow(
                title: "Codex adapter",
                detail: device.adapterHealth.title,
                symbol: device.adapterHealth.symbol,
                isActionable: device.adapterHealth.isActionable
            )
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
        .accessibilityElement(children: .contain)
    }

    private var visibleWork: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Visible work")
                .font(.headline)
            HStack(spacing: 12) {
                PhoneDexMetric(title: "Active", value: "\(visibleTasks.filter { ["queued", "running"].contains($0.status ?? "") }.count)", color: .blue)
                PhoneDexMetric(title: "Needs you", value: "\(visibleTasks.filter { ["needs_input", "awaiting_approval", "needs_review", "failed"].contains($0.status ?? "") }.count)", color: .orange)
                PhoneDexMetric(title: "Total", value: "\(visibleTasks.count)", color: .secondary)
            }
        }
        .accessibilityElement(children: .contain)
    }

    private var conversationHistory: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent conversations")
                .font(.headline)

            if visibleTasks.isEmpty {
                Label(
                    "No conversations from this device are cached yet.",
                    systemImage: "bubble.left.and.bubble.right"
                )
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("device-empty-conversations")
            } else {
                ForEach(visibleTasks) { task in
                    NavigationLink {
                        PhoneDexTaskDetailView(task: task, model: model)
                    } label: {
                        PhoneDexTaskRow(task: task)
                    }
                    .accessibilityIdentifier("device-conversation-\(task.id)")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var refreshAction: some View {
        Button {
            Task { await model.refresh() }
        } label: {
            Label("Refresh device status", systemImage: "arrow.clockwise")
                .frame(maxWidth: .infinity)
        }
        .buttonStyle(.borderedProminent)
        .disabled(model.connectionState == .syncing)
    }

    private var visibleTasks: [PhoneDexTask] {
        device.conversations(from: model.tasks)
    }

    private var deviceRoleAndPlatform: String {
        [device.role?.capitalized, device.platform?.capitalized]
            .compactMap { $0 }
            .joined(separator: " · ")
    }
}

private struct PhoneDexHealthRow: View {
    let title: String
    let detail: String
    let symbol: String
    let isActionable: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .foregroundStyle(isActionable ? .orange : .green)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.medium))
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

private struct PhoneDexMetric: View {
    let title: String
    let value: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(value)
                .font(.title3.weight(.bold))
                .foregroundStyle(color)
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
        .accessibilityElement(children: .combine)
    }
}

struct PhoneDexWorkspaceDetailView: View {
    let project: PhoneDexProject
    @ObservedObject var model: PhoneDexAppModel

    var body: some View {
        List {
            Section {
                LabeledContent("Devices", value: project.deviceSummary)
                LabeledContent("Conversations", value: "\(project.tasks.count)")
                LabeledContent("Active", value: "\(project.activeTaskCount)")
                LabeledContent("Needs you", value: "\(project.attentionTaskCount)")
                if let latestTask = project.latestTask {
                    LabeledContent("Latest activity", value: latestTask.title)
                }
                if !project.machineNames.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Available on")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(project.machineNames.joined(separator: ", "))
                            .font(.footnote)
                    }
                }
                if !project.paths.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(project.paths.count == 1 ? "Working directory" : "Working directories")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        ForEach(project.paths, id: \.self) { path in
                            Text(path)
                                .font(.footnote)
                                .textSelection(.enabled)
                        }
                    }
                }
            } header: {
                PhoneDexConnectionHeader(state: model.connectionState)
            }

            Section("Conversation history") {
                ForEach(project.tasks) { task in
                    NavigationLink {
                        PhoneDexTaskDetailView(task: task, model: model)
                    } label: {
                        PhoneDexTaskRow(task: task)
                    }
                    .accessibilityIdentifier("workspace-conversation-\(task.id)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await model.refresh() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                }
                .accessibilityLabel("Refresh workspace")
                .disabled(model.connectionState == .syncing)
            }
        }
    }
}
