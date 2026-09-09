# Quntet Friends Expense Manager — Enterprise-style v5

This package keeps the existing infrastructure but replaces the frontend and backend logic with a more complete shared-ledger workflow.

## Architecture

```text
GitHub Pages
    |
    v
Quntet static website
    |
    | JSONP reads + POST writes
    v
Google Apps Script Web App
    |
    v
Shared Google Sheet
    ├─ Users
    ├─ Groups
    ├─ Expenses
    ├─ Splits
    └─ Settlements
```

There is no Vite, React build or npm dependency. GitHub Pages can publish the repository root directly.

## New features

- Quntet branding
- "Friends Group" default group
- 5 preconfigured users
- Fixed password `Ins@12345`
- Admin: Gobinath
- All members: Gobinath, Prashandh, Sundarram, Karthikeyan, Thanis
- Shared Google Sheet as the source of truth
- Multiple payers
- Equal split
- Custom split with validation
- Created-by tracking
- Date and notes
- 30 expense categories
- Admin edit/delete for every expense
- Advanced settlement records
- Pending / Paid / Received settlement status
- Payer, recipient or admin can complete a settlement
- Admin can reverse completed settlements
- Completed settlements are applied to outstanding balances
- Settlement plan recalculates after payments
- Shared Sheet button
- Excel-compatible `.xls` export
- Expenses, Balances, Outstanding Settlements and Settlement History sheets in the export
- LockService for concurrent backend writes
- Passwords stored as SHA-256 hashes in the Users sheet
- `setup()` is non-destructive: it only seeds missing sheets/users/default group

## Fix for Sundarram login

The backend login was hardened:
- username matching is case-insensitive and trimmed
- accounts are seeded consistently
- active users are checked
- passwords are hashed in the sheet
- all five users use the same required password
- failed/invalid session users are rejected cleanly

Do not manually edit the password hash unless you know the hashing format. Run `setup()` once.

## First-time / backend setup

1. Create or use the existing shared Google Sheet.
2. **Extensions -> Apps Script**.
3. Replace the old backend code with `backend/Code.gs`.
4. Save.
5. Run `setup()` once and authorize it.
6. Deploy -> New deployment -> Web app.
7. Execute as: **Me**.
8. Who has access: **Anyone**.
9. Copy the `/exec` URL.

## Connect the website

Open `app.js` and replace:

```javascript
apiUrl: "PASTE_GOOGLE_APPS_SCRIPT_EXEC_URL_HERE",
```

with your Apps Script `/exec` URL.

Do not change the rest of the API configuration.

## GitHub Pages

For:

`https://github.com/phoenixinstallationteam/Expense`

Upload the following to the repository root:

```text
index.html
app.js
styles.css
README.md
backend/
    Code.gs
```

Do not upload the older React/Vite files for this version.

GitHub repository settings:

```text
Settings
  -> Pages
  -> Build and deployment
  -> Source: Deploy from a branch
  -> Branch: main
  -> Folder: / (root)
```

Website:

`https://phoenixinstallationteam.github.io/Expense/`

## Existing Google Sheet data

This version uses the same sheet-based architecture but creates a revised schema. Because old v3/v4 sheets may have incompatible column layouts, take a backup of the existing spreadsheet before running the new `setup()`.

The new backend uses:

- `Users`
- `Groups`
- `Expenses`
- `Splits`
- `Settlements`

If this is a clean deployment, simply run `setup()`.

## Settlement behavior

Example:

```text
Gobinath owes Sundarram ₹152.40
Prashandh owes Sundarram ₹192.40
Karthikeyan owes Sundarram ₹192.40
Thanis owes Sundarram ₹72.40
```

Admin clicks **Create settlement records**.

Each payment becomes a tracked record.

The payer can click **Mark Paid**.

The recipient can click **Received**.

Once completed, that payment is applied back into the outstanding balance calculation. The settlement screen therefore shows what is still unpaid, not the original static plan.

Admin can reverse a completed settlement if it was entered incorrectly.

## Admin permissions

Gobinath is the admin and can:

- create groups
- edit expenses
- delete expenses
- create settlement records
- mark/reverse settlements
- manage the ledger across all members

Regular users can:

- log in
- view the shared ledger
- add expenses
- mark their own outgoing payment as paid
- confirm incoming payment as received

## Categories

The app includes:

Food, Dining, Party, Treat, Gift, Movie, Snacks, Travel, Transport, Fuel, Hotel, Tickets, Entertainment, Shopping, Groceries, Bills, Electricity, Internet, Rent, Parking, Recharge, Sports, Games, Birthday, Celebration, Medical, Education, Office, Utilities, Other.

## Security note

This remains a small-group Google Apps Script + Google Sheet solution, not a full enterprise identity platform. The web app endpoint is public so GitHub Pages can reach it. For stronger security, replace the login layer with a managed authentication service and server-side authorization.
