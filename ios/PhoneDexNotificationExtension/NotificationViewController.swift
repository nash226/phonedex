import UIKit
import UserNotifications
import UserNotificationsUI

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let appLabel = UILabel()
    private let titleLabel = UILabel()
    private let scrollView = UIScrollView()
    private let bodyLabel = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        configureHierarchy()
        render(
            app: "PhoneDex",
            title: "Codex update",
            body: "Open the expanded PhoneDex notification to read the full Codex result."
        )
    }

    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        render(
            app: content.subtitle.isEmpty ? "PhoneDex" : content.subtitle,
            title: content.title,
            body: content.body
        )
    }

    private func configureView() {
        preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 520)
        view.backgroundColor = UIColor(red: 0.08, green: 0.09, blue: 0.11, alpha: 1)
        view.isOpaque = true

        appLabel.translatesAutoresizingMaskIntoConstraints = false
        appLabel.textColor = UIColor(white: 0.82, alpha: 1)
        appLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        appLabel.numberOfLines = 1

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.numberOfLines = 3

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.backgroundColor = .clear
        scrollView.alwaysBounceVertical = true
        scrollView.showsVerticalScrollIndicator = true
        scrollView.indicatorStyle = .white

        bodyLabel.translatesAutoresizingMaskIntoConstraints = false
        bodyLabel.textColor = .white
        bodyLabel.font = .systemFont(ofSize: 18, weight: .regular)
        bodyLabel.numberOfLines = 0
        bodyLabel.lineBreakMode = .byWordWrapping
    }

    private func configureHierarchy() {
        view.addSubview(appLabel)
        view.addSubview(titleLabel)
        view.addSubview(scrollView)
        scrollView.addSubview(bodyLabel)

        NSLayoutConstraint.activate([
            appLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            appLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -22),
            appLabel.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),

            titleLabel.leadingAnchor.constraint(equalTo: appLabel.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: appLabel.trailingAnchor),
            titleLabel.topAnchor.constraint(equalTo: appLabel.bottomAnchor, constant: 14),

            scrollView.leadingAnchor.constraint(equalTo: appLabel.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: appLabel.trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 14),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -20),

            bodyLabel.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            bodyLabel.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            bodyLabel.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            bodyLabel.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            bodyLabel.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor)
        ])
    }

    private func render(app: String, title: String, body: String) {
        appLabel.text = app
        titleLabel.text = title.isEmpty ? "Codex update" : title
        bodyLabel.text = body.isEmpty ? "No notification body was provided." : body
        preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 520)
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }
}
