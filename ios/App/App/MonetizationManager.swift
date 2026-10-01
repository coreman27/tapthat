import Capacitor
import GoogleMobileAds
import Network
import OSLog
import StoreKit
import UIKit
import UserMessagingPlatform

private enum MonetizationError: LocalizedError {
    case timedOut, verificationFailed, productUnavailable, themeUnavailable, presentationUnavailable

    var errorDescription: String? {
        switch self {
        case .timedOut: return "The service took too long to respond. Please try again."
        case .verificationFailed: return "Your purchase could not be verified. Ads are paused; try Restore Purchases."
        case .productUnavailable: return "Remove Ads is unavailable from the App Store. Please try again later."
        case .themeUnavailable: return "That theme is unavailable from the App Store. Please try again later."
        case .presentationUnavailable: return "Return to the app and close other screens, then try again."
        }
    }
}

// Unlike a task group, this deadline does not wait for an uncooperative network operation
// to cancel. Late results cannot mutate state or present UI.
@MainActor
private final class Deadline<Value> {
    private var continuation: CheckedContinuation<Value, Error>?
    private var operation: Task<Void, Never>?
    private var timer: Task<Void, Never>?

    func run(seconds: UInt64, work: @escaping @MainActor () async throws -> Value) async throws -> Value {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            operation = Task { @MainActor in
                do { finish(.success(try await work())) }
                catch { finish(.failure(error)) }
            }
            timer = Task { @MainActor in
                do { try await Task.sleep(nanoseconds: seconds * 1_000_000_000) }
                catch { return }
                finish(.failure(MonetizationError.timedOut))
            }
        }
    }

    private func finish(_ result: Result<Value, Error>) {
        guard let continuation else { return }
        self.continuation = nil
        operation?.cancel()
        timer?.cancel()
        operation = nil
        timer = nil
        continuation.resume(with: result)
    }
}

@MainActor
final class MonetizationManager: NSObject, FullScreenContentDelegate {
    private static let testAppID = "ca-app-pub-3940256099942544~1458002511"
    private static let testInterstitialID = "ca-app-pub-3940256099942544/4411468910"
    private let logger = Logger(subsystem: Bundle.main.bundleIdentifier ?? "DontTapThat", category: "Monetization")
    private weak var plugin: MonetizationPlugin?
    private var transactionObserver: Task<Void, Never>?
    private var foregroundObserver: NSObjectProtocol?
    private let networkMonitor = NWPathMonitor()
    private var networkAvailable = false
    private var adsRemoved = false
    private var entitlementsVerified = false
    private var entitlementRevision = 0
    private var product: Product?
    // Cosmetic theme unlocks: separate non-consumable products. They never affect ads.
    private let themeProductIDs: [String]
    private var themeProducts: [String: Product] = [:]
    private var ownedThemes: Set<String> = []
    private var initialized = false
    private var busy = false
    private var consentCompleted = false
    private var privacyOptionsRequired = false
    private var message: String?
    private var mobileAdsStarted = false
    private var mobileAdsReady = false
    private var cachedAd: InterstitialAd?
    private var cachedAt: Date?
    private var loadingAd = false
    private var adGeneration = 0
    private var presentingAd: InterstitialAd?
    private var presentationCall: CAPPluginCall?
    private var presentationDidStart = false
    private var presentationWaiters: [CAPPluginCall] = []

    private let productID: String
    private let appID: String
    private let interstitialID: String
    private let testAds: Bool
    private let adsEnabled: Bool

    init(plugin: MonetizationPlugin) {
        self.plugin = plugin
        let info = Bundle.main
        productID = info.object(forInfoDictionaryKey: "MonetizationRemoveAdsProductID") as? String
            ?? "com.coreyhall.donttapthat.removeads"
        themeProductIDs = info.object(forInfoDictionaryKey: "MonetizationThemeProductIDs") as? [String] ?? []
        appID = info.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String ?? ""
        testAds = info.object(forInfoDictionaryKey: "MonetizationTestAds") as? Bool ?? true
        adsEnabled = info.object(forInfoDictionaryKey: "MonetizationAdsEnabled") as? Bool ?? false
        interstitialID = info.object(forInfoDictionaryKey: "MonetizationInterstitialAdUnitID") as? String ?? ""
        super.init()
    }

    deinit {
        transactionObserver?.cancel()
        networkMonitor.cancel()
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    private var adsConfigured: Bool {
        guard adsEnabled else { return false }
        if testAds { return appID == Self.testAppID && interstitialID == Self.testInterstitialID }
        return appID.range(of: #"^ca-app-pub-[0-9]{16}~[0-9]{10}$"#, options: .regularExpression) != nil
            && interstitialID.range(of: #"^ca-app-pub-[0-9]{16}/[0-9]{10}$"#, options: .regularExpression) != nil
            && !appID.contains("3940256099942544") && !interstitialID.contains("3940256099942544")
    }

    private var state: JSObject {
        var result: JSObject = [
            "adsRemoved": adsRemoved,
            "productAvailable": product != nil,
            "price": NSNull(),
            "privacyOptionsRequired": privacyOptionsRequired,
            "testAds": testAds,
            "adsConfigured": adsConfigured,
            "needsConsent": adsConfigured && !adsRemoved && !consentCompleted
        ]
        if let product { result["price"] = product.displayPrice }
        var themePrices = JSObject()
        for (id, themeProduct) in themeProducts { themePrices[id] = themeProduct.displayPrice }
        result["ownedThemes"] = ownedThemes.sorted()
        result["themePrices"] = themePrices
        if let message { result["message"] = message }
        return result
    }

    private func emitState() {
        plugin?.notifyListeners("stateChanged", data: state)
    }

    private func report(_ text: String, error: Error? = nil) {
        message = text
        // Error descriptions can contain account/transaction information; never log them.
        if let error {
            logger.error("\(text, privacy: .public) Error code: \((error as NSError).code)")
        } else {
            logger.notice("\(text, privacy: .public)")
        }
        emitState()
    }

    func observeTransactions() {
        guard transactionObserver == nil else { return }
        networkMonitor.pathUpdateHandler = { [weak self] path in
            Task { @MainActor in
                guard let self else { return }
                self.networkAvailable = path.status == .satisfied
                if self.networkAvailable { self.preloadAd() }
            }
        }
        networkMonitor.start(queue: .main)
        let productID = productID
        transactionObserver = Task { @MainActor [weak self] in
            for await result in Transaction.updates {
                guard !Task.isCancelled, let self else { return }
                switch result {
                case .verified(let transaction):
                    if self.themeProductIDs.contains(transaction.productID) {
                        await self.handleThemeTransaction(transaction)
                        continue
                    }
                    guard transaction.productID == productID, transaction.productType == .nonConsumable else { continue }
                    self.entitlementRevision += 1
                    self.entitlementsVerified = false
                    self.discardCachedAd()
                    if transaction.revocationDate == nil && !transaction.isUpgraded {
                        self.adsRemoved = true
                        self.emitState()
                    }
                    do {
                        try await self.refreshEntitlements()
                        await transaction.finish()
                        self.emitState()
                        self.preloadAd()
                    } catch {
                        self.report("Purchase status could not be refreshed. Ads are paused; try Restore Purchases.", error: error)
                    }
                case .unverified(let transaction, _):
                    guard transaction.productID == productID else { continue }
                    self.entitlementRevision += 1
                    self.entitlementsVerified = false
                    self.discardCachedAd()
                    self.report("A purchase update could not be verified. Ads are paused; try Restore Purchases.")
                }
            }
        }
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                guard let self, self.initialized, !self.busy else { return }
                do {
                    try await self.refreshEntitlements()
                    await self.refreshThemesQuietly()
                    self.emitState()
                    self.preloadAd()
                } catch {
                    self.report("Purchase status could not be refreshed. Ads are paused; try Restore Purchases.", error: error)
                }
            }
        }
    }

    private func refreshEntitlements(attempt: Int = 0) async throws {
        let revision = entitlementRevision
        let productID = productID
        do {
            let owned = try await Deadline<Bool>().run(seconds: 8) {
                var owned = false
                for await result in Transaction.currentEntitlements {
                    try Task.checkCancellation()
                    switch result {
                    case .verified(let transaction):
                        if transaction.productID == productID,
                           transaction.productType == .nonConsumable,
                           transaction.revocationDate == nil, !transaction.isUpgraded {
                            owned = true
                        }
                    case .unverified(let transaction, _):
                        if transaction.productID == productID { throw MonetizationError.verificationFailed }
                    }
                }
                return owned
            }
            guard revision == entitlementRevision else {
                // A newer verified transaction wins over a snapshot taken before its arrival.
                if !entitlementsVerified {
                    guard attempt < 2 else { throw MonetizationError.verificationFailed }
                    try await refreshEntitlements(attempt: attempt + 1)
                }
                return
            }
            adsRemoved = owned
            entitlementsVerified = true
            if owned { discardCachedAd() }
        } catch {
            if revision == entitlementRevision {
                entitlementsVerified = false
                discardCachedAd()
            }
            throw error
        }
    }

    private func fetchProduct() async throws {
        let productID = productID
        let products = try await Deadline<[Product]>().run(seconds: 8) {
            try await Product.products(for: [productID])
        }
        guard let available = products.first(where: { $0.id == productID && $0.type == .nonConsumable }) else {
            throw MonetizationError.productUnavailable
        }
        product = available
    }

    func initialize(_ call: CAPPluginCall) async {
        guard !busy else { call.reject("Monetization is busy. Please try again."); return }
        busy = true
        initialized = false
        defer { busy = false }
        message = nil
        do {
            // Verified, locally cached StoreKit entitlements must precede every advertising API.
            try await refreshEntitlements()
        } catch {
            report("Purchase status could not be verified. Ads are paused; try Restore Purchases.", error: error)
        }
        do { try await fetchProduct() }
        catch { report("Remove Ads pricing is unavailable. Check your connection and try again.", error: error) }
        await loadThemesQuietly()
        updatePrivacyRequirement()
        if entitlementsVerified && !adsRemoved && adsConfigured {
            do { try await gatherConsent() }
            catch { report("Ads are paused because privacy choices could not be loaded. Please try again later.", error: error) }
        } else if adsEnabled && !adsConfigured {
            report("Advertising is disabled because its configuration is incomplete.")
        }
        initialized = true
        emitState()
        call.resolve(state)
        preloadAd()
    }

    private var controller: UIViewController? {
        guard UIApplication.shared.applicationState == .active,
              let controller = plugin?.bridge?.viewController,
              controller.viewIfLoaded?.window != nil,
              !controller.isBeingDismissed,
              !controller.isBeingPresented,
              controller.presentedViewController == nil else { return nil }
        return controller
    }

    private func updatePrivacyRequirement() {
        // Preserve an entry point for paid users without issuing a consent network request.
        let status = ConsentInformation.shared.privacyOptionsRequirementStatus
        if status == .unknown {
            privacyOptionsRequired = UserDefaults.standard.bool(forKey: "MonetizationPrivacyOptionsRequired")
        } else {
            privacyOptionsRequired = status == .required
            UserDefaults.standard.set(privacyOptionsRequired, forKey: "MonetizationPrivacyOptionsRequired")
        }
    }

    private func updateConsentInformation() async throws {
        try await Deadline<Void>().run(seconds: 12) {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ConsentInformation.shared.requestConsentInfoUpdate(with: RequestParameters()) { error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume() }
                }
            }
        }
        updatePrivacyRequirement()
    }

    private func gatherConsent() async throws {
        consentCompleted = false
        discardCachedAd()
        try await updateConsentInformation()
        guard !adsRemoved else { return }
        if ConsentInformation.shared.consentStatus == .required {
            // Split loadAndPresentIfRequired into its two SDK operations so a late network
            // callback cannot present a consent screen after a timeout unlocks gameplay.
            let form = try await Deadline<ConsentForm>().run(seconds: 12) {
                try await withCheckedThrowingContinuation { continuation in
                    ConsentForm.load { form, error in
                        if let error { continuation.resume(throwing: error) }
                        else if let form { continuation.resume(returning: form) }
                        else { continuation.resume(throwing: MonetizationError.presentationUnavailable) }
                    }
                }
            }
            guard !adsRemoved else { return }
            guard let controller else { throw MonetizationError.presentationUnavailable }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                form.present(from: controller) { error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume() }
                }
            }
        }
        updatePrivacyRequirement()
        consentCompleted = true
    }

    private var mayRequestAds: Bool {
        initialized && entitlementsVerified && !adsRemoved && adsConfigured && consentCompleted
            && ConsentInformation.shared.canRequestAds
    }

    private func discardCachedAd() {
        adGeneration += 1
        cachedAd = nil
        cachedAt = nil
        loadingAd = false
    }

    private func preloadAd() {
        guard mayRequestAds, networkAvailable, presentingAd == nil,
              UIApplication.shared.applicationState == .active else { return }
        if !mobileAdsStarted {
            mobileAdsStarted = true
            let configuration = MobileAds.shared.requestConfiguration
            configuration.publisherPrivacyPersonalizationState = .disabled
            configuration.setPublisherFirstPartyIDEnabled(false)
            configuration.maxAdContentRating = .general
            MobileAds.shared.start { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.mobileAdsReady = true
                    self.preloadAd()
                }
            }
            return
        }
        guard mobileAdsReady, cachedAd == nil, !loadingAd else { return }
        loadingAd = true
        let generation = adGeneration
        let request = Request()
        let extras = Extras()
        extras.additionalParameters = ["npa": "1"]
        request.register(extras)
        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let ad = try await Deadline<InterstitialAd>().run(seconds: 15) {
                    try await InterstitialAd.load(with: self.interstitialID, request: request)
                }
                guard self.adGeneration == generation else { return }
                self.loadingAd = false
                guard self.mayRequestAds else { return }
                ad.fullScreenContentDelegate = self
                self.cachedAd = ad
                self.cachedAt = Date()
            } catch {
                guard self.adGeneration == generation else { return }
                self.loadingAd = false
                self.report("An ad is unavailable. You can keep playing.", error: error)
            }
        }
    }

    func showInterstitial(_ call: CAPPluginCall) async {
        // Calls made during a visible ad resolve only after the same actual dismissal.
        if presentationCall != nil { presentationWaiters.append(call); return }
        guard initialized else { call.resolve(["shown": false, "reason": "not_initialized"]); return }
        guard !busy else { call.resolve(["shown": false, "reason": "busy"]); return }
        guard networkAvailable else { call.resolve(["shown": false, "reason": "offline"]); return }
        // Only this JS-locked between-run break may recover consent after an offline
        // launch or a revoked purchase. Background callbacks must never show forms.
        if !consentCompleted && adsConfigured && !adsRemoved {
            busy = true
            defer { busy = false }
            do {
                try await refreshEntitlements()
                if !adsRemoved { try await gatherConsent() }
                emitState()
                call.resolve(["shown": false, "reason": "consent_updated"])
                preloadAd()
            } catch {
                report("Ads are paused because privacy choices could not be loaded. Please try again later.", error: error)
                call.resolve(["shown": false, "reason": "consent_unavailable"])
            }
            return
        }
        guard let ad = cachedAd, let cachedAt else {
            call.resolve(["shown": false, "reason": adsRemoved ? "ads_removed" : "not_ready"])
            preloadAd()
            return
        }
        guard Date().timeIntervalSince(cachedAt) < 3_300 else {
            discardCachedAd()
            call.resolve(["shown": false, "reason": "not_ready"])
            preloadAd()
            return
        }
        busy = true
        presentationCall = call
        do { try await refreshEntitlements() }
        catch {
            report("Purchase status could not be verified. Ads are paused; try Restore Purchases.", error: error)
            completePresentation(shown: false, reason: "entitlement_unavailable")
            return
        }
        emitState()
        guard networkAvailable else {
            completePresentation(shown: false, reason: "offline")
            return
        }
        guard mayRequestAds else {
            completePresentation(shown: false, reason: adsRemoved ? "ads_removed" : "ads_unavailable")
            return
        }
        guard self.cachedAd === ad else {
            completePresentation(shown: false, reason: "not_ready")
            return
        }
        guard let controller else {
            completePresentation(shown: false, reason: "not_foreground")
            return
        }
        do { try ad.canPresent(from: controller) }
        catch {
            discardCachedAd()
            report("An ad could not be displayed. You can keep playing.", error: error)
            completePresentation(shown: false, reason: "cannot_present")
            return
        }
        self.cachedAd = nil
        self.cachedAt = nil
        presentingAd = ad
        presentationDidStart = false
        ad.present(from: controller)
    }

    func adWillPresentFullScreenContent(_ ad: FullScreenPresentingAd) {
        presentationDidStart = true
    }

    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        completePresentation(shown: true, reason: nil)
    }

    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) {
        report("An ad could not be displayed. You can keep playing.", error: error)
        completePresentation(shown: presentationDidStart, reason: "presentation_failed")
    }

    private func completePresentation(shown: Bool, reason: String?) {
        var response: JSObject = ["shown": shown]
        if let reason { response["reason"] = reason }
        let calls = presentationWaiters
        presentationWaiters.removeAll()
        let primary = presentationCall
        presentationCall = nil
        presentingAd = nil
        busy = false
        primary?.resolve(response)
        calls.forEach { $0.resolve(["shown": false, "reason": "already_presenting"]) }
        preloadAd()
    }

    func purchaseRemoveAds(_ call: CAPPluginCall) async {
        guard !busy else { call.reject("Monetization is busy. Please try again."); return }
        busy = true
        defer { busy = false }
        message = nil
        do {
            try await refreshEntitlements()
            if adsRemoved {
                emitState()
                call.resolve(["status": "purchased", "adsRemoved": true])
                return
            }
            guard controller != nil else { throw MonetizationError.presentationUnavailable }
            if product == nil { try await fetchProduct() }
            guard let product else { throw MonetizationError.productUnavailable }
            let result = try await product.purchase()
            let status: String
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification,
                      transaction.productID == productID,
                      transaction.productType == .nonConsumable else {
                    entitlementsVerified = false
                    discardCachedAd()
                    throw MonetizationError.verificationFailed
                }
                entitlementRevision += 1
                if transaction.revocationDate == nil && !transaction.isUpgraded {
                    adsRemoved = true
                    discardCachedAd()
                    emitState()
                }
                try await refreshEntitlements()
                await transaction.finish()
                guard adsRemoved else { throw MonetizationError.verificationFailed }
                status = "purchased"
            case .userCancelled:
                try await refreshEntitlements()
                status = "cancelled"
            case .pending:
                try await refreshEntitlements()
                status = "pending"
                message = "Purchase awaiting approval. Remove Ads will activate when Apple confirms it."
            @unknown default:
                throw MonetizationError.verificationFailed
            }
            emitState()
            call.resolve(["status": status, "adsRemoved": adsRemoved])
        } catch {
            report("Purchase could not be completed. Check your connection or try Restore Purchases.", error: error)
            call.reject("Purchase could not be completed. Please try again or Restore Purchases.")
        }
    }

    func restorePurchases(_ call: CAPPluginCall) async {
        guard !busy else { call.reject("Monetization is busy. Please try again."); return }
        busy = true
        defer { busy = false }
        message = nil
        do {
            // Explicit user action only; AppStore.sync may show Apple's authentication UI.
            try await AppStore.sync()
            try await refreshEntitlements()
            await refreshThemesQuietly()
            emitState()
            call.resolve(state)
            preloadAd()
        } catch {
            report("Purchases could not be restored. Please check your connection and try again.", error: error)
            call.reject("Purchases could not be restored. Please try again.")
        }
    }

    func showPrivacyOptions(_ call: CAPPluginCall) async {
        guard !busy else { call.reject("Monetization is busy. Please try again."); return }
        busy = true
        defer { busy = false }
        message = nil
        consentCompleted = false
        discardCachedAd()
        do {
            try await refreshEntitlements()
            // Paid users may explicitly manage a previous choice without initializing ads.
            try await updateConsentInformation()
            guard let controller else { throw MonetizationError.presentationUnavailable }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                ConsentForm.presentPrivacyOptionsForm(from: controller) { error in
                    if let error { continuation.resume(throwing: error) }
                    else { continuation.resume() }
                }
            }
            updatePrivacyRequirement()
            consentCompleted = true
            emitState()
            call.resolve(state)
            preloadAd()
        } catch {
            updatePrivacyRequirement()
            report("Privacy choices could not be opened. Ads are paused; please try again later.", error: error)
            call.reject("Privacy choices could not be opened. Please try again later.")
        }
    }
}

// MARK: - Cosmetic theme unlocks
//
// Themes are separate non-consumable products (MonetizationThemeProductIDs in Info.plist).
// They are presentation-only and never touch ad state; this code deliberately does not share
// the Remove Ads entitlement revision logic. Ownership is always derived from verified
// StoreKit transactions, so reinstalling or restoring on another device brings themes back.
extension MonetizationManager {
    fileprivate func fetchThemeProducts() async throws {
        guard !themeProductIDs.isEmpty else { return }
        let ids = themeProductIDs
        let products = try await Deadline<[Product]>().run(seconds: 8) {
            try await Product.products(for: ids)
        }
        var found: [String: Product] = [:]
        for candidate in products where ids.contains(candidate.id) && candidate.type == .nonConsumable {
            found[candidate.id] = candidate
        }
        themeProducts = found
    }

    fileprivate func refreshThemeEntitlements() async throws {
        guard !themeProductIDs.isEmpty else { return }
        let ids = Set(themeProductIDs)
        let owned = try await Deadline<Set<String>>().run(seconds: 8) {
            var owned = Set<String>()
            for await result in Transaction.currentEntitlements {
                try Task.checkCancellation()
                // Unverified transactions never grant a theme.
                guard case .verified(let transaction) = result,
                      ids.contains(transaction.productID),
                      transaction.productType == .nonConsumable,
                      transaction.revocationDate == nil else { continue }
                owned.insert(transaction.productID)
            }
            return owned
        }
        ownedThemes = owned
    }

    // Theme data is optional polish: failures are logged, never block play or ads.
    fileprivate func refreshThemesQuietly() async {
        do { try await refreshThemeEntitlements() }
        catch { logger.notice("Theme ownership could not be refreshed. Error code: \((error as NSError).code)") }
    }

    fileprivate func loadThemesQuietly() async {
        await refreshThemesQuietly()
        do { try await fetchThemeProducts() }
        catch { logger.notice("Theme pricing could not be loaded. Error code: \((error as NSError).code)") }
    }

    // Called from Transaction.updates: Ask to Buy approvals, purchases on another device, refunds.
    fileprivate func handleThemeTransaction(_ transaction: Transaction) async {
        if transaction.revocationDate == nil && !transaction.isUpgraded {
            ownedThemes.insert(transaction.productID)
        } else {
            ownedThemes.remove(transaction.productID)
        }
        await transaction.finish()
        emitState()
    }

    func purchaseTheme(_ call: CAPPluginCall) async {
        guard let id = call.getString("id"), themeProductIDs.contains(id) else {
            call.reject("Unknown theme.")
            return
        }
        guard !busy else { call.reject("Monetization is busy. Please try again."); return }
        busy = true
        defer { busy = false }
        message = nil
        do {
            await refreshThemesQuietly()
            if ownedThemes.contains(id) {
                emitState()
                call.resolve(["status": "purchased", "id": id, "ownedThemes": ownedThemes.sorted()])
                return
            }
            guard controller != nil else { throw MonetizationError.presentationUnavailable }
            if themeProducts[id] == nil { try await fetchThemeProducts() }
            guard let themeProduct = themeProducts[id] else { throw MonetizationError.themeUnavailable }
            let result = try await themeProduct.purchase()
            let status: String
            switch result {
            case .success(let verification):
                guard case .verified(let transaction) = verification,
                      transaction.productID == id,
                      transaction.productType == .nonConsumable else {
                    throw MonetizationError.verificationFailed
                }
                if transaction.revocationDate == nil && !transaction.isUpgraded { ownedThemes.insert(id) }
                await transaction.finish()
                guard ownedThemes.contains(id) else { throw MonetizationError.verificationFailed }
                status = "purchased"
            case .userCancelled:
                status = "cancelled"
            case .pending:
                status = "pending"
                message = "Purchase awaiting approval. The theme will unlock when Apple confirms it."
            @unknown default:
                throw MonetizationError.verificationFailed
            }
            emitState()
            call.resolve(["status": status, "id": id, "ownedThemes": ownedThemes.sorted()])
        } catch {
            report("Theme purchase could not be completed. Check your connection or try Restore Purchases.", error: error)
            call.reject("Theme purchase could not be completed. Please try again or Restore Purchases.")
        }
    }
}
