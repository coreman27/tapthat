import Capacitor
import GameKit
import UIKit

/// Game Center for the web layer: sign-in, posting scores, reading a leaderboard (with the
/// current period of a recurring one, so the weekly challenge rolls over on Apple's schedule),
/// and opening the Game Center dashboard. Names, moderation and friends are Apple's.
@objc(GameCenterPlugin)
public final class GameCenterPlugin: CAPPlugin, CAPBridgedPlugin, GKGameCenterControllerDelegate {
    public let identifier = "GameCenterPlugin"
    public let jsName = "GameCenter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "submitScore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "loadBoard", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLeaderboard", returnType: CAPPluginReturnPromise)
    ]

    private var handlerInstalled = false
    private var settled = false
    private var waiting: [CAPPluginCall] = []

    // MARK: sign-in

    /// Installs Apple's authentication handler once. Apple calls it again whenever the sign-in
    /// state changes (for example after signing in from Settings), so changes are also pushed
    /// to the web layer as "authChanged" events.
    @objc func authenticate(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.settled {
                call.resolve(self.playerState(nil))
                return
            }
            self.waiting.append(call)
            guard !self.handlerInstalled else { return }
            self.handlerInstalled = true
            GKLocalPlayer.local.authenticateHandler = { [weak self] viewController, error in
                guard let self else { return }
                if let viewController {
                    // Apple's own sign-in sheet; the handler runs again once it is dismissed.
                    self.bridge?.viewController?.present(viewController, animated: true)
                    return
                }
                self.settled = true
                let state = self.playerState(error)
                let calls = self.waiting
                self.waiting = []
                calls.forEach { $0.resolve(state) }
                self.notifyListeners("authChanged", data: state)
            }
        }
    }

    private func playerState(_ error: Error?) -> [String: Any] {
        let player = GKLocalPlayer.local
        var state: [String: Any] = [
            "authenticated": player.isAuthenticated,
            "displayName": player.isAuthenticated ? player.displayName : ""
        ]
        if let error { state["error"] = error.localizedDescription }
        return state
    }

    // MARK: scores

    @objc func submitScore(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Sign in to Game Center to post scores.", "not_authenticated")
            return
        }
        guard let score = call.getInt("score"), score > 0,
              let ids = call.getArray("leaderboardIDs", String.self), !ids.isEmpty else {
            call.reject("Invalid score.", "invalid")
            return
        }
        GKLeaderboard.submitScore(score, context: 0, player: GKLocalPlayer.local, leaderboardIDs: ids) { error in
            if let error {
                call.reject(error.localizedDescription, "submit_failed", error)
            } else {
                call.resolve(["ok": true])
            }
        }
    }

    // MARK: reading a leaderboard

    private enum FriendsAccess: Error { case denied }

    @objc func loadBoard(_ call: CAPPluginCall) {
        guard GKLocalPlayer.local.isAuthenticated else {
            call.reject("Sign in to Game Center to see the leaderboard.", "not_authenticated")
            return
        }
        guard let id = call.getString("id"), !id.isEmpty else {
            call.reject("Missing leaderboard id.", "invalid")
            return
        }
        let friends = call.getString("scope") == "friends"
        let count = max(1, min(call.getInt("count") ?? 10, 50))
        Task { @MainActor in
            do {
                if friends { try await self.ensureFriendsAccess() }
                guard let board = try await GKLeaderboard.loadLeaderboards(IDs: [id]).first else {
                    call.reject("That leaderboard is not available yet.", "not_found")
                    return
                }
                let (local, entries, total) = try await board.loadEntries(
                    for: friends ? .friendsOnly : .global,
                    timeScope: .allTime,
                    range: NSRange(location: 1, length: count))
                var result: [String: Any] = ["entries": entries.map(self.row), "total": total]
                if let local { result["you"] = self.row(local) }
                // A recurring leaderboard's current period: the weekly challenge follows it.
                if board.type == .recurring, let start = board.startDate {
                    let end = board.nextStartDate ?? start.addingTimeInterval(board.duration)
                    result["period"] = ["start": start.timeIntervalSince1970 * 1000, "end": end.timeIntervalSince1970 * 1000]
                }
                call.resolve(result)
            } catch FriendsAccess.denied {
                call.reject("Friends are hidden. Allow access in Settings › Game Center › Friends.", "friends_denied")
            } catch {
                call.reject(error.localizedDescription, "load_failed", error)
            }
        }
    }

    private func row(_ entry: GKLeaderboard.Entry) -> [String: Any] {
        [
            "rank": entry.rank,
            "score": entry.score,
            "name": entry.player.displayName,
            "mine": entry.player.gamePlayerID == GKLocalPlayer.local.gamePlayerID
        ]
    }

    /// Friends-only boards need the player's permission to read their friends list. The first
    /// time, loading friends shows Apple's prompt.
    @MainActor private func ensureFriendsAccess() async throws {
        let player = GKLocalPlayer.local
        switch try await player.loadFriendsAuthorizationStatus() {
        case .authorized:
            return
        case .notDetermined:
            _ = try? await player.loadFriends()
            if try await player.loadFriendsAuthorizationStatus() != .authorized { throw FriendsAccess.denied }
        default:
            throw FriendsAccess.denied
        }
    }

    // MARK: Apple's dashboard

    @objc func showLeaderboard(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard GKLocalPlayer.local.isAuthenticated else {
                call.reject("Sign in to Game Center first.", "not_authenticated")
                return
            }
            let controller: GKGameCenterViewController
            if let id = call.getString("id"), !id.isEmpty {
                controller = GKGameCenterViewController(leaderboardID: id, playerScope: .global, timeScope: .allTime)
            } else {
                controller = GKGameCenterViewController(state: .leaderboards)
            }
            controller.gameCenterDelegate = self
            self.bridge?.viewController?.present(controller, animated: true)
            call.resolve()
        }
    }

    public func gameCenterViewControllerDidFinish(_ gameCenterViewController: GKGameCenterViewController) {
        gameCenterViewController.dismiss(animated: true)
    }
}
