# Bradbury Challenge

A poem, an essay and a short story every day, picked by hand.

**Site:** https://pouvelenc.github.io/bradbury/

The page shows today's three readings, based on your phone's date. Use ‹ › or swipe to move between days. For each piece you can tick **Read** and give it 1–5 stars. Tapping the current star again clears the rating. The calendar at the bottom shows what you've read this month.

## Setup on your phone (once)

1. **Create a token** at <https://github.com/settings/personal-access-tokens/new> (fine-grained token):
   - *Token name:* `bradbury-phone`
   - *Expiration:* up to a year (you'll paste a new one when it expires)
   - *Repository access:* **Only select repositories**, then pick `pouvelenc/bradbury`
   - *Permissions:* **Contents: Read and write**. Leave everything else at *No access*.
2. Open the site on your phone, tap the gear icon, paste the token and tap **Save token**.
3. **Add to Home Screen** (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen). It then opens full-screen like an app.

Without a token everything still works, but ticks and ratings stay only in that browser.

## How saving works

- Every tap is saved on the phone straight away, so the page works offline.
- A couple of seconds later the page commits the change to [`data/progress.csv`](data/progress.csv) in this repo, with commit messages like `progress: 2026-12-03 poem ✓ ★4`.
- If you're offline, it syncs the next time the page is open and online.
- The token is stored only in your phone's browser storage. To revoke it, delete it on GitHub.

## Files

| File | What it is |
|---|---|
| `data/readings.csv` | The reading list: `date,type,title,author,url,source,note`, one row per piece. |
| `data/progress.csv` | Your ticks and ratings: `date,type,read,rating,updated`. Written by the page. |
| `index.html`, `style.css`, `app.js`, `lib.js` | The page. No build step, no dependencies. |
| `fonts/` | Redaction font files (woff2) and their licence. |
| `.github/workflows/pages.yml` | Deploys to GitHub Pages on every push to `main` (except progress-only commits). |

## Design

Set in [Redaction](https://www.redaction.us/) by MCKL (Forest Young and Jeremy Mickel) for Titus Kaphar and Reginald Dwayne Betts, used under the SIL Open Font License ([`fonts/OFL.txt`](fonts/OFL.txt)). The masthead uses the slightly worn "Redaction 10" grade. The colours are newsprint and ink with the Fairphone 6 Forest Green (`#2a544e`), and in dark mode its lime accent (`#dcff51`).

## Local preview

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```
