import Foundation

struct PhoneDexTask: Decodable, Identifiable, Equatable {
    let id: String
    let at: String?
    let source: String?
    let title: String
    let text: String
    let cwd: String?
    let machineName: String?
    let sessionId: String?
}

enum PhoneDexReplyChoice: String {
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

struct PhoneDexReplyResponse: Decodable {
    let ok: Bool
    let duplicate: Bool?
}
