import UIKit
import UserNotifications
import UserNotificationsUI

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let contentView = UIView()
    private let stackView = UIStackView()
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
        preferredContentSize = CGSize(width: 0, height: 520)
        view.backgroundColor = .clear

        contentView.translatesAutoresizingMaskIntoConstraints = false
        contentView.backgroundColor = UIColor(red: 0.10, green: 0.11, blue: 0.13, alpha: 0.98)
        contentView.layer.cornerRadius = 24
        contentView.layer.cornerCurve = .continuous

        stackView.translatesAutoresizingMaskIntoConstraints = false
        stackView.axis = .vertical
        stackView.alignment = .fill
        stackView.spacing = 14

        appLabel.translatesAutoresizingMaskIntoConstraints = false
        appLabel.textColor = UIColor(white: 0.82, alpha: 1)
        appLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        appLabel.numberOfLines = 1

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.numberOfLines = 3

        scrollView.translatesAutoresizingMaskIntoConstraints = false
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
        view.addSubview(contentView)
        contentView.addSubview(stackView)
        stackView.addArrangedSubview(appLabel)
        stackView.addArrangedSubview(titleLabel)
        stackView.addArrangedSubview(scrollView)
        scrollView.addSubview(bodyLabel)

        NSLayoutConstraint.activate([
            contentView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            contentView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            contentView.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            contentView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),

            stackView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 22),
            stackView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -22),
            stackView.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            stackView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20),

            scrollView.heightAnchor.constraint(greaterThanOrEqualToConstant: 220),

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
        preferredContentSize = CGSize(width: 0, height: 520)
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }
}
