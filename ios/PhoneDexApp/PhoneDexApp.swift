import SwiftUI
import UserNotifications

@main
struct PhoneDexApp: App {
    @StateObject private var settings = PhoneDexSettings()

    private let notificationDelegate = PhoneDexNotificationDelegate()

    init() {
        UNUserNotificationCenter.current().delegate = notificationDelegate
        PhoneDexNotificationScheduler.registerCategories()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(settings: settings)
                .onOpenURL { url in
                    settings.apply(configurationURL: url)
                }
        }
    }
}
