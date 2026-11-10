# Publish to Google Play: internal testing (for your flatmates)

Internal testing puts the app on the Play Store for invited people only (up to 100). Your flatmates install it and get updates from the Play Store like any normal app, with no "unknown apps" warnings.

**Before you start:** finish [SETUP-SHARED.md](../SETUP-SHARED.md) and put your Firebase settings in `eas.json`. Upload the shared (login + sync) version, because that's the one your flatmates will use.

## 1. Create a Google Play developer account (once)

1. Go to <https://play.google.com/console> and sign in with a Google account.
2. Choose **Yourself** (personal account), pay the one-time **$25** fee, and complete identity verification. This can take a few days.

## 2. Build the Play Store file (.aab)

In the VS Code terminal:

```bash
cd "/home/ghulam-shabbir/flat 6 app/flat-expense-manager"
npx eas-cli@latest build -p android --profile production
```

This takes about 15 minutes. When it finishes, download the **`.aab`** file from the link it prints. The version number goes up automatically with every build.

## 3. Create the app in Play Console

1. **Create app**:
   - App name: `Flat Expense Manager`
   - Language: English
   - App or game: **App**
   - Free or paid: **Free**
   - Tick the declarations, then **Create app**.
2. **Dashboard → Set up your app**. Complete each item using the ready answers in [LISTING.md](LISTING.md):
   - Privacy policy (push the repo first; the link is in LISTING.md)
   - App access (give a test login for Google's reviewers)
   - Ads → No
   - Content rating
   - Target audience → 18+
   - Data safety
   - Financial features → none
   - Government app → No
3. **Store presence → Main store listing**:
   - Short and full description: copy them from LISTING.md.
   - App icon: `store/play-icon-512.png`
   - Feature graphic: `store/feature-graphic-1024x500.png`
   - Phone screenshots: upload all 6 from `store/screenshots/`.

## 4. Upload to internal testing

1. **Testing → Internal testing → Testers tab → Create email list**. Add your flatmates' Gmail addresses (the ones signed in to the Play Store on their phones). Save, and tick the list.
2. **Releases tab → Create new release**.
   - If asked about **Play App Signing**, choose **Use Google-generated key** (recommended).
   - Upload the `.aab`, write release notes (e.g. "First version"), and click **Next → Save and publish**.
3. Copy the **"Join on the web"** link from the Testers tab and send it to your flatmates on WhatsApp.

## 5. Your flatmates install it

1. Open the link on the phone, while signed in to the Gmail you added.
2. Tap **Accept invitation**, then **Download it on Google Play**.
3. Install, open, and log in with the username and password from the admin.

The first release can take from a few minutes to a few hours to appear.

## Releasing an update later

```bash
npx eas-cli@latest build -p android --profile production
```

Then in Play Console go to **Internal testing → Create new release**, upload the new `.aab`, and publish. Everyone gets the update from the Play Store.

Optional: to skip the manual upload, create a Google Cloud service account for Play Console (see <https://expo.fyi/creating-google-service-account>) and run `npx eas-cli@latest submit -p android --latest`. `eas.json` is already set to send builds to the internal track.

## Notes

- **The app ID `com.flatexpense.manager` is permanent** once uploaded. Change it in `app.json` before the first upload if you want a different one.
- **The APK you installed earlier** was signed differently, so uninstall it before installing from the Play Store. If you were using it, export a PDF report of your data first.
- **Going public later:** move a release to *Closed testing* (Google currently requires 12+ testers for 14 days for new personal accounts), then *Production*. Check Play Console for the current rule.
