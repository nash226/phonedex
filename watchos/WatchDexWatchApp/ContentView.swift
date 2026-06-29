import SwiftUI

struct ContentView: View {
    @StateObject private var client = WatchDexClient()
    @State private var showingSettings = false

    var body: some View {
        NavigationStack {
            Group {
                if client.isConfigured {
                    taskView
                } else {
                    SetupView(client: client)
                }
            }
            .navigationTitle("PhoneDex")
            .toolbar {
                ToolbarItem {
                    Button {
                        showingSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showingSettings) {
                SetupView(client: client)
            }
            .task {
                await client.refreshTasks()
            }
        }
    }

    @ViewBuilder
    private var taskView: some View {
        if let task = client.selectedTask {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(task.title)
                        .font(.headline)

                    Text(task.text)
                        .font(.footnote)

                    if let machineName = task.machineName, !machineName.isEmpty {
                        Label(machineName, systemImage: "desktopcomputer")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    Divider()

                    Button {
                        Task { await client.send(choice: .okayWhatsNext, task: task) }
                    } label: {
                        Label("Okay, next", systemImage: "checkmark.circle")
                    }

                    Button {
                        Task { await client.send(choice: .letsDoThat, task: task) }
                    } label: {
                        Label("Let's do that", systemImage: "arrowshape.turn.up.right")
                    }

                    TextField("Custom reply", text: $client.customReply)

                    Button {
                        Task { await client.send(choice: .custom, task: task) }
                    } label: {
                        Label("Send reply", systemImage: "paperplane")
                    }
                    .disabled(client.customReply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                    Button {
                        Task { await client.refreshTasks() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }

                    if !client.statusMessage.isEmpty {
                        Text(client.statusMessage)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 4)
            }
        } else {
            VStack(spacing: 10) {
                Text(client.statusMessage.isEmpty ? "No tasks yet." : client.statusMessage)
                    .font(.footnote)
                Button("Refresh") {
                    Task { await client.refreshTasks() }
                }
            }
        }
    }
}

struct SetupView: View {
    @ObservedObject var client: WatchDexClient
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Form {
            Section("Bridge") {
                TextField("http://192.168.1.189:8765", text: $client.bridgeURL)
                SecureField("Token", text: $client.bridgeToken)
            }

            Button("Save") {
                dismiss()
                Task { await client.refreshTasks() }
            }
        }
        .navigationTitle("Setup")
    }
}
