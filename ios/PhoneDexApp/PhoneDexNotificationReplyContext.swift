import Foundation

/// Validated routing metadata for a notification reply.
///
/// Notification userInfo is an external input boundary. Keep malformed or
/// incomplete payloads out of the encrypted outbox and bridge client rather
/// than manufacturing a command for an unknown task.
struct PhoneDexNotificationReplyContext: Equatable {
    let taskId: String
    let sessionId: String?
    let machineName: String?
    let expectedTaskVersion: Int

    init?(userInfo: [AnyHashable: Any]) {
        guard let taskId = Self.boundedString(userInfo["taskId"], maximumLength: 256),
              let rawVersion = userInfo["taskVersion"] else {
            return nil
        }

        let version: Int
        if let value = rawVersion as? Int {
            version = value
        } else if let value = rawVersion as? NSNumber,
                  value.doubleValue.isFinite,
                  value.doubleValue == Double(value.intValue) {
            version = value.intValue
        } else {
            return nil
        }

        guard version > 0 else { return nil }

        self.taskId = taskId
        self.sessionId = Self.boundedString(userInfo["sessionId"], maximumLength: 256)
        self.machineName = Self.boundedString(userInfo["machineName"], maximumLength: 256)
        self.expectedTaskVersion = version
    }

    private static func boundedString(_ value: Any?, maximumLength: Int) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              trimmed.count <= maximumLength,
              !trimmed.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
        else { return nil }
        return trimmed
    }
}
