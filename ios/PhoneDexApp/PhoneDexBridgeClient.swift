import Foundation

struct PhoneDexSyncResult {
    let tasks: [PhoneDexTask]?
    let devices: [PhoneDexDevice]?
    let cursor: String?
    let restartedFromSnapshot: Bool
    let usedCompatibilityFallback: Bool
    let fallbackMessage: String?

    var isComplete: Bool {
        tasks != nil && devices != nil
    }

    var availableDataSet: PhoneDexAppModel.DataSet {
        if tasks != nil { return .tasks }
        return .devices
    }
}

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

    func fetchSyncPage(cursor: String? = nil, limit: Int = 50) async throws -> PhoneDexSyncPage {
        var components = URLComponents(
            url: bridgeURL.appending(path: "sync"),
            resolvingAgainstBaseURL: false
        )
        var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if let cursor, !cursor.isEmpty {
            queryItems.append(URLQueryItem(name: "cursor", value: cursor))
        }
        components?.queryItems = queryItems
        guard let url = components?.url else {
            throw PhoneDexBridgeClientError.invalidURL
        }

        let request = authorizedRequest(url: url)
        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        return try JSONDecoder().decode(PhoneDexSyncPage.self, from: data)
    }

    func fetchSync(limit: Int = 50) async throws -> (tasks: [PhoneDexTask], devices: [PhoneDexDevice]) {
        let result = try await fetchSyncState(limit: limit)
        return (tasks: result.tasks ?? [], devices: result.devices ?? [])
    }

    func fetchSyncState(
        cursor: String? = nil,
        tasks: [PhoneDexTask] = [],
        devices: [PhoneDexDevice] = [],
        limit: Int = 50
    ) async throws -> PhoneDexSyncResult {
        var currentCursor = cursor?.isEmpty == true ? nil : cursor
        var restartedFromSnapshot = false
        var tasksByID = Dictionary(uniqueKeysWithValues: currentCursor == nil ? [] : tasks.map { ($0.id, $0) })
        var devicesByID = Dictionary(uniqueKeysWithValues: currentCursor == nil ? [] : devices.map { ($0.id, $0) })

        while true {
            let page: PhoneDexSyncPage
            do {
                page = try await fetchSyncPage(cursor: currentCursor, limit: limit)
            } catch let error where currentCursor != nil && error.isRestartableSyncCursor {
                currentCursor = nil
                tasksByID.removeAll()
                devicesByID.removeAll()
                restartedFromSnapshot = true
                continue
            }

            if let snapshot = page.snapshot {
                if currentCursor == nil {
                    tasksByID.removeAll()
                    devicesByID.removeAll()
                }
                for task in snapshot.tasks { tasksByID[task.id] = task }
                for device in snapshot.devices { devicesByID[device.id] = device }
            }
            for change in page.changes {
                switch change.kind {
                case "task":
                    if change.deleted {
                        if let task = change.task { tasksByID.removeValue(forKey: task.id) }
                        else { tasksByID.removeValue(forKey: change.id) }
                    } else if let task = change.task {
                        tasksByID[task.id] = task
                    }
                case "device":
                    if change.deleted {
                        if let device = change.device { devicesByID.removeValue(forKey: device.id) }
                        else { devicesByID.removeValue(forKey: change.id) }
                    } else if let device = change.device {
                        devicesByID[device.id] = device
                    }
                default:
                    continue
                }
            }
            currentCursor = page.cursor
            if !page.hasMore {
                return PhoneDexSyncResult(
                    tasks: Array(tasksByID.values),
                    devices: Array(devicesByID.values),
                    cursor: currentCursor,
                    restartedFromSnapshot: restartedFromSnapshot,
                    usedCompatibilityFallback: false,
                    fallbackMessage: nil
                )
            }
        }
    }

    func fetchResilientSync(
        cursor: String? = nil,
        tasks: [PhoneDexTask] = [],
        devices: [PhoneDexDevice] = [],
        limit: Int = 50
    ) async throws -> PhoneDexSyncResult {
        do {
            return try await fetchSyncState(cursor: cursor, tasks: tasks, devices: devices, limit: limit)
        } catch let syncError {
            guard syncError.isCompatibilityFailure else { throw syncError }

            async let legacyTasks = fetchTasksIfAvailable()
            async let legacyDevices = fetchDevicesIfAvailable()
            let (tasks, devices) = await (legacyTasks, legacyDevices)
            guard tasks != nil || devices != nil else { throw syncError }

            return PhoneDexSyncResult(
                tasks: tasks,
                devices: devices,
                cursor: nil,
                restartedFromSnapshot: false,
                usedCompatibilityFallback: true,
                fallbackMessage: "This hub does not expose durable sync yet. Compatible data is shown."
            )
        }
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

    private func fetchTasksIfAvailable() async -> [PhoneDexTask]? {
        try? await fetchTasks()
    }

    private func fetchDevicesIfAvailable() async -> [PhoneDexDevice]? {
        try? await fetchDevices()
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

    var isCompatibilityFailure: Bool {
        guard case .httpStatus(let status, _) = self else { return false }
        return status == 404 || status == 405
    }

    var isRestartableSyncCursor: Bool {
        guard case .httpStatus(let status, _) = self else { return false }
        return status == 400 || status == 409
    }

    var isRevoked: Bool {
        guard case .httpStatus(let status, _) = self else { return false }
        return status == 401 || status == 403
    }

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

extension Error {
    var isRevoked: Bool {
        (self as? PhoneDexBridgeClientError)?.isRevoked ?? false
    }

    var isCompatibilityFailure: Bool {
        (self as? PhoneDexBridgeClientError)?.isCompatibilityFailure ?? false
    }

    var isRestartableSyncCursor: Bool {
        (self as? PhoneDexBridgeClientError)?.isRestartableSyncCursor ?? false
    }

    var isOffline: Bool {
        guard let urlError = self as? URLError else { return false }
        return [
            .cannotConnectToHost,
            .cannotFindHost,
            .dataNotAllowed,
            .networkConnectionLost,
            .notConnectedToInternet,
            .timedOut
        ].contains(urlError.code)
    }
}
