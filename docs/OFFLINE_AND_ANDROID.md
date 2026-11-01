# Offline work and the Android app

## What works offline
The **Field work** screen (`/dashboard/field`) keeps working without a connection once it has been opened online and signed in on that device. On it an agent can:

- see the customers, sites and appliance library that were downloaded at the last sync;
- add a customer or a site, start an assessment and edit its appliances and requirements;
- see the cached catalogue list prices, marked with when they were downloaded.

Everything else (quotations, sizing, approvals, stock) needs a connection. Offline work only ever **creates or saves drafts**. Completing an assessment, running sizing, creating or issuing a quotation are online-only, so no offline draft can become official by itself.

## How it works
| Part | Where |
|---|---|
| Device store (IndexedDB) holding one state object: cached server data, local drafts, ordered outbox | `src/lib/offline/store.ts`, `idb.ts` |
| Sync: sends the outbox, then refreshes the device copy | `src/lib/offline/useOffline.ts` |
| Server entry points: `sync.push`, `sync.snapshot`, `sync.listConflicts`, `sync.resolveConflict` | `convex/sync.ts` |
| App shell caching | `public/sw.js`, `public/offline.html`, `public/manifest.webmanifest` |

- **Idempotent.** Every queued change has its own id. The server records each id with its outcome (`offlineOperations`), so resending a batch after a dropped connection changes nothing. Ids cannot be replayed by another user.
- **Ordered and dependent.** A site or assessment created offline refers to its customer by a device-generated id; the server resolves it from the earlier operation. If the earlier change is rejected, the dependent ones are rejected too and the person can discard the chain.
- **Coalesced.** Repeated edits to one assessment keep a single unsent save holding the latest inputs and the revision the device first edited from.
- **Conflicts are explicit.** If the server copy has moved on (another revision, or completed), the device's version is stored in `syncConflicts` and **not applied**. The person then chooses "Use my version" (saved as a new revision on top) or "Keep the server's". Nothing is merged silently and nothing is lost.
- **Revalidated.** Every queued change goes through the same server functions and checks as online use: role, ownership, validation and audit.
- **Stale data is labelled.** Cached customers, appliances and list prices show their download time and a warning after 24 hours. Prices and stock are always checked again when a quotation is issued.

## Security notes
- Cached data is readable by anyone who can open the device while a session is stored. It is removed on sign-out (the app warns first if unsent changes would be lost). Use a device screen lock.
- A different person signing in on the same device clears the previous person's local data, and queued changes are only ever sent by the person who made them.
- Cost, margin and floor prices are never part of the offline cache. Only what the person's role may already see online is stored.

## Not built yet
- Creating quotations, sizing or completing assessments offline.
- Offline photos, GPS capture or customer attachments.
- Background sync while the app is closed (sync runs while the page is open).
- Merging two versions of an assessment line by line.

## Android
The Android app is a Capacitor shell that loads the hosted web app (`capacitor.config.ts`, `android/`). A website release therefore updates every phone, and the offline code is the same on both. See `docs/ANDROID_RELEASE.md`.
