# ABFM Training

ABFM Training is a free, public training-video app for Al Bonian FM ground staff. It opens in any phone or laptop browser and installs like an app. No login is needed for technicians.

- **Staff app:** `https://<your-username>.github.io/<repo-name>/`
- **Your admin app:** `https://<your-username>.github.io/<repo-name>/admin.html`

---

## 1. Put it online (one time, about 10 minutes)

1. Create a GitHub account if you don't have one, then **New repository**. Name it e.g. `training`, set it to **Public**, and create it.
2. Click **uploading an existing file**. Drag in **everything inside this folder**, including the hidden `.github` folder and `.nojekyll` file. On a Mac press `Cmd + Shift + .` to see hidden files. Then click **Commit changes**.
   - If the `.github` folder won't upload by dragging, use **Add file → Create new file**, type `.github/workflows/find-videos.yml` as the name, and paste in that file's contents.
3. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, then **main** and **/ (root)**. Save.
4. Wait 1–2 minutes. The page shows your link, `https://<your-username>.github.io/training/`.
5. Go to **Settings → Actions → General**. Make sure Actions are allowed, and under *Workflow permissions* choose **Read and write permissions**. Save.

## 2. Share with staff

Send the staff link on WhatsApp. On first open, each person picks their language. To install:
- **Android (Chrome):** tap **Install app** at the top, or ⋮ → *Add to Home screen*.
- **iPhone (Safari):** tap Share → *Add to Home Screen*.

## 3. Your admin app

Open `…/admin.html` and connect it once with a GitHub access token. The admin page shows the exact steps. After that, from your phone or laptop you can:

| Tab | What you can do |
|---|---|
| **Videos** | Add a video by pasting a YouTube link (title and channel fill in automatically). Edit, hide, pin to top, delete. Add your own translations if you want. |
| **Review queue** | New videos the daily finder found. Approve them (check the details, then publish) or reject them. |
| **Channels** | The trusted YouTube channels the finder watches. Add, pause or remove channels. There's also a **Find new videos now** button. |
| **Settings** | Site name, announcement banner, helpdesk number, how long the "New" badge shows, and categories with their sorting keywords. |

Every save goes straight to the repo, and staff see it within about a minute.

## 4. How the daily update works

Every morning at about 05:23 Dubai time, GitHub runs `scripts/find-videos.mjs`. It:
1. Checks each trusted channel for uploads from the last 21 days (you can change this).
2. Skips Shorts, live streams, videos already in the library, videos you rejected, and titles with excluded words.
3. Guesses a category from the title and puts each video in your **Review queue**. **Nothing goes live until you approve it.**
4. Once a week, checks every published video still exists on YouTube. Videos that were removed are hidden from staff automatically and flagged in the admin.

It needs no API key and costs nothing.

## 5. Languages

English is the main language. Buttons and menus are also in Hindi, Urdu, Malayalam, Bengali, Tamil, Nepali, Filipino and Arabic (`assets/i18n.js`).
Video text (title, steps, safety) is in English. For staff using another language, each video has:
- a **See translation** button that opens Google Translate with that video's title, safety note and steps, and
- YouTube subtitles in their language when YouTube has them.

To give a video a checked translation, open it in the admin → **Translations**.

## 6. Logo

The ABFM logo is used in the header and as the home-screen icon (`assets/logo.png` and the `icon-*.png` files). To change it, replace those files and bump `VERSION` in `sw.js`.

## Files

```
index.html            staff app
admin.html            your admin app
assets/               styles, scripts, translations, icons
data/videos.json      the video library (edited by the admin app)
data/settings.json    site settings and categories
data/channels.json    trusted channels for the finder
data/pending.json     review queue (written by the finder)
data/health.json      broken-video report (written by the finder)
scripts/find-videos.mjs           the daily finder
.github/workflows/find-videos.yml its daily schedule
sw.js, manifest.webmanifest       install-as-app and offline support
```

If you edit files in `assets/`, change `VERSION` at the top of `sw.js` (e.g. `v1` → `v2`) so installed phones pick up the update.

## Safety essentials and learning paths

- **Safety essentials:** tick “🦺 Safety essential” when editing a video. These videos appear in a pinned yellow section at the top of the library. Videos from the Health & Safety category come pre-ticked when you approve them.
- **Learning paths:** in the admin, open **Learning paths** to create short courses (title, icon, description, and an ordered list of videos). Staff see them on the home screen with a progress bar. Progress is stored only on each person's phone; nothing is tracked centrally.
- Path titles and descriptions are translated automatically, the same way videos are.

## Automatic drafts for new videos

Every morning, after finding new videos, the daily job writes a first draft for each one in the review queue: summary, safety note, PPE, steps, level and subject. When you press **Review & approve**, the form is already filled in — check it, fix anything, publish.

- **Without any setup:** the summary comes from the YouTube description, the steps from the video's chapters (when the channel adds them), and the safety note and PPE from built-in rules for each trade.
- **Better, with a free Gemini key:** Gemini watches each video and drafts from what it actually shows. Get a key at aistudio.google.com/apikey, then add it on GitHub as a repository secret named `GEMINI_API_KEY` (Settings → Secrets and variables → Actions). Paste it in the admin's Settings too, so the **✨ Auto-draft** button works for videos you add by hand.

## Toolbox talk of the day

30 short safety talks (data/toolbox.json) rotate on the home screen, one per day — the same talk for everyone. Supervisors can read it out, or press 🔊 Listen, at the morning briefing. Edit, add or pin a talk to a date in the admin's **Toolbox talks** tab. Talks are translated automatically.

## Request a video

Technicians tap **🙋 Request a video** (at the bottom of the library, and when a search finds nothing). Requests go to a private Google Sheet and show up in the admin's **Requests** tab, where you can mark them done or add the video straight away. The one-time setup is shown in the Requests tab; the script is in setup/request-inbox.gs. Until it is set up, the button stays hidden.
