import UIKit
import UserNotifications
import UserNotificationsUI

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let cardView = UIView()
    private let appLabel = UILabel()
    private let titleLabel = UILabel()
    private let bodyView = UITextView()

    override func viewDidLoad() {
        super.viewDidLoad()
        configureView()
        configureHierarchy()
    }

    func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        appLabel.text = content.subtitle.isEmpty ? "PhoneDex" : content.subtitle
        titleLabel.text = content.title
        bodyView.text = content.body
        preferredContentSize = CGSize(width: view.bounds.width, height: 520)
    }

    private func configureView() {
        view.backgroundColor = UIColor.black.withAlphaComponent(0.01)

        cardView.translatesAutoresizingMaskIntoConstraints = false
        cardView.backgroundColor = UIColor(red: 0.10, green: 0.11, blue: 0.13, alpha: 0.96)
        cardView.layer.cornerRadius = 24
        cardView.layer.cornerCurve = .continuous

        appLabel.translatesAutoresizingMaskIntoConstraints = false
        appLabel.textColor = UIColor(white: 0.82, alpha: 1)
        appLabel.font = .systemFont(ofSize: 15, weight: .semibold)

        titleLabel.translatesAutoresizingMaskIntoConstraints = false
        titleLabel.textColor = .white
        titleLabel.font = .systemFont(ofSize: 22, weight: .bold)
        titleLabel.numberOfLines = 2

        bodyView.translatesAutoresizingMaskIntoConstraints = false
        bodyView.backgroundColor = .clear
        bodyView.textColor = .white
        bodyView.font = .systemFont(ofSize: 19, weight: .regular)
        bodyView.textContainerInset = .zero
        bodyView.textContainer.lineFragmentPadding = 0
        bodyView.isEditable = false
        bodyView.isSelectable = false
        bodyView.isScrollEnabled = true
        bodyView.alwaysBounceVertical = true
        bodyView.showsVerticalScrollIndicator = true
        bodyView.indicatorStyle = .white
    }

    private func configureHierarchy() {
        view.addSubview(cardView)
        cardView.addSubview(appLabel)
        cardView.addSubview(titleLabel)
        cardView.addSubview(bodyView)

        NSLayoutConstraint.activate([
            cardView.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 12),
            cardView.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -12),
            cardView.topAnchor.constraint(equalTo: view.topAnchor, constant: 8),
            cardView.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -8),

            appLabel.leadingAnchor.constraint(equalTo: cardView.leadingAnchor, constant: 22),
            appLabel.trailingAnchor.constraint(equalTo: cardView.trailingAnchor, constant: -22),
            appLabel.topAnchor.constraint(equalTo: cardView.topAnchor, constant: 18),

            titleLabel.leadingAnchor.constraint(equalTo: appLabel.leadingAnchor),
            titleLabel.trailingAnchor.constraint(equalTo: appLabel.trailingAnchor),
            titleLabel.topAnchor.constraint(equalTo: appLabel.bottomAnchor, constant: 14),

            bodyView.leadingAnchor.constraint(equalTo: appLabel.leadingAnchor),
            bodyView.trailingAnchor.constraint(equalTo: appLabel.trailingAnchor),
            bodyView.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 14),
            bodyView.bottomAnchor.constraint(equalTo: cardView.bottomAnchor, constant: -20)
        ])
    }
}
