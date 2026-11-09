# Shared setup: 6 phones, one flat

Each flatmate logs in on their own phone. Every expense and payment syncs to all phones. Only the person who added an entry can change or delete it.

The setup takes about 20 minutes and is done once, by one person (the admin).

## 1. Create the online database (Supabase, free)

1. Go to <https://supabase.com>, sign up, and click **New project**. Choose any name and a strong database password, and pick the region closest to you (e.g. Mumbai or Singapore).
2. When the project is ready, open **SQL Editor → New query**. Paste the whole of [`supabase/schema.sql`](supabase/schema.sql) and press **Run**.
3. Open [`supabase/members.sql`](supabase/members.sql) and change the names and usernames to your six flatmates. Usernames are lowercase, e.g. `ali`, `bilal`. Set `true` for one admin only; the admin can only add or remove flatmates. Paste it into a new query and press **Run**.
4. Create a login for each person. Go to **Authentication → Users → Add user → Create new user** and enter:
   - **Email:** `username@flat6.app`, e.g. `ali@flat6.app`. No email is ever sent.
   - **Password:** choose one and give it to that person.
   - Tick **Auto Confirm User**.
5. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.

## 2. Put the keys in the app

- **For testing on your computer:** copy `.env.example` to `.env` and paste both values in.
- **For the APK:** in [`eas.json`](eas.json), replace `PASTE_YOUR_SUPABASE_PROJECT_URL` and `PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY` with the same two values.

The anon key is designed to be inside apps. The database rules in `schema.sql` protect the data, so only logged-in flatmates can read it, and only through the allowed actions.

## 3. Build the APK (Expo EAS, free)

```bash
npx eas-cli@latest login            # create a free account at expo.dev if needed
npx eas-cli@latest init             # once: links this project to your Expo account
npx eas-cli@latest build -p android --profile preview
```

The build runs in Expo's cloud and takes about 10–20 minutes. When it finishes you get a **download link** for the APK.

## 4. Install on all six phones

1. Send the link on WhatsApp.
2. Each person opens it, downloads the APK, and taps it. Android asks to allow "Install unknown apps"; allow it for the browser or WhatsApp.
3. Open the app and log in with your **username** (e.g. `ali`) and password.

## How it works day to day

- Anyone can **add** an expense or record a payment. It shows on every phone within a second or two.
- Only the person who added an entry can **edit or delete** it. Everyone else sees it read-only, with "Added by …".
- **No internet?** You can still view everything saved on the phone. Adding or changing needs internet, so nobody's data conflicts.
- **New phone or reset?** Install the APK again and log in. Everything comes back, because it's stored online.
- **Forgot a password?** The admin resets it in Supabase → Authentication → Users → (person) → Reset password / Update user.
- **Someone leaves the flat?** The admin opens Members → that person → **Remove**. They can no longer log in, and all their history stays.
- **Someone new joins?** The admin adds them in the app (Members → Add member, with a login username), then creates their login in Supabase as in step 1.4.
