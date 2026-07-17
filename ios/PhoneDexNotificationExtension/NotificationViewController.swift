import UIKit
import UserNotifications
import UserNotificationsUI

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let iconView = UIView()
    private let iconImageView = UIImageView()
    private let headerStack = UIStackView()
    private let appNameLabel = UILabel()
    private let timeLabel = UILabel()
    private let titleLabel = UILabel()
    private let scrollView = UIScrollView()
    private let bodyLabel = UILabel()
    private let scrollRail = UIView()
    private let scrollThumb = UIView()

    override func loadView() {
        view = UIView(frame: .zero)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        configureHierarchy()
        render(PhoneDexNotificationContent(
            title: "Codex update",
            body: "Open the expanded PhoneDex notification to read the full Codex result."
        ))
    }

    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        render(PhoneDexNotificationContent(title: content.title, body: content.body))
    }

    private func configureView() {
        preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 500)
        view.backgroundColor = UIColor(red: 0.07, green: 0.08, blue: 0.10, alpha: 1)
        view.isOpaque = true

        iconView.translatesAutoresizingMaskIntoConstraints = false
        iconView.backgroundColor = .white
        iconView.layer.cornerRadius = 11
        iconView.layer.cornerCurve = .continuous

        iconImageView.translatesAutoresizingMaskIntoConstraints = false
        iconImageView.image = UIImage(systemName: "bubble.left.and.bubble.right.fill")
        iconImageView.tintColor = UIColor(red: 0.08, green: 0.09, blue: 0.12, alpha: 1)
        iconImageView.contentMode = .scaleAspectFit

        headerStack.translatesAutoresizingMaskIntoConstraints = false
        headerStack.axis = .horizontal
        headerStack.alignment = .center
        headerStack.spacing = 14

        appNameLabel.translatesAutoresizingMaskIntoConstraints = false
        appNameLabel.textColor = .white
        appNameLabel.font = UIFontMetrics(forTextStyle: .headline)
            .scaledFont(for: .systemFont(ofSize: 20, weight: .semibold))
        appNameLabel.adjustsFontForContentSizeCategory = true
        appNameLabel.numberOfLines = 1
        appNameLabel.accessibilityTraits = .header

        timeLabel.translatesAutoresizingMaskIntoConstraints = false
        timeLabel.textColor = UIColor(white: 0.72, alpha: 1)
        timeLabel.font = UIFontMetrics(forTextStyle: .subheadline)
            .scaledFont(for: .systemFont(ofSize: 16, weight: .regular))
        timeLabel.adjustsFontForContentSizeCategory = true
        timeLabel.textAlignment = .right
        timeLabel.text = "now"
        timeLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.textColor = .white
        titleLabel.font = UIFontMetrics(forTextStyle: .title2)
            .scaledFont(for: .systemFont(ofSize: 23, weight: .bold))
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.numberOfLines = 2
        titleLabel.accessibilityTraits = .header

        scrollView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.backgroundColor = .clear
        scrollView.alwaysBounceVertical = true
        scrollView.showsVerticalScrollIndicator = true
        scrollView.indicatorStyle = .white
        scrollView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 18, right: 0)

        bodyLabel.translatesAutoresizingMaskIntoConstraints = false
        bodyLabel.textColor = .white
        bodyLabel.font = UIFontMetrics(forTextStyle: .body)
            .scaledFont(for: .systemFont(ofSize: 19, weight: .regular))
        bodyLabel.adjustsFontForContentSizeCategory = true
        bodyLabel.numberOfLines = 0
        bodyLabel.lineBreakMode = .byWordWrapping

        scrollRail.translatesAutoresizingMaskIntoConstraints = false
        scrollRail.backgroundColor = UIColor(white: 1, alpha: 0.18)
        scrollRail.layer.cornerRadius = 2

        scrollThumb.translatesAutoresizingMaskIntoConstraints = false
        scrollThumb.backgroundColor = UIColor(white: 1, alpha: 0.62)
        scrollThumb.layer.cornerRadius = 2
    }

    private func configureHierarchy() {
        view.addSubview(headerStack)
        view.addSubview(titleLabel)
        view.addSubview(scrollView)
        view.addSubview(scrollRail)
        scrollRail.addSubview(scrollThumb)
        iconView.addSubview(iconImageView)
        headerStack.addArrangedSubview(iconView)
        headerStack.addArrangedSubview(appNameLabel)
        headerStack.addArrangedSubview(timeLabel)
        scrollView.addSubview(bodyLabel)

        NSLayoutConstraint.activate([
            headerStack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 22),
            headerStack.trailingAnchor.constraint(equalTo: view.readableContentGuide.trailingAnchor),
            headerStack.topAnchor.constraint(equalTo: view.topAnchor, constant: 20),

            iconView.widthAnchor.constraint(equalToConstant: 48),
            iconView.heightAnchor.constraint(equalTo: iconView.widthAnchor),
            iconImageView.centerXAnchor.constraint(equalTo: iconView.centerXAnchor),
            iconImageView.centerYAnchor.constraint(equalTo: iconView.centerYAnchor),
            iconImageView.widthAnchor.constraint(equalToConstant: 30),
            iconImageView.heightAnchor.constraint(equalTo: iconImageView.widthAnchor),

            titleLabel.leadingAnchor.constraint(equalTo: view.readableContentGuide.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: view.readableContentGuide.trailingAnchor),
            titleLabel.topAnchor.constraint(equalTo: headerStack.bottomAnchor, constant: 24),

            scrollView.leadingAnchor.constraint(equalTo: view.readableContentGuide.leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: scrollRail.leadingAnchor, constant: -12),
            scrollView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 14),
            scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -20),

            scrollRail.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -18),
            scrollRail.topAnchor.constraint(equalTo: scrollView.topAnchor, constant: 4),
            scrollRail.bottomAnchor.constraint(equalTo: scrollView.bottomAnchor, constant: -22),
            scrollRail.widthAnchor.constraint(equalToConstant: 4),

            scrollThumb.topAnchor.constraint(equalTo: scrollRail.topAnchor, constant: 6),
            scrollThumb.leadingAnchor.constraint(equalTo: scrollRail.leadingAnchor),
            scrollThumb.trailingAnchor.constraint(equalTo: scrollRail.trailingAnchor),
            scrollThumb.heightAnchor.constraint(equalToConstant: 94),

            bodyLabel.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            bodyLabel.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            bodyLabel.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            bodyLabel.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            bodyLabel.widthAnchor.constraint(equalTo: scrollView.frameLayoutGuide.widthAnchor)
        ])
    }

    private func render(_ content: PhoneDexNotificationContent) {
        appNameLabel.text = content.app
        titleLabel.text = content.title
        bodyLabel.text = content.body
        bodyLabel.accessibilityLabel = content.body
        preferredContentSize = CGSize(width: UIScreen.main.bounds.width, height: 500)
        view.setNeedsLayout()
        view.layoutIfNeeded()
    }
}
