import Foundation
import UserNotifications

final class PhoneDexNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    private let tokenStore: any PhoneDexTokenStoring
    private let replyStore: PhoneDexNotificationReplyStore

    init(
        tokenStore: any PhoneDexTokenStoring = PhoneDexKeychainTokenStore(),
        cache: any PhoneDexCacheStoring = PhoneDexEncryptedCache()
    ) {
        self.tokenStore = tokenStore
        self.replyStore = PhoneDexNotificationReplyStore(cache: cache)
        super.init()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let choice = choice(for: response.actionIdentifier) else {
            return
        }

        let userInfo = response.notification.request.content.userInfo
        let taskVersion = userInfo["taskVersion"] as? Int ?? 1
        let responseKey = Self.notificationResponseKey(
            notificationID: response.notification.request.identifier,
            actionIdentifier: response.actionIdentifier,
            taskVersion: taskVersion
        )
        if replyStore.containsHandled(responseKey) {
            NotificationReplyResult.record(.duplicate("This notification action was already handled."))
            return
        }
        guard let bridgeURL = await bridgeURLFromCurrentSettings() else {
            NotificationReplyResult.record(.failed("PhoneDex is not configured with a valid bridge URL."))
            return
        }

        let prompt: String
        if let textResponse = response as? UNTextInputNotificationResponse {
            prompt = textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            prompt = choice.prompt
        }

        guard !prompt.isEmpty else {
            NotificationReplyResult.record(.failed("The reply was empty."))
            return
        }

        let token: String
        do {
            token = try tokenStore.readToken() ?? ""
        } catch {
            NotificationReplyResult.record(.failed("Secure credential storage is unavailable. Try again."))
            return
        }

        let client = PhoneDexBridgeClient(bridgeURL: bridgeURL, token: token)
        let notificationID = response.notification.request.identifier
        let commandID = Self.notificationCommandID(
            notificationID: notificationID,
            actionIdentifier: response.actionIdentifier,
            taskVersion: taskVersion
        )
        let idempotencyKey = "ios-" + commandID
        let expectedTaskVersion = taskVersion
        let pending = PhoneDexPendingReply(
            commandId: commandID,
            idempotencyKey: idempotencyKey,
            taskId: userInfo["taskId"] as? String ?? "",
            choice: choice.rawValue,
            prompt: prompt,
            expectedTaskVersion: expectedTaskVersion,
            sessionId: userInfo["sessionId"] as? String,
            machineName: userInfo["machineName"] as? String,
            createdAt: Date()
        )
        guard replyStore.enqueue(pending) else {
            NotificationReplyResult.record(.failed("PhoneDex could not save this reply for retry. Open PhoneDex to try again."))
            return
        }

        do {
            let receipt = try await client.sendReply(
                choice: choice,
                prompt: prompt,
                taskId: userInfo["taskId"] as? String ?? "",
                sessionId: userInfo["sessionId"] as? String,
                machineName: userInfo["machineName"] as? String,
                commandId: commandID,
                idempotencyKey: idempotencyKey,
                expectedTaskVersion: expectedTaskVersion
            )
            if receipt.isSuccessful {
                _ = replyStore.complete(pending, responseKey: responseKey)
                NotificationReplyResult.record(.sent(receipt.message ?? prompt))
            } else if receipt.state == "expired" {
                _ = replyStore.complete(pending, responseKey: responseKey)
                NotificationReplyResult.record(.failed("This notification expired. Open PhoneDex to review the latest task."))
            } else {
                NotificationReplyResult.record(.failed(receipt.message ?? "The reply remains queued for retry."))
            }
        } catch {
            NotificationReplyResult.record(.failed(error.phoneDexSafeMessage))
        }
    }

    static func notificationResponseKey(
        notificationID: String,
        actionIdentifier: String,
        taskVersion: Int
    ) -> String {
        "\(notificationID)|\(actionIdentifier)|v\(max(taskVersion, 1))"
    }

    static func notificationCommandID(
        notificationID: String,
        actionIdentifier: String,
        taskVersion: Int
    ) -> String {
        "notification-\(notificationID)-\(actionIdentifier)-v\(max(taskVersion, 1))"
    }

    private func bridgeURLFromCurrentSettings() async -> URL? {
        await MainActor.run {
            PhoneDexSettings().normalizedBridgeURL
        }
    }

    private func choice(for actionIdentifier: String) -> PhoneDexReplyChoice? {
        switch actionIdentifier {
        case "PHONEDEX_OKAY_WHATS_NEXT":
            return .okayWhatsNext
        case "PHONEDEX_LETS_DO_THAT":
            return .letsDoThat
        case "PHONEDEX_CUSTOM_REPLY":
            return .custom
        default:
            return nil
        }
    }
}

/// Owns notification-action mutations so a failed cache write cannot be
/// mistaken for a durable offline outbox operation.
struct PhoneDexNotificationReplyStore {
    static let handledResponseRetention: TimeInterval = 24 * 60 * 60
    private let cache: any PhoneDexCacheStoring

    init(cache: any PhoneDexCacheStoring = PhoneDexEncryptedCache()) {
        self.cache = cache
    }

    @discardableResult
    func enqueue(_ pending: PhoneDexPendingReply) -> Bool {
        let existing: PhoneDexCachedState?
        do {
            existing = try cache.load()
        } catch {
            return false
        }
        var pendingReplies = existing?.pendingReplies ?? []
        pendingReplies.removeAll { $0.id == pending.id }
        pendingReplies.append(pending)

        let state = existing ?? PhoneDexCachedState(
            cursor: nil,
            tasks: [],
            devices: [],
            lastSyncAt: nil
        )
        return save(state.replacingNotificationState(pendingReplies: pendingReplies))
    }

    @discardableResult
    func remove(_ pending: PhoneDexPendingReply) -> Bool {
        guard let existing = try? cache.load() else { return false }
        var pendingReplies = existing.pendingReplies
        pendingReplies.removeAll { $0.id == pending.id }
        return save(existing.replacingNotificationState(pendingReplies: pendingReplies))
    }

    @discardableResult
    func complete(_ pending: PhoneDexPendingReply, responseKey: String, at date: Date = Date()) -> Bool {
        let existing: PhoneDexCachedState
        do {
            existing = try cache.load() ?? PhoneDexCachedState(
                cursor: nil,
                tasks: [],
                devices: [],
                lastSyncAt: nil
            )
        } catch {
            return false
        }
        var pendingReplies = existing.pendingReplies
        pendingReplies.removeAll { $0.id == pending.id }
        var handled = existing.handledNotificationResponses
        handled[responseKey] = date
        trimHandled(&handled, now: date)
        return save(existing.replacingNotificationState(
            pendingReplies: pendingReplies,
            handledNotificationResponses: handled
        ))
    }

    @discardableResult
    func markHandled(_ responseKey: String, at date: Date = Date()) -> Bool {
        let existing: PhoneDexCachedState
        do {
            existing = try cache.load() ?? PhoneDexCachedState(
                cursor: nil,
                tasks: [],
                devices: [],
                lastSyncAt: nil
            )
        } catch {
            return false
        }
        var handled = existing.handledNotificationResponses
        handled[responseKey] = date
        trimHandled(&handled, now: date)
        return save(existing.replacingNotificationState(handledNotificationResponses: handled))
    }

    func containsHandled(_ responseKey: String, now: Date = Date()) -> Bool {
        guard let handledAt = (try? cache.load())?.handledNotificationResponses[responseKey] else {
            return false
        }
        let age = now.timeIntervalSince(handledAt)
        return age >= 0 && age < Self.handledResponseRetention
    }

    private func save(_ state: PhoneDexCachedState) -> Bool {
        do {
            try cache.save(state)
            return true
        } catch {
            return false
        }
    }

    private func trimHandled(_ handled: inout [String: Date], now: Date) {
        handled = handled.filter { _, handledAt in
            let age = now.timeIntervalSince(handledAt)
            return age >= 0 && age < Self.handledResponseRetention
        }
        guard handled.count > 100 else { return }
        let staleKeys = handled
            .sorted { $0.value < $1.value }
            .prefix(handled.count - 100)
            .map(\.key)
        staleKeys.forEach { handled.removeValue(forKey: $0) }
    }

}

enum NotificationReplyResult: Equatable {
    static let maxAge: TimeInterval = 24 * 60 * 60

    case sent(String)
    case failed(String)
    case duplicate(String)

    static let didChange = Notification.Name("PhoneDexNotificationReplyResultDidChange")

    static func latest(now: Date = Date(), maxAge: TimeInterval = Self.maxAge) -> NotificationReplyResult? {
        guard maxAge >= 0 else { return nil }
        let defaults = UserDefaults.standard
        guard let state = defaults.string(forKey: Keys.state),
              let message = defaults.string(forKey: Keys.message),
              let updatedAt = defaults.object(forKey: Keys.updatedAt) as? TimeInterval,
              updatedAt.isFinite
        else {
            return nil
        }
        let age = now.timeIntervalSince1970 - updatedAt
        guard age >= 0, age <= maxAge else { return nil }
        switch state {
        case "sent": return .sent(message)
        case "duplicate": return .duplicate(message)
        default: return .failed(message)
        }
    }

    static func record(_ result: NotificationReplyResult) {
        let defaults = UserDefaults.standard
        switch result {
        case .sent(let message):
            defaults.set("sent", forKey: Keys.state)
            defaults.set(message, forKey: Keys.message)
        case .failed(let message):
            defaults.set("failed", forKey: Keys.state)
            defaults.set(message, forKey: Keys.message)
        case .duplicate(let message):
            defaults.set("duplicate", forKey: Keys.state)
            defaults.set(message, forKey: Keys.message)
        }
        defaults.set(Date().timeIntervalSince1970, forKey: Keys.updatedAt)
        NotificationCenter.default.post(name: didChange, object: nil)
    }

    private enum Keys {
        static let state = "phonedex.notificationReply.state"
        static let message = "phonedex.notificationReply.message"
        static let updatedAt = "phonedex.notificationReply.updatedAt"
    }
}
