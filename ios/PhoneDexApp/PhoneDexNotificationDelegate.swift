import Foundation
import UserNotifications

final class PhoneDexNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    private let tokenStore: any PhoneDexTokenStoring

    init(tokenStore: any PhoneDexTokenStoring = PhoneDexKeychainTokenStore()) {
        self.tokenStore = tokenStore
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

        guard let context = PhoneDexNotificationReplyContext(userInfo: userInfo) else {
            NotificationReplyResult.record(.failed("This notification is incomplete. Open PhoneDex and refresh before replying."))
            return
        }

        let client = PhoneDexBridgeClient(bridgeURL: bridgeURL, token: token)
        let notificationID = response.notification.request.identifier
        let commandID = "notification-" + notificationID + "-" + response.actionIdentifier
        let idempotencyKey = "ios-" + commandID
        let pending = PhoneDexPendingReply(
            commandId: commandID,
            idempotencyKey: idempotencyKey,
            taskId: context.taskId,
            choice: choice.rawValue,
            prompt: prompt,
            expectedTaskVersion: context.taskVersion,
            sessionId: context.sessionId,
            machineName: context.machineName,
            createdAt: Date()
        )
        updatePendingReply(pending, remove: false)

        do {
            let receipt = try await client.sendReply(
                choice: choice,
                prompt: prompt,
                taskId: context.taskId,
                sessionId: context.sessionId,
                machineName: context.machineName,
                commandId: commandID,
                idempotencyKey: idempotencyKey,
                expectedTaskVersion: context.taskVersion
            )
            if receipt.isSuccessful {
                updatePendingReply(pending, remove: true)
                NotificationReplyResult.record(.sent(receipt.message ?? prompt))
            } else {
                NotificationReplyResult.record(.failed(receipt.message ?? "The reply remains queued for retry."))
            }
        } catch {
            NotificationReplyResult.record(.failed(error.localizedDescription))
        }
    }

    struct PhoneDexNotificationReplyContext: Equatable {
        let taskId: String
        let taskVersion: Int
        let sessionId: String?
        let machineName: String?

        init?(userInfo: [AnyHashable: Any]) {
            guard let taskId = userInfo["taskId"] as? String,
                  !taskId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  let taskVersion = userInfo["taskVersion"] as? Int,
                  taskVersion > 0 else {
                return nil
            }

            self.taskId = taskId
            self.taskVersion = taskVersion
            self.sessionId = Self.optionalNonEmptyString(userInfo["sessionId"])
            self.machineName = Self.optionalNonEmptyString(userInfo["machineName"])
        }

        private static func optionalNonEmptyString(_ value: Any?) -> String? {
            guard let value = value as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
    }

    private func updatePendingReply(_ pending: PhoneDexPendingReply, remove: Bool) {
        let cache = PhoneDexEncryptedCache()
        let existing = try? cache.load()
        var pendingReplies = existing?.pendingReplies ?? []
        pendingReplies.removeAll { $0.id == pending.id }
        if !remove { pendingReplies.append(pending) }

        let state = existing ?? PhoneDexCachedState(
            cursor: nil,
            tasks: [],
            devices: [],
            lastSyncAt: nil
        )
        try? cache.save(PhoneDexCachedState(
            cursor: state.cursor,
            tasks: state.tasks,
            devices: state.devices,
            lastSyncAt: state.lastSyncAt,
            drafts: state.drafts,
            readingPositions: state.readingPositions,
            pendingReplies: pendingReplies
        ))
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

enum NotificationReplyResult: Equatable {
    case sent(String)
    case failed(String)

    static let didChange = Notification.Name("PhoneDexNotificationReplyResultDidChange")

    static var latest: NotificationReplyResult? {
        let defaults = UserDefaults.standard
        guard let state = defaults.string(forKey: Keys.state),
              let message = defaults.string(forKey: Keys.message)
        else {
            return nil
        }
        return state == "sent" ? .sent(message) : .failed(message)
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
