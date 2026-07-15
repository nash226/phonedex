import Foundation
import LocalAuthentication

protocol PhoneDexApprovalAuthenticating {
    func authenticate() async throws
}

struct PhoneDexApprovalAuthenticator: PhoneDexApprovalAuthenticating {
    func authenticate() async throws {
        let context = LAContext()
        var policyError: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &policyError) else {
            throw PhoneDexApprovalAuthenticationError.unavailable
        }

        do {
            let authenticated = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: "Confirm this approval decision in PhoneDex."
            )
            guard authenticated else {
                throw PhoneDexApprovalAuthenticationError.failed
            }
        } catch let error as PhoneDexApprovalAuthenticationError {
            throw error
        } catch let error as LAError where error.code == .userCancel || error.code == .systemCancel {
            throw PhoneDexApprovalAuthenticationError.cancelled
        } catch {
            throw PhoneDexApprovalAuthenticationError.failed
        }
    }
}

enum PhoneDexApprovalAuthenticationError: LocalizedError, Equatable {
    case unavailable
    case cancelled
    case failed

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "Face ID or passcode confirmation is unavailable on this iPhone."
        case .cancelled:
            return "Approval confirmation was cancelled."
        case .failed:
            return "Approval confirmation failed. Try again before sending the decision."
        }
    }
}
