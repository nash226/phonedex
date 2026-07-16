import SwiftUI
import WebKit

@MainActor
final class PhoneDexBrowserModel: NSObject, ObservableObject, WKNavigationDelegate {
    @Published var address = "https://github.com/nash226/phonedex"
    @Published private(set) var title = "Browser"
    @Published private(set) var isLoading = false
    @Published private(set) var canGoBack = false
    @Published private(set) var canGoForward = false

    var shareURL: URL? {
        URL(string: address)
    }

    let webView: WKWebView

    override init() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        loadAddress()
    }

    func loadAddress() {
        let trimmed = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let candidate = trimmed.contains("://") ? trimmed : "https://\(trimmed)"
        guard let url = URL(string: candidate) else { return }
        address = url.absoluteString
        webView.load(URLRequest(url: url))
    }

    func goBack() { webView.goBack() }
    func goForward() { webView.goForward() }
    func reload() { webView.reload() }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        updateState(from: webView)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        updateState(from: webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        updateState(from: webView)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        updateState(from: webView)
    }

    private func updateState(from webView: WKWebView) {
        title = webView.title ?? "Browser"
        address = webView.url?.absoluteString ?? address
        isLoading = webView.isLoading
        canGoBack = webView.canGoBack
        canGoForward = webView.canGoForward
    }
}

struct PhoneDexBrowserView: View {
    @StateObject private var model = PhoneDexBrowserModel()
    @FocusState private var addressFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 10) {
                    Image(systemName: "lock.fill")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    TextField("Search or enter website", text: $model.address)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .focused($addressFocused)
                        .onSubmit { model.loadAddress() }

                    if model.isLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Button(action: model.reload) {
                            Image(systemName: "arrow.clockwise")
                        }
                        .accessibilityLabel("Reload page")
                    }
                }
                .padding(.horizontal, 14)
                .frame(height: 48)
                .background(.bar)

                Divider()
                EmbeddedWebView(webView: model.webView)
            }
            .navigationTitle(model.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .bottomBar) {
                    Button(action: model.goBack) { Image(systemName: "chevron.left") }
                        .disabled(!model.canGoBack)
                        .accessibilityLabel("Back")
                    Button(action: model.goForward) { Image(systemName: "chevron.right") }
                        .disabled(!model.canGoForward)
                        .accessibilityLabel("Forward")
                    Spacer()
                    if let shareURL = model.shareURL {
                        ShareLink(item: shareURL) {
                            Image(systemName: "square.and.arrow.up")
                        }
                        .accessibilityLabel("Share page")
                    }
                    Button {
                        addressFocused = true
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel("Edit address")
                }
            }
        }
    }
}

private struct EmbeddedWebView: UIViewRepresentable {
    let webView: WKWebView

    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
