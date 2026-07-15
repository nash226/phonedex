import XCTest

final class PhoneDexShellUITests: XCTestCase {
    func testPrimaryDestinationsRemainAccessibleAtLargestDynamicType() {
        let app = launchApp(
            arguments: [
                "-UIPreferredContentSizeCategoryName",
                "UICTContentSizeCategoryAccessibilityXXXL",
                "-UIAccessibilityReduceMotionEnabled",
                "YES",
                "-UIAccessibilityVoiceOverEnabled",
                "YES",
                "-AppleInterfaceStyle",
                "Light"
            ]
        )

        for title in ["Chats", "Projects", "Browser", "Devices", "Settings"] {
            XCTAssertTrue(
                app.tabBars.buttons[title].waitForExistence(timeout: 5),
                "Expected accessible tab label: \(title)"
            )
        }

        XCTAssertTrue(app.buttons["Refresh conversations"].waitForExistence(timeout: 5))
    }

    func testSettingsControlsRemainReachableInDarkAppearance() {
        let app = launchApp(arguments: ["-AppleInterfaceStyle", "Dark"])

        let settingsTab = app.tabBars.buttons["Settings"]
        XCTAssertTrue(settingsTab.waitForExistence(timeout: 5))
        settingsTab.tap()

        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textFields["Bridge URL"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.secureTextFields["Token"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Test Connection"].waitForExistence(timeout: 5))
        app.swipeUp()
        XCTAssertTrue(app.switches["Require Face ID or passcode"].waitForExistence(timeout: 5))
    }

    private func launchApp(arguments: [String]) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = arguments
        app.launch()
        return app
    }
}
