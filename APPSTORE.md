# Shipping DON'T TAP THAT to the App Store

The native iOS project already exists in `ios/`, builds cleanly, and runs in the Simulator. This guide takes it from here to a live App Store listing.

**App identity (already configured):**
- App name / display name: **DON'T TAP THAT**
- Bundle ID: **com.tapthat.game** (`capacitor.config.json` + Xcode)
- Orientation: portrait only • Status bar hidden • Icons + splash generated

---

## 0. One-time prerequisites

1. **Apple Developer Program** membership — https://developer.apple.com/programs/ ($99/year). Required to ship to the Store.
2. Xcode signed in with your Apple ID: **Xcode ▸ Settings ▸ Accounts ▸ +**.
3. Confirm the bundle ID `com.tapthat.game` is available (or change it — see step 5).

---

## 1. Rebuild web assets into the native app

Any time you change the game (`index.html`, `js/`, `css/`), re-sync:

```bash
cd tapthat
npm run ios        # builds www/, runs cap sync ios, opens Xcode
```

To regenerate icons/splash after an art change:

```bash
npm run assets     # regenerates icons + splash and injects the iOS asset catalog
npm run sync
```

---

## 2. Open the project in Xcode

`npm run ios` opens `ios/App/App.xcworkspace`. **Always use the `.xcworkspace`, not `.xcodeproj`** (CocoaPods).

Select the **App** target ▸ **Signing & Capabilities**:
- Check **Automatically manage signing**
- Choose your **Team**
- Xcode provisions a signing certificate + profile automatically

---

## 3. Set version & build number

App target ▸ **General**:
- **Version** (`CFBundleShortVersionString`): `1.0.0`
- **Build** (`CFBundleVersion`): `1` (increment every upload)

Deployment target: iOS 14+ is fine (Capacitor 6 default).

---

## 4. Test on a real device (recommended before submitting)

1. Plug in your iPhone, trust the Mac.
2. Pick your device in the Xcode toolbar, press **▶ Run**.
3. First run: on the iPhone, **Settings ▸ General ▸ VPN & Device Management** ▸ trust your developer cert.
4. Play a full run, trigger game over, tap **CHALLENGE A FRIEND**, confirm the share sheet works.

---

## 5. (Optional) Change the bundle ID or app name

- **Bundle ID:** edit `appId` in `capacitor.config.json`, then in Xcode set **Bundle Identifier** under Signing. Use reverse-DNS you control, e.g. `com.yourname.donttapthat`.
- **App name on the Home Screen:** `CFBundleDisplayName` in `ios/App/App/Info.plist`.

---

## 6. Create the app record in App Store Connect

1. Go to https://appstoreconnect.apple.com ▸ **Apps ▸ +** ▸ **New App**.
2. Platform **iOS**, pick the **bundle ID**, set the **SKU** (any unique string, e.g. `donttapthat001`), primary language.
3. Fill in the listing:
   - **Name:** DON'T TAP THAT (must be unique on the Store; have a backup like "Don't Tap That!" ready)
   - **Subtitle:** e.g. "Obey the command. Or don't."
   - **Category:** Games ▸ Arcade / Puzzle
   - **Description, keywords, support URL, marketing URL**
   - **Privacy Policy URL** (required — even a simple page) — **live now:** https://d10kns7njmuyxo.cloudfront.net/privacy.html
   - **Age rating** questionnaire
4. **App Privacy:** the game stores best score + name **locally only** and uses **no analytics, no accounts, no tracking**. Declare "Data Not Collected" (accurate for the current build).
5. **Screenshots** (required): 6.9"/6.7" iPhone is the required slot. A ready-to-upload
   6.9" hero shot (1320×2868, iPhone 17 Pro Max) is already captured at
   `store-screenshots/01-home.png`. Capture more gameplay shots from the Simulator
   (play a run, hit game over, etc.):
   ```bash
   # the app is already built + installed on the booted iPhone 17 Pro Max sim;
   # tap through the game, then grab another state:
   xcrun simctl io booted screenshot store-screenshots/02-gameplay.png
   ```
   Any earlier size (6.5" 1284×2778) can be captured the same way from an iPhone 11/XS Max sim.

---

## 7. Archive & upload

In Xcode:
1. Toolbar destination ▸ **Any iOS Device (arm64)**.
2. **Product ▸ Archive** (this Release-builds and signs).
3. When the Organizer opens: **Distribute App ▸ App Store Connect ▸ Upload**.
4. Keep the defaults (upload symbols, manage signing automatically). Xcode uploads the build.

*(CLI alternative, once signing is set up:)*
```bash
cd ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -archivePath build/App.xcarchive archive
xcodebuild -exportArchive -archivePath build/App.xcarchive \
  -exportPath build/ipa -exportOptionsPlist ExportOptions.plist
xcrun altool --upload-app -f build/ipa/App.ipa --type ios \
  --apiKey <KEY_ID> --apiIssuer <ISSUER_ID>
```

---

## 8. Submit for review

1. In App Store Connect, the uploaded build appears under **TestFlight** in a few minutes (processing).
2. (Optional) Test via **TestFlight** on your device/friends first.
3. On the app's **App Store** tab, select the build, complete metadata, then **Add for Review ▸ Submit**.
4. Review typically takes 24–48h. Fix any rejections and resubmit.

---

## Review-readiness checklist

- [x] Portrait-locked, status bar hidden, safe-area aware (no notch clipping)
- [x] App icon 1024×1024, opaque, no alpha (Apple rejects transparency)
- [x] Launch screen present
- [x] Builds & runs on device/Simulator
- [x] No accounts, no data collection → simplest privacy declaration
- [ ] Apple Developer account + signing team selected  *(account enrolled ✅ — select your Team in Xcode ▸ Signing & Capabilities)*
- [x] Privacy Policy URL live → https://d10kns7njmuyxo.cloudfront.net/privacy.html
- [~] Screenshots captured *(6.9" hero shot ready in `store-screenshots/`; add gameplay shots)*
- [x] Version 1.0.0 / build 1 set *(MARKETING_VERSION=1.0.0, CURRENT_PROJECT_VERSION=1)*

## Common rejection pitfalls (already handled or easy)
- **Transparent/rounded 1024 icon** → we ship an opaque full-bleed icon. ✅
- **Crashes on launch** → verified launches in Simulator. ✅
- **Broken links / privacy policy missing** → live at https://d10kns7njmuyxo.cloudfront.net/privacy.html (declares "Data Not Collected"). ✅
- **"App is just a website"** → this is a self-contained game (all logic bundled, works offline), not a web viewer, which satisfies guideline 4.2.
