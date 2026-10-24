# A little Diwali surprise

The existing plain HTML/CSS/JavaScript gift prank, upgraded with an animated Diwali gift, one 15-second countdown, fake verification, a dramatic reveal, fireworks/confetti, and continuous shuffled YouTube playback. The seven supplied reference IDs are protected. A small, dependency-free Node backend adds official YouTube discovery, durable reviews, and quota protection.

## Run locally

Install **Node.js 22.9 or newer** (a supported Node LTS is recommended), open a terminal in this folder, then:

~~~powershell
npm start
~~~

No npm install is necessary: there are no runtime or test dependencies.

Open **http://127.0.0.1:3000**. Use the printed address if you change PORT. Keep the terminal running; Ctrl+C stops the server.

Serve through this backend rather than double-clicking index.html. YouTube embeds require a valid HTTP origin/referrer. External YouTube access is needed to play clips. Google Fonts is optional; system fonts provide a fallback.

## Enable automatic discovery

1. Create/select a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable **YouTube Data API v3** and create an API key.
3. Restrict the key to YouTube Data API v3. For a server with a fixed outbound IP, add an appropriate server IP restriction. A browser referrer restriction is not suitable for this server-side request.
4. Copy the environment template:

~~~powershell
Copy-Item .env.example .env
~~~

5. Edit .env on the **server**:

~~~dotenv
YOUTUBE_API_KEY=your_youtube_data_api_key
OWNER_TOKEN=your_long_random_private_owner_token
HOST=127.0.0.1
PORT=3000
~~~

6. Restart npm start.

Never put the YouTube key in index.html, script.js, owner.js, a browser URL, or a public repository. The static server exposes an explicit allowlist of frontend files; .env, backend code, tests, and .data are not web accessible. No key is included with this project.

With no key, discovery makes **zero YouTube Data API requests**, clearly reports that configuration is required, and preserves all seven originals.

## Gift curator / owner dashboard

Open **http://127.0.0.1:3000/owner.html**, or select Gift curator in the header.

Unlock it with OWNER_TOKEN. If you leave that setting empty, the server generates a token in **.data/owner-token.txt**. Read that file locally (for example, Get-Content .data/owner-token.txt) and paste the token into the owner page. The token is never embedded in frontend code or exposed through an API. Authentication is stored in sessionStorage for this browser tab; Lock collection room removes it.

The dashboard shows all stored records (including retained rejected/removed decisions), the original reference count, discovered candidates, pending review, approved records (including originals), unavailable records, latest new candidates, last attempt, last successful search, API status, and daily search usage. Filters expose original, approved, pending, rejected, removed, and unavailable records. Newly discovered titles, thumbnails, channels, durations, and YouTube preview links appear on candidate cards.

**Watch each candidate before approving it.** Search metadata does not prove that a video features the same person. The app does not perform facial recognition or claim automatic identity verification. Candidates can include commentary or re-uploads despite the filters. All discoveries begin as **unverified / pending**; only an explicit owner approval makes them playable.

Approve, reject, remove, or return a discovered clip to review. Removed/rejected IDs remain as decision records, so rediscovery does not silently re-add them. Original references cannot be removed or demoted. The same manual approval preserves the distinction between a metadata candidate and a reviewed choice.

Approved updates are picked up by the recipient page at startup and approximately once per minute during active playback. They join the next shuffled cycle; the current video continues. Removal takes effect for future selections after the collection sync, and never forcibly replaces the clip currently playing.

## Recipient privacy and the YouTube boundary

The recipient page uses generic gift/surprise wording throughout its app-controlled headings, browser title, loading messages, notifications, iframe accessibility label, metadata and errors. The public playlist API returns only video IDs and availability. It never returns raw video titles, channel names, discovery reasons, thumbnails or internal search phrases. Public source files contain no subject name. Detailed metadata is available only through the authenticated owner API.

**YouTube controls its embedded content.** Its own title/channel overlays, recommendations, audio, captions or the video itself can reveal the subject's name. The supported YouTube player cannot guarantee that this content stays anonymous. The obsolete showinfo setting does not hide titles. This project does not mask, crop out or place overlays over the YouTube player to evade that restriction.

If you require an absolute guarantee that the name never appears or is heard, the original YouTube playback requirement cannot provide it. That would require separately licensed and reviewed media with controlled metadata/content, rather than these unmodified YouTube embeds.

- [YouTube title/overlay behavior](https://developers.google.com/youtube/player_parameters#revision_history)
- [YouTube embedded-player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality)

## How discovery works

- Supported official endpoints only: search.list, then videos.list. No scraping.
- Rotates all six requested search phrases over three runs; alternates relevance/date ordering.
- Looks up the supplied reference videos to find channel context for candidate ranking.
- Each run searches two phrases with up to 25 results each; deduplicates by video ID.
- Evaluates names across titles, descriptions and tags together with relevant topic signals. A title does not need a particular keyword. Child/maths context on a reference channel can also retain an uncertain candidate without any explicit name. A channel match alone never qualifies a result or establishes identity.
- Separately labels possible features, possible commentary/reactions, and uncertain matches. These are metadata assessments, not visual identity claims. All still require owner review.
- Validates title, channel, duration, public/processed status, embedding permission, and restrictions.
- Searches with videoDuration=short and accepts durations of **1–180 seconds**. The API's short filter means under four minutes; it does not certify Shorts. The API does not expose a reliable universal Shorts/vertical flag, so these are short-video candidates pending review.
- Rejects region-restricted and age-restricted discoveries conservatively.
- Refreshes availability metadata for saved discoveries. Missing/deleted/private/non-embeddable records remain visible as unavailable instead of destroying the collection.
- Keeps up to 250 discovered decision records, plus the seven originals. This deliberate bound limits cache size and metadata calls.
- No false discovery count is shown for failed requests. Empty results are recorded as a successful search with zero new candidates.

Some relevant clips will be missed by conservative metadata filtering. Visual subject matching, content-level duplicate detection, and comprehensive discovery are not guaranteed. Review is the intended quality gate.

## Caching, persistence, and quotas

The server starts a discovery check at startup. Recipient collection requests also trigger a background check, so a long-running server can refresh when the cache expires. Saved playback data is served immediately.

- Successful automatic searches are cached for **6 hours**.
- Manual refresh bypasses the successful cache but respects a **10-minute cooldown** after any attempt.
- At most **6 search.list calls per UTC day** per saved server instance (two per run).
- Concurrent refreshes share one in-flight operation.
- The search budget is saved **before** outgoing requests, including failed attempts. Restarting does not reset it.
- Metadata is requested in batches of up to 50 IDs.
- A failed run retains existing videos, review choices, and last successful search time.
- The owner can reload status without performing a discovery search.
- Current YouTube quota rules are controlled by Google; the six-call app limit is independent of the account's quota.

State is saved atomically in **.data/collection.json**. Back up .data privately if you want to retain the collection, owner token, and reviews. Do not commit it or distribute it. A corrupt collection fails safely with a visible warning, retains original playback, and disables discovery until the owner restores/fixes the file. Restore a valid backup before restarting.

The collection lives in .data on the machine running the Node server. Browsers accessing that same server share its approved collection; separate local installations do not share data automatically. Back up that server folder to move the collection.

The browser also retains approved IDs and availability for up to seven days as a network-failure fallback. This browser cache is local to that device; it does not contain video titles, channel names, thumbnails, internal queries or the API key. Older caches are scrubbed automatically. Disconnected clients may temporarily use previously approved records until the server becomes reachable.

## Playback and prank controls

- Unwrap starts exactly one countdown per attempt; repeated clicks cannot create additional timers.
- Pause/resume freezes the countdown, reveal timing, festive effects, and video playback.
- Stop cancels scheduled advances and watchdogs, aborts the active collection request, destroys the iframe player, closes chime audio, and stops animation work. Restart creates a fresh opening attempt.
- One YouTube player is reused during an active attempt. It is created only after the reveal.
- Fisher–Yates shuffle covers the collection each cycle and avoids consecutive repeats across cycle boundaries when more than one playable clip exists.
- Ended clips advance automatically. Failed clips are skipped for the active attempt. If all fail, playback stops trying and displays a fallback; Play video can retry.
- A 20-second startup watchdog offers manual Play/Next rather than cycling endlessly through autoplay-blocked clips.
- Real connecting, buffering, playing, paused, stopped and fallback states appear outside the iframe. The funny gift progress is separate from actual YouTube loading state.
- Visible Play, Pause/Resume, Stop, Restart, Next, Sound and Volume controls stay fixed and accessible.
- Sound defaults off. Chimes and video audio respect your selection and volume; audible autoplay is not guaranteed.
- The video count increments on actual playback starts, once per clip selection, rather than on failed load attempts.
- Five started clips (or two minutes of playback) unlock the final patience joke; cycling can continue until stopped.
- Only bonus buttons shuffle, and never while their area is focused or hovered. Essential controls stay in place.
- Reduced-motion preference disables gift/background motion and canvas effects. Keyboard controls have visible focus states.

The app respects YouTube's controls and restrictions. Some original videos may already be unavailable or disallow embedding. The iframe reports failures at runtime; the app skips them and keeps the original collection records. Error 153 gives a specific HTTP/referrer setup message.

## Files

- index.html / style.css / script.js — recipient gift experience
- playlist.js — shared original IDs and shuffle queue
- owner.html / owner.js — authenticated collection management
- server.mjs — allowlisted static HTTP server and owner API
- discovery.mjs — search, relevance filtering, durable state, review and quotas
- .env.example — server-only configuration template
- tests/ — Node built-in tests for queue, discovery, HTTP protection and gift lifecycle
- original-backup/ — the three untouched original files, retained for reference
- TESTING.md — verification notes and external-service limits

The shareable archive is named diwali_gift_updated.zip and extracts into diwali_gift/. It intentionally excludes .env, .data, generated owner credentials, and machine-specific runtime state. Your existing local .env and saved discoveries remain in your original project folder. Configure environment secrets again when running a fresh extracted copy.

## Test

~~~powershell
npm test
~~~

Tests use Node's built-in runner and stubbed YouTube API/player responses. They exercise successful searches, deduplication, review persistence, empty results, missing configuration, quota/cooldown/concurrency, protected originals, filtering, failures, availability, playlist updates, shuffle cycles, countdown timing, single-player lifecycle, pause/stop/restart, and late callbacks.

See TESTING.md for the exact tests run and browser checks. A real YouTube Data API end-to-end search requires your own key and remaining quota.

## Sharing / deployment

Share the ZIP and let its recipient run npm start locally. For a hosted version, use a Node-capable host with persistent writable storage for .data, set environment secrets there, and serve over HTTPS behind your host's proxy. A static-only host cannot run discovery. The default listener is loopback-only; choose HOST=0.0.0.0 only for a deliberate server deployment. Do not expose the backend development port directly without the host's normal protection. Owner routes require the private token; keep it separate from the gift link.

For multiple server replicas, replace the local JSON store with a shared database and a distributed quota/refresh lock first. The supplied cache and quota protections cover one server process.

## Official references

- [YouTube search.list](https://developers.google.com/youtube/v3/docs/search/list)
- [YouTube videos.list](https://developers.google.com/youtube/v3/docs/videos/list)
- [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)
- [YouTube API setup](https://developers.google.com/youtube/v3/getting-started)
#   g i f t 
 
 #   g i f t  
 