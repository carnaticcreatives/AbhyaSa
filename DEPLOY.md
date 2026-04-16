# AbhyaSa — Deployment Checklist

Run through this list before every push to GitHub / Cloudflare.

## Every deploy

- [ ] **Bump `CACHE_VERSION`** in `sw.js` — change `cmp-vNN` to the next number.
      Without this, returning users will keep running the old service worker.

- [ ] **Edit locally, never in the Cloudflare dashboard.**
      Saving through the Cloudflare UI re-injects `email-decode.min.js` and
      obfuscates email links. Always edit locally and deploy directly.

- [ ] Run a quick smoke-test in Chrome:
      - Login / coupon redemption flow
      - Sampoorna ragam playback at 80 BPM
      - Janya search (type 3+ letters)
      - End Session → score modal appears

## Credential rotation

If you ever rotate the Supabase anon key, the **only file** to update is
`config.js`. Both `app.html` and `practice-scoring.js` read from there.

> The anon key is public and safe to commit. Never commit the
> **service-role** key in any client-side file.

## Supabase version

Vendored client: **supabase-js v2.101.1** (`supabase.min.js`).
Check the file header comment before replacing.

## GitHub Pages / Cloudflare Pages notes

- All files are served as static assets — no build step required.
- The service worker caches assets on first load for offline use.
- RLS policies enforce subscription checks server-side; the client-side
  session guard is an additional UX layer, not a security boundary.
