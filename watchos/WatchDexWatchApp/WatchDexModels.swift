import Foundation

struct WatchDexTask: Decodable, Identifiable, Equatable {
    let id: String
    let at: String?
    let source: String?
    let title: String
    let text: String
    let cwd: String?
    let machineName: String?
    let sessionId: String?
}

enum WatchDexChoice: String {
    case okayWhatsNext = "okay_whats_next"
    case letsDoThat = "lets_do_that"
    case custom

    var prompt: String {
        switch self {
        case .okayWhatsNext:
            return "okay whats next"
        case .letsDoThat:
            return "lets do that"
        case .custom:
            return ""
        }
    }
}

struct WatchDexReplyRequest: Encodable {
    let token: String
    let taskId: String
    let choice: String
    let prompt: String
    let replyText: String
    let machineName: String

    enum CodingKeys: String, CodingKey {
        case token
        case taskId
        case choice
        case prompt
        case replyText = "reply_text"
        case machineName
    }
}
