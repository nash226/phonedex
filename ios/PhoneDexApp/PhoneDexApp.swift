import SwiftUI
import UserNotifications

@main
struct PhoneDexApp: App {
    private let notificationDelegate = PhoneDexNotificationDelegate()

    init() {
        UNUserNotificationCenter.current().delegate = notificationDelegate
        PhoneDexNotificationScheduler.registerCategories()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
