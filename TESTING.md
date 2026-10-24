# Verification — 24 October 2026

## Automated checks

**26/26 Node tests passed** using npm test on the updated project.

Coverage includes:
- All seven original IDs retained and immutable.
- Every clip included per shuffle cycle; no consecutive repeats across 200 cycles.
- Queue merging, deduplication, failed-clip exclusion and empty-queue fallback.
- Name/topic relevance, short duration, privacy, embedding and restriction checks.
- Missing key with zero outgoing API requests.
- Successful mocked discovery, duplicate search results, empty searches and saved review decisions.
- Approved, rejected and removed records; protected originals.
- Six-hour cache, ten-minute manual cooldown, concurrent request coalescing, daily search limit.
- Metadata failures midway through a search without replacing the playable collection.
- Unavailable records retained in the collection.
- Owner authentication, cross-origin write protection, static file allowlist and secrets excluded from frontend code.
- Corrupt cache recovery behavior.
- One 15-second countdown despite repeated clicks, followed by a separate dramatic reveal.
- Pause/resume, stop/restart, cancelled pending advances and delayed API callbacks.
- One YouTube player per attempt; no player created after stopping.
- Actual-start video counting, ended-event advancement, all-clips-failed fallback and autoplay-blocked manual play.
- Late callbacks from a destroyed player cannot affect a new player.
- Failed-load metadata from the previous clip does not prevent error skipping.

## Live YouTube Data API check

The owner's key was configured in the server-only local .env after the missing-configuration behavior had been verified.

A real search completed successfully using two official search.list calls plus videos.list validation. It found **14 new candidates**, saved as **pending / identity unverified** in the original project's local .data/collection.json. The seven originals remained approved; none of the new candidates were auto-approved.

This validates actual API connectivity, metadata parsing, deduplication, shortlist creation and durable storage. It does not establish that all 14 candidates feature the intended subject. Some candidates may be commentary or re-uploads; the owner must preview and review them.

The key, .env, .data, generated owner token, and test fixture state are excluded from the distributable ZIP. The ZIP requires your own server environment configuration when run elsewhere.

## Browser checks

Checked the real local app in the in-app browser:
- Desktop gift design and opening flow.
- Pause during the countdown; it stayed at the same number while paused.
- Resume through the reveal into real YouTube playback.
- Several original clips started and advanced; the play counter increased.
- Stop removed the YouTube iframe (verified zero remaining iframes).
- Restart restored a new gift attempt.
- 390 x 844 mobile viewport; no horizontal document overflow.
- Owner sign-in, missing-key instructions, disabled search when unconfigured, protected original cards and lock action.
- Mobile owner layout without horizontal overflow.
- In an isolated, in-memory fixture (not the owner's real collection), two simulated pending candidates were displayed; approving one changed the approved count from 7 to 8, and rejecting the other removed it from pending.
- No application console errors or warnings appeared during the real recipient and owner checks.

Browser access was not repeated after the final credential configuration because the preview browser session reset to an internal error page that its URL policy would not expose. The real configured discovery was verified through the local authenticated HTTP endpoint instead. Final callback/error fixes were covered by the automated suite.

## Secret and packaging checks

- Git check-ignore confirmed .env, .env.production, .data/collection.json and .data/owner-token.txt are ignored.
- The static server denies .env, .data, backend and test source paths.
- The completed ZIP is checked for excluded files and scanned for the actual configured key and generated owner token without printing either.
- The included .env.example contains placeholders only.
- A fresh extraction passed all 26 tests and started successfully without .env, serving all seven original records.
- Authenticated live HTTP checks confirmed 14 pending candidates, seven protected originals, blocked private routes, and no configured key in frontend or API responses.
- The three untouched original files are retained under original-backup/.

## Practical limits

Autoplay, sound, per-region availability and YouTube embedding permissions vary by browser and video. A successful run here cannot guarantee playback everywhere. Metadata search cannot prove identity or reliably classify every result as a YouTube Short. The owner review step is required.

No external deployment was requested or performed. Use npm start locally; hosting requires a Node runtime, persistent storage and server-side environment secrets.

