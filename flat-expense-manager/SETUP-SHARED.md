# Shared setup with Firebase: 6–8 phones, one flat

Every flatmate logs in on their own phone with a username and password. Expenses and payments sync to all phones, and everyone gets a notification when someone adds one. Only the person who added an entry can change or delete it.

The setup takes about 25 minutes and is done once, by the admin. Everything is on Firebase's free plan (Spark); no card is needed.

## 1. Create the Firebase project

1. Go to <https://console.firebase.google.com> and sign in with a Google account.
2. Click **Create a project** (or **Add project**). Name it e.g. `flat-6`. You can turn **Google Analytics off**.

## 2. Turn on login

1. In the left menu open **Build → Authentication** and click **Get started**.
2. On the **Sign-in method** tab choose **Email/Password**, switch **Enable** on, and **Save**.

You don't create any users here. You add your flatmates inside the app later.

## 3. Create the database and its rules

1. Open **Build → Firestore Database** and click **Create database**.
2. Choose a location close to you (e.g. `asia-south1 (Mumbai)`), then **Start in production mode**, then **Create**.
3. Open the **Rules** tab. Delete everything in the editor, paste the whole of [`firestore.rules`](firestore.rules), and click **Publish**.

These rules are what protect the data: only your flatmates can read it, and only the person who added an entry can change it.

## 4. Get the app's settings

1. Click the gear icon → **Project settings**. Under **Your apps** click the **Web** icon (`</>`).
2. Give it any nickname (e.g. `flat app`) and click **Register app**. Do not tick Hosting.
3. Firebase shows a `firebaseConfig` block with six values. Copy them into [`eas.json`](eas.json), replacing each `PASTE_…`:

| In `firebaseConfig` | In `eas.json` |
|---|---|
| `apiKey` | `EXPO_PUBLIC_FIREBASE_API_KEY` |
| `authDomain` | `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` |
| `projectId` | `EXPO_PUBLIC_FIREBASE_PROJECT_ID` |
| `storageBucket` | `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` |
| `messagingSenderId` | `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` |
| `appId` | `EXPO_PUBLIC_FIREBASE_APP_ID` |

To test on your computer first, copy `.env.example` to `.env` and paste the same values there.

These values are safe to put in the app. They only identify the project; the rules from step 3 do the protecting.

## 5. Turn on push notifications

1. In **Project settings → Your apps** click **Add app → Android**.
   - Android package name: `com.flatexpense.manager`
   - Click **Register app**, then **Download google-services.json**.
   - Put that file in the `flat-expense-manager` folder, next to `app.json`. Skip the remaining steps on that page.
2. In **Project settings → Service accounts** click **Generate new private key** and download the JSON file. Keep this file private and never share or commit it.
3. Give that key to Expo so it can deliver notifications:
   ```bash
   cd "/home/ghulam-shabbir/flat 6 app/flat-expense-manager"
   npx eas-cli@latest credentials
   ```
   Choose **Android → production → Google Service Account → Manage your Google Service Account Key for Push Notifications (FCM V1) → Set up → Upload a new service account key**, and pick the file from step 2.

If you skip this section the app still works and syncs; only the notifications are missing.

## 6. Build the APK

```bash
npx eas-cli@latest build -p android --profile preview
```

When it finishes (10–20 minutes) you get a download link for the APK.

## 7. Set up the flat (first time only)

1. Install the APK on your own phone and open it. It shows **Set up your flat**.
2. Enter your name, an admin username (e.g. `admin`) and a password of at least 6 characters, and tap **Create flat**. You are now the admin.
3. Go to **Members → Add member** for each flatmate. Enter their name, a **login username** (e.g. `ali`) and a **password**.
4. Send each flatmate the APK link plus their username and password.

Do this before sharing the APK: the first person to open the app becomes the admin.

## How it works day to day

- **Anyone can add** an expense or record a payment. It appears on every phone in a moment, and the others get a notification such as "Ali added Groceries · Rs. 3,000 · your share Rs. 500".
- **Only the person who added an entry can edit or delete it.** Everyone else, including the admin, sees it read-only with "Added by …".
- **The admin** only adds, edits and removes flatmates.
- **No internet?** You can still view everything saved on the phone. Adding or changing needs internet.
- **New phone?** Install the APK and log in. Everything comes back, because it is stored online.
- **Someone leaves?** Admin: Members → that person → edit → **Remove**. They can no longer open the flat; their history stays.
- **Forgot a password?**
  1. In the Firebase console open **Authentication → Users**, find `username@flat6.app`, and delete that user from the ⋮ menu.
  2. In the app, the admin opens Members → that person → edit, types a new password under **Forgot password?**, and taps **Set new password**. Their records are untouched.

## Good to know

- Notifications are sent from the phone of the person who adds the entry, right when they save it. That keeps the project on the free plan.
- Firebase can check who is allowed to change an entry, but not arithmetic. "Shares add up to the total" is checked by the app before saving.
- To check everything on your computer before going live, run `npm run test:firebase` (needs Java 21 or newer).
