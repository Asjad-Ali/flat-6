# Privacy Policy: Flat Expense Manager

_Last updated: 9 November 2026_

Flat Expense Manager ("the app") helps people who share a flat record shared expenses and see who owes whom. This policy explains what data the app handles and why.

## What data the app stores

- **Member details** entered by the group's admin: name, login username, and optionally phone number, email address and notes.
- **Financial records** entered by members: expense titles, descriptions, amounts, categories, dates, who paid, how each expense was split, payments between members, and who added each entry.
- **Login session:** a sign-in token kept on your phone so you stay logged in.
- **Notification address:** if you allow notifications, a push token for your phone, used only to tell you when a flatmate adds an expense or payment. Notifications are delivered through Expo's push service and Google's Firebase Cloud Messaging.

The app does **not** collect your location, contacts, photos, device identifiers or advertising IDs. It contains **no ads, no analytics and no tracking**.

## Where the data is kept

- **Shared mode** (members log in): records are stored in the group's own database on Google Firebase (firebase.google.com), so they can sync between the group's phones. Logins are handled by Firebase Authentication. A copy is also kept on each member's phone so it can be viewed offline.
- **Local mode** (no login): all records stay only on that phone.

## Who can see the data

Only logged-in members of the same flat group can read the group's records. Access is enforced by the database. Records are **never sold or shared** with anyone else. Only the member who added an expense or payment can change or delete it. Notification text (for example "Ali added Groceries") passes through Expo and Google to reach your phone.

## Security

Data is sent over encrypted connections (HTTPS). Database access rules ensure only members of the group can read it.

## Keeping and deleting data

Records are kept so the group has a complete history.

- To delete your account and data, ask the group's admin, or contact the developer at the address below. We will remove your login and personal details.
- Logging out removes the shared data from your phone.
- Uninstalling the app removes everything stored on that phone.

## Children

The app is not directed at children under 13.

## Contact

Questions or deletion requests: **YOUR_CONTACT_EMAIL** (replace with the email you want to show publicly)

## Changes

If this policy changes, the updated version will be posted at this address with a new date.
