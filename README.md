# Lungaversary — Celebrating Sheuli · Ten Years

A single-page mobile site for Sheuli's 10th transplant anniversary — her story, the run of show, the menu, organ-donor registration, and a place for guests to leave her a note. Built to be opened from an NFC card.

- `index.html` — the whole page (styles and script are inline, so it loads in one request)
- `images/` — photos, pre-optimized as WebP and loaded lazily
- `api/notes.js` — saves guests' notes and exports them for her keepsake book

## Deploy to Vercel (about 10 minutes)

1. **Put the folder on GitHub.** Create a new repository and upload everything in this folder (drag-and-drop works on github.com).
2. **Import it into Vercel.** On vercel.com choose **Add New → Project**, pick the repository, leave the framework as **Other**, and click **Deploy**.
3. **Add storage for notes.** In the project, open the **Storage** tab → **Create** → **Blob**, set access to **Private**, and connect it to the project (all environments).
4. **Add your export key.** Go to **Settings → Environment Variables** and add `NOTES_ADMIN_KEY` with a long secret of your choosing (e.g. `sheuli-notes-8fK2pQ...`).
5. **Redeploy** (Deployments → ⋯ → Redeploy) so the storage and key take effect.

Your site is now live at the `.vercel.app` address Vercel shows you. You can add a custom domain under **Settings → Domains**.

## Program the NFC card

Write the site's URL to the card as a **URL record** (any free NFC writer app, e.g. NFC Tools on iPhone or Android). Test it with a few phones before the event.

## Collecting the notes after the party

Open these links in your browser (replace `YOUR_KEY` with the key from step 4):

- `https://YOUR-SITE.vercel.app/api/notes?key=YOUR_KEY` — every note on a printable page (File → Print → Save as PDF for the keepsake book)
- `...?key=YOUR_KEY&format=csv` — a spreadsheet
- `...?key=YOUR_KEY&format=json` — raw data

Without the key, those links show "Not found", so guests can't read each other's notes.

## Live donor counter

When guests tap **I just registered** in the Pass it on section, the count goes up for everyone (each phone counts once). It uses the same Blob store as the notes, so there's nothing extra to set up.

To show it on a TV or projector during the toasts, open `https://YOUR-SITE.vercel.app/count` in a browser and make it full screen. It refreshes on its own every few seconds.

## Before the event — fill these in

Search `index.html` for `[` to find them:

- `[performer]` — the live music
- The **Sweets** tab — once the Luxe Sucre menu is set, replace “Final selections coming soon” with the desserts


## Editing later

Everything is plain HTML in `index.html`. To swap a photo, add a WebP (about 640 px wide) to `images/` and change the `src`. Commit to GitHub and Vercel redeploys automatically.
