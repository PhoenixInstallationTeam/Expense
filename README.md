# Settled — Shared Expense Manager (GitHub Pages + Google Sheet)

This version intentionally removes the React/Vite build step. It is plain HTML/CSS/JavaScript, so GitHub Pages can serve it directly from the `main` branch without GitHub Actions. This avoids the blank-screen/build failure that can happen when the source files are uploaded but the Vite build is not deployed.

## Architecture

```text
GitHub Pages
    │
    │ static website
    ▼
Settled frontend
    │
    ├── JSONP reads
    └── POST writes
    ▼
Google Apps Script Web App
    │
    ▼
Google Sheet (shared master ledger)
    ├── Users
    ├── Groups
    ├── Expenses
    └── Splits
```

Every user reads/writes the same Google Sheet. The browser no longer uses localStorage as the source of truth.

## 1. Create the shared Google Sheet backend

1. Open Google Drive and create a Google Sheet, for example `Settled Shared Ledger`.
2. Open **Extensions → Apps Script**.
3. Open `backend/Code.gs` from this package.
4. Paste the code into Apps Script.
5. Change:
   `appKey: "CHANGE_ME_SETTLED_KEY"`
   to any random value.
6. Save.
7. Run the `setup` function once.
8. Google will ask you to authorize the script. Allow it.
9. Back in Apps Script: **Deploy → New deployment**.
10. Select **Web app**.
11. **Execute as:** Me.
12. **Who has access:** Anyone.
13. Deploy.
14. Copy the URL ending in `/exec`.

Google Apps Script web-app deployments have configurable access and execution identity; the deployment URL is the API endpoint used by this frontend.

## 2. Connect GitHub Pages to the shared sheet

Open `app.js` and change:

```js
apiUrl: "PASTE_GOOGLE_APPS_SCRIPT_EXEC_URL_HERE",
```

to your Apps Script `/exec` URL.

No other URL is required.

## 3. Upload directly to GitHub

Repository:

`https://github.com/phoenixinstallationteam/Expense`

Upload these items to the **repository root**:

```text
index.html
app.js
styles.css
backend/Code.gs
README.md
```

There is deliberately no `package.json` and no `.github/workflows/deploy.yml` in this edition.

Commit directly to `main`.

## 4. Change GitHub Pages source

Repository → **Settings → Pages**

Set:

```text
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

Save.

After GitHub Pages publishes, open:

`https://phoenixinstallationteam.github.io/Expense/`

## 5. Login

All five accounts are created by `setup()`:

- Gobinath / `Ins@12345`
- Prashandh / `Ins@12345`
- Sundarram / `Ins@12345`
- Karthikeyan / `Ins@12345`
- Thanis / `Ins@12345`

## 6. What is now shared

Gobinath enters an expense on one device → it is written into the Google Sheet → Prashandh, Sundarram, Karthikeyan and Thanis see the same expense after refreshing/loading the app.

The shared source of truth is the Google Sheet, not browser localStorage.

## 7. Excel download

The app has a **Download Excel** button. It exports the active group's Expenses, Balances and Settlements into an Excel-compatible `.xls` file directly in the browser.

The Google Sheet itself remains the live master ledger and can also be opened with **Shared Sheet**.

## Important security note

This is a practical small-group solution, not high-security enterprise authentication. The predefined credentials live in the Google Sheet and are validated by Apps Script. The Apps Script web app is public so the GitHub Pages frontend can reach it. For genuine confidential enterprise authentication and authorization, use a managed backend such as Supabase Auth/Postgres or another server-side identity/database platform.

## Troubleshooting the previous blank page

The old version required a successful Vite build and Pages artifact deployment. This edition does not. If this page is blank after upload, open the repository root and verify that `index.html` is directly visible beside `app.js` and `styles.css`, not inside another folder.
