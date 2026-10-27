import Capacitor

final class MonetizationBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(MonetizationPlugin())
        bridge?.registerPluginInstance(GameCenterPlugin())
    }
}
