/* ── AbhyaSa — Central configuration ────────────────────────────────────────
   Single source of truth for Supabase connection constants.
   Both app.html and practice-scoring.js import from here so rotation
   only ever requires one edit in one place.

   The anon key is intentionally public (it is NOT the service-role secret).
   It is safe to commit to a public repo. The service-role key must never
   appear in any client-side file.
   ─────────────────────────────────────────────────────────────────────────── */

const SUPABASE_URL  = 'https://wcpbbvurfbraqqqlpsro.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjcGJidnVyZmJyYXFxcWxwc3JvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwODI5MTksImV4cCI6MjA5MDY1ODkxOX0.sVYdEtstoZAB94QXIDcHHLE9XPHCq2DPkmF7KEZtQes';
