import Foundation

/// Centralizes user-facing strings that are not created by SwiftUI `Text`.
/// SwiftUI literals are extracted automatically; strings passed to UIKit and
/// error protocols need an explicit localization boundary.
enum PhoneDexLocalization {
    static func approvalReason(locale: Locale = .current) -> String {
        String(
            localized: "approval.confirm_reason",
            defaultValue: "Confirm this approval decision in PhoneDex.",
            locale: locale,
            comment: "Reason shown by Local Authentication before an approval"
        )
    }

    static func bridgeHTTPStatus(_ status: Int, locale: Locale = .current) -> String {
        String(
            localized: "bridge.http_status",
            defaultValue: "Bridge returned HTTP \(status).",
            locale: locale,
            comment: "HTTP error shown when the PhoneDex bridge rejects a request"
        )
    }

    static func relativeDate(_ date: Date, relativeTo referenceDate: Date = Date()) -> String {
        RelativeDateTimeFormatter().localizedString(for: date, relativeTo: referenceDate)
    }
}
