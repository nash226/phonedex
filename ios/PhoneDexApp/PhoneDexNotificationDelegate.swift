import Foundation
import UserNotifications

final class PhoneDexNotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
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
        guard
            let bridgeRaw = userInfo["bridgeUrl"] as? String,
            let bridgeURL = URL(string: bridgeRaw)
        else {
            return
        }

        let prompt: String
        if let textResponse = response as? UNTextInputNotificationResponse {
            prompt = textResponse.userText.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            prompt = choice.prompt
        }

        guard !prompt.isEmpty else {
            return
        }

        let client = PhoneDexBridgeClient(
            bridgeURL: bridgeURL,
            token: userInfo["token"] as? String ?? ""
        )

        try? await client.sendReply(
            choice: choice,
            prompt: prompt,
            taskId: userInfo["taskId"] as? String ?? "",
            machineName: userInfo["machineName"] as? String
        )
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
