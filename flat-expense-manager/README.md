# Flat Expense Manager

A simple, offline Android app for flatmates, in the style of Tricount. Record **who paid** for each shared expense and **who it's split between**. The app shows everyone's balance and **who should pay whom** to settle up. Every record is saved on the phone (SQLite).

Built with Expo SDK 58, React Native, TypeScript, Expo Router and expo-sqlite.

## Two modes

- **Shared mode (6 phones, login + live sync):** set up Supabase and build the APK by following **[SETUP-SHARED.md](SETUP-SHARED.md)**. Only the person who added an expense or payment can change or delete it.
- **Local mode:** with no Supabase settings, everything stays on one phone with no login.

## Running

```bash
npm install
npm start              # then scan the QR code with Expo Go, or press w for web
npm test               # money, splitting, settle-up and database tests
npm run typecheck
npm run lint
```

To build an installable APK, run `npx eas-cli@latest build -p android --profile preview`.

## How it works

1. **Members**: add everyone in the flat. A member with history is archived instead of deleted, so old records stay.
2. **Add expense**: enter a title and amount, choose who paid, and choose who shares it.
   - **Equally**: tick the people sharing it. Leftover paisa from rounding are handled automatically.
   - **By amounts**: type each person's exact share. It must add up to the total, and "+ Add rest" fills in the remainder.
3. **Balances**: balance = what you paid − your share. Green means you get money back; red means you owe.
4. **Settle up**: the app lists the fewest payments needed, e.g. "Bilal pays Usman Rs. 10,550".
   - **Mark paid** records the full amount.
   - **Record payment** records any amount, including partial payments.
5. **Reports**: daily, weekly, monthly and per-member totals.

## Architecture

```
src/app/         Screens (tabs: Home, Expenses, Balances, Members, Reports)
src/domain/      Pure logic: money (integer paisa), dates, equal split, settle-up plan
src/db/          SQLite schema + migrations; repositories for members, expenses, settlements, balances, reports
src/components/  Shared UI kit
__tests__/       Jest tests; repository SQL runs against real SQLite (node:sqlite)
```

- Money is stored as integer paisa, so there are no rounding errors.
- Balances are calculated from expenses and payments, never stored, so they always add up to zero.
- Possible duplicate expenses or payments must be confirmed before saving.
- Deleting anything asks for confirmation first.

## Database

| Table | Purpose |
|---|---|
| `members` | name, phone, email, notes, `is_active` |
| `expenses` | title, amount (paisa), category, date, `paid_by`, `split_mode` |
| `expense_splits` | each member's share of an expense |
| `settlements` | a member paying another member back |
| `weeks`, `distributions`, `distribution_shares`, `payments` | from the earlier weekly-pool version; kept so no saved data is lost |
