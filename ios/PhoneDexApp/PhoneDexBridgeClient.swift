import Foundation

struct PhoneDexBridgeClient {
    var bridgeURL: URL
    var token: String
    var session: URLSession = .shared

    func fetchTasks() async throws -> [PhoneDexTask] {
        let tasksURL = bridgeURL.appending(path: "tasks")
        guard var components = URLComponents(url: tasksURL, resolvingAgainstBaseURL: false) else {
            throw PhoneDexBridgeClientError.invalidURL
        }
        components.queryItems = [URLQueryItem(name: "limit", value: "all")]
        guard let url = components.url else {
            throw PhoneDexBridgeClientError.invalidURL
        }
        let request = authorizedRequest(url: url)

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode([PhoneDexTask].self, from: data)
    }

    func fetchDevices() async throws -> [PhoneDexDevice] {
        let request = authorizedRequest(url: bridgeURL.appending(path: "devices"))
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode([PhoneDexDevice].self, from: data)
    }

    func sendReply(
        choice: PhoneDexReplyChoice,
        prompt: String,
        taskId: String,
        sessionId: String?,
        machineName: String?
    ) async throws {
        let url = bridgeURL.appending(path: "reply")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "token": token,
            "taskId": taskId,
            "sessionId": sessionId ?? "",
            "choice": choice.rawValue,
            "prompt": prompt,
            "reply_text": choice == .custom ? prompt : "",
            "machineName": machineName ?? ""
        ])

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
    }

    private func authorizedRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        return request
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
        case .httpStatus(let status, _):
            return "Bridge returned HTTP \(status)."
        }
    }
}
