import Foundation
import SwiftUI

@MainActor
final class WatchDexClient: ObservableObject {
    @AppStorage("bridgeURL") var bridgeURL = ""
    @AppStorage("bridgeToken") var bridgeToken = ""

    @Published private(set) var tasks: [WatchDexTask] = []
    @Published var selectedTaskID: String?
    @Published var customReply = ""
    @Published var isLoading = false
    @Published var statusMessage = ""

    var isConfigured: Bool {
        URL(string: normalizedBridgeURL) != nil && !bridgeToken.isEmpty
    }

    var selectedTask: WatchDexTask? {
        if let selectedTaskID,
           let task = tasks.first(where: { $0.id == selectedTaskID }) {
            return task
        }
        return tasks.first
    }

    private var normalizedBridgeURL: String {
        bridgeURL.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    func refreshTasks() async {
        guard isConfigured else {
            statusMessage = "Add bridge URL and token."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            let url = try endpoint("tasks")
            let (data, response) = try await URLSession.shared.data(from: url)
            try validate(response)
            let decoded = try JSONDecoder().decode([WatchDexTask].self, from: data)
            tasks = decoded.reversed()
            selectedTaskID = tasks.first?.id
            statusMessage = tasks.isEmpty ? "No tasks yet." : "Loaded latest task."
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    func send(choice: WatchDexChoice, task: WatchDexTask) async {
        let prompt = choice == .custom ? customReply : choice.prompt
        await send(prompt: prompt, replyText: choice == .custom ? customReply : "", choice: choice, task: task)
    }

    private func send(
        prompt: String,
        replyText: String,
        choice: WatchDexChoice,
        task: WatchDexTask
    ) async {
        guard !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            statusMessage = "Enter a reply first."
            return
        }

        isLoading = true
        defer { isLoading = false }

        do {
            var request = URLRequest(url: try endpoint("reply"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = try JSONEncoder().encode(
                WatchDexReplyRequest(
                    token: bridgeToken,
                    taskId: task.id,
                    choice: choice.rawValue,
                    prompt: prompt,
                    replyText: replyText,
                    machineName: "Apple Watch"
                )
            )

            let (_, response) = try await URLSession.shared.data(for: request)
            try validate(response)
            statusMessage = "Sent."
            if choice == .custom {
                customReply = ""
            }
        } catch {
            statusMessage = error.localizedDescription
        }
    }

    private func endpoint(_ path: String) throws -> URL {
        guard let baseURL = URL(string: normalizedBridgeURL) else {
            throw WatchDexClientError.invalidBridgeURL
        }
        let url = baseURL.appendingPathComponent(path)
        guard path == "tasks", !bridgeToken.isEmpty else {
            return url
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.queryItems = [URLQueryItem(name: "token", value: bridgeToken)]

        guard let tokenizedURL = components?.url else {
            throw WatchDexClientError.invalidBridgeURL
        }

        return tokenizedURL
    }

    private func validate(_ response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw WatchDexClientError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            throw WatchDexClientError.httpStatus(httpResponse.statusCode)
        }
    }
}

enum WatchDexClientError: LocalizedError {
    case invalidBridgeURL
    case invalidResponse
    case httpStatus(Int)

    var errorDescription: String? {
        switch self {
        case .invalidBridgeURL:
            return "Invalid bridge URL."
        case .invalidResponse:
            return "Invalid bridge response."
        case .httpStatus(let status):
            return "Bridge returned HTTP \(status)."
        }
    }
}
