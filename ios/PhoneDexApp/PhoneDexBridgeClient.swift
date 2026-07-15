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

struct PhoneDexReplyReceipt: Codable, Equatable {
    let schema: String?
    let protocolVersion: Int?
    let commandId: String
    let createdAt: String?
    let state: String
    let taskId: String?
    let taskVersion: Int?
    let idempotencyKey: String?
    let message: String?
    let duplicateOf: String?

    var isSuccessful: Bool {
        ["accepted", "completed", "duplicate"].contains(state)
    }

    static func legacy(commandId: String, idempotencyKey: String, taskId: String) -> Self {
        Self(
            schema: nil,
            protocolVersion: nil,
            commandId: commandId,
            createdAt: nil,
            state: "accepted",
            taskId: taskId,
            taskVersion: nil,
            idempotencyKey: idempotencyKey,
            message: "Reply accepted by the legacy bridge.",
            duplicateOf: nil
        )
    }
}

struct PhoneDexPairingResponse: Decodable, Equatable {
    let credential: String
    let identity: PhoneDexPairedIdentity
}

struct PhoneDexPairedIdentity: Decodable, Equatable {
    let id: String
    let deviceId: String
    let name: String
    let role: String
    let platform: String
    let scopes: [String]
    let status: String
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

    func redeemPairing(
        grant: String,
        verificationCode: String,
        deviceName: String = "iPhone"
    ) async throws -> PhoneDexPairingResponse {
        let url = bridgeURL.appending(path: "pair")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "grant": grant,
            "verificationCode": verificationCode,
            "deviceName": deviceName,
            "platform": "ios"
        ])

        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw PhoneDexBridgeClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder().decode(PhoneDexErrorEnvelope.self, from: data))?.error
            throw PhoneDexBridgeClientError.pairingFailed(
                message ?? "Pairing could not be completed. Generate a new grant and try again."
            )
        }
        return try JSONDecoder().decode(PhoneDexPairingResponse.self, from: data)
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
        let page = try JSONDecoder().decode(PhoneDexSyncPage.self, from: data)
        if let protocolNegotiation = page.protocolNegotiation, !protocolNegotiation.isCurrent {
            throw PhoneDexBridgeClientError.protocolIncompatible(
                "The hub negotiated an unsupported PhoneDex protocol version. Update the hub and try again."
            )
        }
        return page
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
        machineName: String?,
        commandId: String,
        idempotencyKey: String,
        expectedTaskVersion: Int
    ) async throws -> PhoneDexReplyReceipt {
        let url = bridgeURL.appending(path: "reply")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        if !token.isEmpty {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "authorization")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "taskId": taskId,
            "sessionId": sessionId ?? "",
            "choice": choice.rawValue,
            "prompt": prompt,
            "reply_text": choice == .custom ? prompt : "",
            "machineName": machineName ?? "",
            "commandId": commandId,
            "idempotencyKey": idempotencyKey,
            "expectedTaskVersion": expectedTaskVersion,
            "actor": "iphone",
            "requestedCapability": "task.reply.v1"
        ])

        let (data, response) = try await session.data(for: request)
        try validate(response: response, data: data)
        if let envelope = try? JSONDecoder().decode(PhoneDexReplyEnvelope.self, from: data),
           let receipt = envelope.receipt {
            return receipt
        }
        return .legacy(commandId: commandId, idempotencyKey: idempotencyKey, taskId: taskId)
    }

    private func authorizedRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        request.setValue("1", forHTTPHeaderField: "x-phonedex-protocol-version")
        request.setValue(
            "sync.snapshot.v1,device.health.v1",
            forHTTPHeaderField: "x-phonedex-capabilities"
        )
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
            if httpResponse.statusCode == 409,
               let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               payload["code"] as? String == "task_stale" {
                throw PhoneDexBridgeClientError.staleTask(
                    payload["error"] as? String ?? "The task changed before this reply arrived."
                )
            }
            if httpResponse.statusCode == 426,
               let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               ["protocol_incompatible", "capability_unsupported"].contains(payload["code"] as? String) {
                throw PhoneDexBridgeClientError.protocolIncompatible(
                    payload["error"] as? String ?? "The hub does not support this PhoneDex protocol version."
                )
            }
            throw PhoneDexBridgeClientError.httpStatus(httpResponse.statusCode, body)
        }
    }
}

enum PhoneDexBridgeClientError: LocalizedError {
    case invalidURL
    case invalidResponse
    case httpStatus(Int, String)
    case protocolIncompatible(String)
    case staleTask(String)
    case pairingFailed(String)

    var isCompatibilityFailure: Bool {
        guard case .httpStatus(let status, _) = self else { return false }
        return status == 404 || status == 405
    }

    var isProtocolIncompatible: Bool {
        if case .protocolIncompatible = self { return true }
        return false
    }

    var isRestartableSyncCursor: Bool {
        guard case .httpStatus(let status, _) = self else { return false }
        return status == 400 || status == 409
    }

    var isRevoked: Bool {
        guard case .httpStatus(let status, _) = self else { return false }
        return status == 401 || status == 403
    }

    var isStaleTask: Bool {
        if case .staleTask = self { return true }
        return false
    }

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Bridge URL is invalid."
        case .invalidResponse:
            return "Bridge returned an invalid response."
        case .httpStatus(let status, _):
            return "Bridge returned HTTP \(status)."
        case .protocolIncompatible(let message):
            return message
        case .staleTask(let message):
            return message
        case .pairingFailed(let message):
            return message
        }
    }
}

private struct PhoneDexReplyEnvelope: Decodable {
    let receipt: PhoneDexReplyReceipt?
}

private struct PhoneDexErrorEnvelope: Decodable {
    let error: String?
}

extension Error {
    var isRevoked: Bool {
        (self as? PhoneDexBridgeClientError)?.isRevoked ?? false
    }

    var isCompatibilityFailure: Bool {
        (self as? PhoneDexBridgeClientError)?.isCompatibilityFailure ?? false
    }

    var isProtocolIncompatible: Bool {
        (self as? PhoneDexBridgeClientError)?.isProtocolIncompatible ?? false
    }

    var isStaleTask: Bool {
        (self as? PhoneDexBridgeClientError)?.isStaleTask ?? false
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
