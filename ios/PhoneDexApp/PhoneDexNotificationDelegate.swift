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
        guard let bridgeURL = bridgeURL(from: userInfo) else {
            NotificationReplyResult.record(.failed("The notification did not include a valid bridge URL."))
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

        do {
            try await client.sendReply(
                choice: choice,
                prompt: prompt,
                taskId: userInfo["taskId"] as? String ?? "",
                sessionId: userInfo["sessionId"] as? String,
                machineName: userInfo["machineName"] as? String
            )
            NotificationReplyResult.record(.sent(prompt))
        } catch {
            NotificationReplyResult.record(.failed(error.localizedDescription))
        }
    }

    private func bridgeURL(from userInfo: [AnyHashable: Any]) -> URL? {
        if let raw = userInfo["bridgeUrl"] as? String,
           let url = URL(string: raw) {
            return url
        }

        guard let raw = userInfo["replyUrl"] as? String,
              let url = URL(string: raw)
        else {
            return nil
        }
        return url.lastPathComponent == "reply" ? url.deletingLastPathComponent() : url
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
