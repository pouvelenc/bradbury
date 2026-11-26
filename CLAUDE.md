# Bradbury Challenge: notes for Claude

A static GitHub Pages site (`pouvelenc/bradbury`) that shows a daily poem, essay and short story. The owner reads on their phone, ticks pieces as read and rates them 1–5. You curate the reading list one month at a time.

## Data files

### `data/readings.csv` (you edit this)
`date,type,title,author,url,source,note`
- `date`: `YYYY-MM-DD`, one row per piece, normally 3 rows per day.
- `type`: `poem`, `essay` or `story`. Extra pieces of the same type on one day are allowed and show as "bonus".
- `url`: where the piece can be read for free online. Check that each URL works and points to the full text, not an excerpt or paywall. If there's no free copy, leave `url` empty and name the book or anthology in `source`.
- `source`: publication and year, e.g. `"The New Yorker, 1948"`. Quote fields that contain commas.
- `note`: optional, one line on why the piece was picked. It is shown on the card.
- Rows with `Sample entry` in the note are placeholders. Replace them.
- Don't change the date or type of past rows: progress is keyed by `date` + slot (the type, plus `2`, `3`… for bonus pieces in CSV order).

### `data/progress.csv` (the phone writes this; don't hand-edit unless asked)
`date,type,read,rating,updated`. Here `type` is the slot id (`poem`, `essay`, `story`, `poem2`…), `read` is 1/0, `rating` is empty or 1–5, and `updated` is an ISO timestamp. The newest `updated` wins when the page merges, so don't hand-edit rows.

## Monthly curation

The owner asks something like "curate January". Then:
1. `git pull` (the phone commits progress throughout the month).
2. Join `readings.csv` with `progress.csv` on `date` + slot. Summarise average rating and read rate by type, author, period, region/language, form and source. Note pieces left unread.
3. Propose the next month's list: lean towards what scored well, keep variety (eras, countries, translated work, women and men, forms), and avoid repeating authors too often. One poem, one essay and one short story per day, sized to be readable in a sitting. Check every URL.
4. Show the proposal and ask for changes, then append the rows to `readings.csv` in date order and push to `main`. The Pages workflow redeploys automatically.

## Code

- `lib.js`: pure functions (CSV parsing, dates, slot ids, progress merging) with no DOM, so they can be tested in Node by copying to `.mjs`.
- `app.js`: rendering, navigation (`#YYYY-MM-DD` hash), localStorage cache and GitHub Contents API sync (GET for sha, merge, then PUT, retrying on 409/422).
- The deploy workflow copies only the site files into `_site`. Add any new site file to its `cp` line.
