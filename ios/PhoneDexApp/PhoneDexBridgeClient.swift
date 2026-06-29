import Foundation

struct PhoneDexBridgeClient {
    var bridgeURL: URL
    var token: String
    var session: URLSession = .shared

    func fetchTasks() async throws -> [PhoneDexTask] {
        var request = URLRequest(url: bridgeURL.appending(path: "tasks"))
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode([PhoneDexTask].self, from: data)
    }

    func sendReply(
        choice: PhoneDexReplyChoice,
        prompt: String,
        taskId: String,
        machineName: String?
    ) async throws {
        let url = bridgeURL.appending(path: "reply")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "token": token,
            "taskId": taskId,
            "choice": choice.rawValue,
            "prompt": prompt,
            "reply_text": choice == .custom ? prompt : "",
            "machineName": machineName ?? ""
        ])

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    private func validate(response: URLResponse, data: Data) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PhoneDexBridgeClientError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw PhoneDexBridgeClientError.httpStatus(httpResponse.statusCode, body)
        }
    }
}

enum PhoneDexBridgeClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Bridge URL is invalid."
        case .invalidResponse:
            return "Bridge returned an invalid response."
        case .httpStatus(let status, let body):
            return "Bridge returned HTTP \(status): \(body)"
        }
    }
}
