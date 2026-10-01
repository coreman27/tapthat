import Capacitor

@objc(MonetizationPlugin)
public final class MonetizationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MonetizationPlugin"
    public let jsName = "Monetization"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showInterstitial", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showRewarded", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchaseRemoveAds", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "purchaseTheme", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restorePurchases", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showPrivacyOptions", returnType: CAPPluginReturnPromise)
    ]

    @MainActor private lazy var monetization = MonetizationManager(plugin: self)

    public override func load() {
        Task { @MainActor in monetization.observeTransactions() }
    }

    @objc func initialize(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.initialize(call) }
    }

    @objc func showInterstitial(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.showInterstitial(call) }
    }

    @objc func showRewarded(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.showRewarded(call) }
    }

    @objc func purchaseRemoveAds(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.purchaseRemoveAds(call) }
    }

    @objc func purchaseTheme(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.purchaseTheme(call) }
    }

    @objc func restorePurchases(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.restorePurchases(call) }
    }

    @objc func showPrivacyOptions(_ call: CAPPluginCall) {
        Task { @MainActor in await monetization.showPrivacyOptions(call) }
    }
}
