# Bradbury Challenge: notes for Claude

A static GitHub Pages site (`pouvelenc/bradbury`) that shows a daily poem, essay and short story. The owner reads on their phone, ticks pieces as read and rates them 1–5. You curate the reading list one month at a time.

## Data files

### `data/readings.csv` (you edit this)
`date,type,lang,title,author,url,source,note`
- `date`: `YYYY-MM-DD`, one row per piece, normally 3 rows per day.
- `type`: `poem`, `essay` or `story`. Extra pieces of the same type on one day are allowed and show as "bonus".
- `lang`: `en` or `sv`. Swedish pieces get Swedish card labels ("Dikt", "Essä", "Novell", "Av …", "Läs online ↗") and a Swedish `note`.
- `url`: where the piece can be read for free online. Check that each URL works and points to the full text, not an excerpt or paywall. If there's no free copy, leave `url` empty and name the book or anthology in `source`.
- `source`: publication and year, e.g. `"The New Yorker, 1948"`. Quote fields that contain commas.
- `note`: one or two sentences on the piece's content or historical context, shown on the card. Write in a dry, factual style:
  - Don't address the reader or refer to their interests, other days or our conversations.
  - Avoid clichés and slogan constructions such as "X meets Y", "X vs Y" or "X: Y".
  - Put reading instructions (e.g. "första kapitlet") in `source`, not here.
- Rows with `Sample entry` in the note are placeholders. Replace them.
- Don't change the date or type of past rows: progress is keyed by `date` + slot (the type, plus `2`, `3`… for bonus pieces in CSV order).

### `data/progress.csv` (the phone writes this; don't hand-edit unless asked)
`date,type,read,rating,updated`. Here `type` is the slot id (`poem`, `essay`, `story`, `poem2`…), `read` is 1/0, `rating` is empty or 1–5, and `updated` is an ISO timestamp. The newest `updated` wins when the page merges, so don't hand-edit rows.

## Monthly curation

The owner asks something like "curate January". Then:
1. `git pull` (the phone commits progress throughout the month).
2. Join `readings.csv` with `progress.csv` on `date` + slot. Summarise average rating and read rate by type, language, author, period, region, form and source. Note pieces left unread.
3. Propose the next month's list: lean towards what scored well, keep variety (eras, countries, translated work, women and men, forms), and avoid repeating authors too often. One poem, one essay and one short story per day, sized to be readable in a sitting. Check every URL and every fact stated in a note.
4. Show the proposal and ask for changes, then append the rows to `readings.csv` in date order and push to `main`. The Pages workflow redeploys automatically.

### The owner's standing preferences (set for December 2026)
- **Language:** half English, half Swedish, rotating daily. Odd days: Swedish poem, English essay, Swedish story; even days the reverse. Swedish means written in Swedish (Finland-Swedish included); older spelling is fine.
- **Interests:** political philosophy, natural philosophy and the foundations of physics (degrees in physics and CS). Favourite authors: Ishiguro, Lem, Borges, Le Guin, Tegmark, Ted Chiang. Favourite essay: Orwell's "Politics and the English Language". Still keep a broad range of topics and styles.
- **Favourites' famous works:** prefer lesser-known or uncollected pieces by favourite authors; their best-known works are probably already read.
- **Availability:** mostly legitimate free online texts; about one book-only piece a week. The owner can borrow from the KTH Library, which is useful for contemporary Swedish writing. Mark such rows "Finns på KTH-biblioteket" in `source`.
- **Gender balance:** aim for a fairly even split. December 2026 was 43% women, up from a first draft of 27%.
- **Paywalls:** New Yorker paywalled links are acceptable.
- **Length:** about 30–45 minutes a day on weekdays, longer pieces on weekends.

### Sourcing tips
- **Litteraturbanken:** has a JSON API that lists works and their parts (titles plus start pages), giving direct links like `…/författare/<id>/titlar/<titlepath>/sida/<page>/etext`. Example query: `https://litteraturbanken.se/api/list_all/etext?filter_and={"main_author.authorid":"BoyeK"}&include=title,titlepath,parts,pages`. The site returns 200 for any path, so check links against the API, not with HTTP status.
- **Wikisource:** rate-limits fast requests. Use a descriptive User-Agent and wait several seconds between requests. Some titles are version or index pages; link the specific edition.
- **Sveriges Radio OBS essays:** audio only, with no transcript.
- **KTH Library catalogue (Primo):** has a guest search:
  - Get a token from `https://kth-ch.primo.exlibrisgroup.com/primaws/rest/pub/institution/46KTH_INST/guestJwt?isGuest=true&lang=sv&targetUrl=&viewId=46KTH_INST:46KTH_VU1_L`.
  - Search `…/primaws/rest/pub/pnxs?q=any,contains,<query>&vid=46KTH_INST:46KTH_VU1_L&tab=Everything&scope=MyInstitution&inst=46KTH_INST&limit=5` with header `Authorization: Bearer <token>`.
  - `delivery.availability` shows `available_in_library` for shelf copies.
  - KTH holds little Swedish fiction, but some contemporary essays and novels.
- **Bot-blocked sites:** Poetry Foundation, NYT and The Atlantic often block scripts but work in a browser.

## Code

- `lib.js`: pure functions (CSV parsing, dates, slot ids, progress merging) with no DOM, so they can be tested in Node by copying to `.mjs`.
- `app.js`: rendering, navigation (`#YYYY-MM-DD` hash), localStorage cache and GitHub Contents API sync (GET for sha, merge, then PUT, retrying on 409/422).
- The deploy workflow copies only the site files into `_site`. Add any new site file to its `cp` line.
