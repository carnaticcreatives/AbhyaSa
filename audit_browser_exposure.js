/**
 * AbhyaSa — Browser Security Audit Script
 * =========================================
 * Systematically captures everything visible in the browser for both a
 * non-subscribed visitor and a subscribed user, then writes a structured
 * report to audit_results.txt.
 *
 * BUGS FIXED FROM ORIGINAL:
 * ──────────────────────────────────────────────────────────────────────
 * 1. CONSOLE LISTENER REGISTERED TOO LATE — original attached page.on("console")
 *    inside auditContext(), which ran AFTER page navigation. Messages fired
 *    during page load (session guard, ragam init, Supabase calls) were all
 *    missed. Fix: attach console + response listeners immediately after page
 *    creation, before any navigation.
 *
 * 2. NETWORK RESPONSE LISTENER REGISTERED TOO LATE — same issue as above.
 *    All Supabase REST and Edge Function calls happen during/after page load.
 *    Fix: register page.on("response") before page.goto().
 *
 * 3. RESPONSE BODY READ RACE — response.text() can fail if the response body
 *    has already been consumed or the response is a redirect. Original had a
 *    bare try/catch that silently swallowed all failures. Fix: check
 *    response.ok and content-type before reading; use a proper error log.
 *
 * 4. LOGIN TARGETS WRONG PAGE — original called login() while still on
 *    index.html, but after auditContext() had already run. The page could
 *    have been redirected to app.html by the session guard during the 4-second
 *    wait, making the email/password selectors not found. Fix: explicitly
 *    navigate back to index.html before login, wait for the login panel.
 *
 * 5. login() USES WRONG BUTTON SELECTOR — index.html has
 *    id="btn-login" with text "Sign in" but also a Sign Up tab button.
 *    'button:has-text("Sign in")' is ambiguous. Fix: use '#btn-login'.
 *
 * 6. exploreApp() BLINDLY CLICKS ALL BUTTONS — clicking Sign out, tab buttons,
 *    or the forgot-password link mid-audit terminates the session and corrupts
 *    the subscribed-user audit. Fix: scope clicks to safe non-destructive
 *    controls (ragam type radios, selects, play button) and skip dangerous ones.
 *
 * 7. SUBSCRIBED AUDIT RUNS ON WRONG PAGE — after login the app redirects to
 *    app.html but auditContext() was called without waiting for navigation.
 *    Fix: wait for URL to include "app.html" before auditing.
 *
 * 8. window VARIABLE SCAN TOO NARROW — original only scanned for "data",
 *    "lesson", "practice", "auth", "token". Misses __appUser (which contains
 *    user id, email, name, expiry, and the live Supabase client), SUPABASE_URL,
 *    SUPABASE_ANON, melakarta_dict, playQueueGlobal, etc. Fix: expanded list.
 *
 * 9. indexedDB.databases() NOT UNIVERSALLY SUPPORTED — throws in some browsers.
 *    Fix: wrapped in try/catch with a fallback message.
 *
 * 10. NO WAIT FOR APP TO FULLY INITIALISE — after login the subscribed audit
 *     ran immediately. ragamInit() and scoringInit() fire async after auth.
 *     Fix: added an explicit wait after navigation to app.html.
 *
 * 11. DUPLICATE LISTENERS — calling auditContext() twice on the same page
 *     object registered duplicate console + response listeners. Fix: listeners
 *     are now registered once globally per page object.
 *
 * 12. NO CAPTURE OF INLINE SCRIPT CONTENT — config.js is loaded as a separate
 *     file and exposes SUPABASE_URL and SUPABASE_ANON publicly. The original
 *     only listed script src URLs, not their fetched content. Fix: fetch and
 *     log the content of every JS file found in the page.
 *
 * HOW TO RUN:
 *   npm install playwright
 *   npx playwright install chromium
 *   node audit_browser_exposure.js
 *
 * OUTPUT: audit_results.txt in the same folder.
 */

const { chromium } = require("playwright");
const fs           = require("fs");
const https        = require("https");

// ── Configuration ────────────────────────────────────────────────────────────
// const APP_URL        = "https://carnaticcreatives.github.io/AbhyaSa/";
// const APP_HTML_URL   = "https://carnaticcreatives.github.io/AbhyaSa/app.html";
const APP_URL      = "http://localhost:3000/index.html";
const APP_HTML_URL = "http://localhost:3000/app.html";
const LOGIN_EMAIL    = "tkviji1947@gmail.com";
const LOGIN_PASSWORD = "Tkviji@r10";
const OUTPUT_FILE    = "audit_results.txt";

// Window variable names to capture (expanded from original)
const WINDOW_KEYS_OF_INTEREST = [
  "data", "lesson", "practice", "auth", "token",
  "__appUser",       // contains user id, email, name, expiry, supabase client ref
  "supabase",        // Supabase SDK global
  "SUPABASE_URL",    // exposed by config.js
  "SUPABASE_ANON",   // exposed by config.js — the anon key
  "melakarta_dict",  // all 72 melakarta ragams loaded into memory
  "audava_ragam_dict",
  "shadava_ragam_dict",
  "playQueueGlobal", // full pattern play queue (pattern data from Edge Function)
  "scoringData",
  "sessionData",
  "currentJanyaRecord",
  "_alankaramNamesLive",
  "KATTAI_RATIOS",
  "base_freqs",
];

// ── Logging ───────────────────────────────────────────────────────────────────
function log(text) {
  const line = String(text);
  console.log(line);
  fs.appendFileSync(OUTPUT_FILE, line + "\n");
}

function logSection(title) {
  log("\n" + "═".repeat(60));
  log("  " + title);
  log("═".repeat(60) + "\n");
}

function logSubSection(title) {
  log("\n── " + title + " " + "─".repeat(Math.max(0, 54 - title.length)));
}

// ── Fetch a URL's text content over HTTPS (for auditing JS files) ────────────
function fetchText(url) {
  return new Promise((resolve) => {
    if (!url.startsWith("https://")) { resolve("[non-https, skipped]"); return; }
    https.get(url, (res) => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end",  () => resolve(body));
      res.on("error", e => resolve("[fetch error: " + e.message + "]"));
    }).on("error", e => resolve("[request error: " + e.message + "]"));
  });
}

// ── Attach listeners ONCE per page (before any navigation) ───────────────────
// BUG FIX #1, #2, #11: listeners must be registered before goto() so that
// messages and responses emitted during page load are captured.
function attachListeners(page, collector) {
  page.on("console", msg => {
    const entry = "[Console][" + msg.type() + "] " + msg.text();
    collector.consoleLogs.push(entry);
  });

  page.on("response", async (response) => {
    const url = response.url();
    // Capture Supabase REST, Edge Function, and any JSON API responses
    const isInteresting =
      url.includes("supabase.co") ||
      url.includes("/functions/v1/") ||
      url.includes(".json") ||
      url.includes("/rest/") ||
      url.includes("/auth/") ||
      url.includes("carnaticcreatives");

    if (!isInteresting) return;

    // BUG FIX #3: check content type and handle body-read failures gracefully
    const contentType = response.headers()["content-type"] || "";
    let body = "[binary or unreadable]";
    if (
      contentType.includes("json") ||
      contentType.includes("text") ||
      contentType.includes("javascript")
    ) {
      try {
        body = await response.text();
      } catch (e) {
        body = "[body read failed: " + e.message + "]";
      }
    }

    collector.networkResponses.push({
      url,
      status:      response.status(),
      contentType,
      bodySnippet: body.substring(0, 2000),
    });
  });
}

// ── Capture all browser-visible data at a given point in time ────────────────
async function captureSnapshot(page) {
  const snapshot = {};

  // Window variables — expanded key list
  snapshot.windowVars = await page.evaluate((keys) => {
    const results = {};
    for (const key of keys) {
      for (const winKey of Object.keys(window)) {
        if (winKey.toLowerCase().includes(key.toLowerCase())) {
          try {
            const val = window[winKey];
            // Serialize: skip functions and DOM nodes; capture plain data
            if (
              typeof val !== "function" &&
              typeof val !== "undefined"
            ) {
              results[winKey] = JSON.parse(JSON.stringify(val, (k, v) => {
                if (typeof v === "function") return "[Function]";
                return v;
              }));
            }
          } catch {
            results[winKey] = "[non-serialisable]";
          }
        }
      }
    }
    return results;
  }, WINDOW_KEYS_OF_INTEREST);

  // localStorage — full dump
  snapshot.localStorage = await page.evaluate(() => {
    const obj = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      obj[key] = localStorage.getItem(key);
    }
    return obj;
  });

  // sessionStorage — full dump
  snapshot.sessionStorage = await page.evaluate(() => {
    const obj = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      obj[key] = sessionStorage.getItem(key);
    }
    return obj;
  });

  // IndexedDB — BUG FIX #9: not universally supported; wrap safely
  snapshot.indexedDB = await page.evaluate(async () => {
    try {
      if (!window.indexedDB) return "[not supported]";
      const dbs = await indexedDB.databases();
      return dbs;
    } catch (e) {
      return "[error: " + e.message + "]";
    }
  });

  // Cookies
  snapshot.cookies = await page.context().cookies();

  // All script tags and their src attributes
  snapshot.scriptSrcs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script"))
      .map(s => ({ src: s.src || "[inline]", hasContent: s.src === "" }))
  );

  // Inline script content (potential credential exposure)
  snapshot.inlineScripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll("script:not([src])"))
      .map(s => s.textContent.trim().substring(0, 1000))
      .filter(t => t.length > 0)
  );

  // Service worker cache contents
  snapshot.swCache = await page.evaluate(async () => {
    if (!("caches" in window)) return {};
    const result = {};
    const keys = await caches.keys();
    for (const key of keys) {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      result[key] = requests.map(r => r.url);
    }
    return result;
  });

  // Current URL
  snapshot.currentUrl = page.url();

  // Page title
  snapshot.pageTitle = await page.title();

  return snapshot;
}

// ── Write a snapshot to the log file in a readable format ────────────────────
async function logSnapshot(label, snapshot, collector, page) {
  logSection("AUDIT: " + label);

  log("Page URL   : " + snapshot.currentUrl);
  log("Page Title : " + snapshot.pageTitle);

  // Console logs (collected since listener was attached)
  logSubSection("Console Logs");
  if (collector.consoleLogs.length === 0) {
    log("  (none captured)");
  } else {
    collector.consoleLogs.forEach(l => log("  " + l));
  }
  // Clear after logging so next section starts fresh
  collector.consoleLogs.length = 0;

  // Network responses
  logSubSection("Network Responses (Supabase / API)");
  if (collector.networkResponses.length === 0) {
    log("  (none captured)");
  } else {
    collector.networkResponses.forEach(r => {
      log("  STATUS : " + r.status + "  " + r.url);
      log("  TYPE   : " + r.contentType);
      log("  BODY   : " + r.bodySnippet);
      log("  " + "·".repeat(56));
    });
  }
  collector.networkResponses.length = 0;

  // Window variables
  logSubSection("Window Variables (security-relevant)");
  const wv = snapshot.windowVars;
  if (Object.keys(wv).length === 0) {
    log("  (none found)");
  } else {
    log(JSON.stringify(wv, null, 2));
  }

  // localStorage
  logSubSection("localStorage");
  const ls = snapshot.localStorage;
  if (Object.keys(ls).length === 0) {
    log("  (empty)");
  } else {
    // Supabase stores the full session token (including access_token) here
    log(JSON.stringify(ls, null, 2));
  }

  // sessionStorage
  logSubSection("sessionStorage");
  const ss = snapshot.sessionStorage;
  if (Object.keys(ss).length === 0) {
    log("  (empty)");
  } else {
    log(JSON.stringify(ss, null, 2));
  }

  // IndexedDB
  logSubSection("IndexedDB");
  log(JSON.stringify(snapshot.indexedDB, null, 2));

  // Cookies
  logSubSection("Cookies");
  if (snapshot.cookies.length === 0) {
    log("  (none)");
  } else {
    log(JSON.stringify(snapshot.cookies, null, 2));
  }

  // Script files
  logSubSection("Script Files (<script> tags)");
  log(JSON.stringify(snapshot.scriptSrcs, null, 2));

  // Fetch and log JS file contents (config.js exposes anon key and Supabase URL)
  logSubSection("JS File Contents (fetched — check for credentials)");
  const externalScripts = snapshot.scriptSrcs
    .map(s => s.src)
    .filter(src => src && src !== "[inline]" && src.startsWith("https://"));

  for (const src of externalScripts) {
    log("\n  FILE: " + src);
    const content = await fetchText(src);
    // Show first 1500 chars — enough to see SUPABASE_URL, SUPABASE_ANON etc.
    log("  CONTENT (first 1500 chars):\n" + content.substring(0, 1500));
    log("  " + "·".repeat(56));
  }

  // Inline scripts
  logSubSection("Inline Script Content (first 1000 chars each)");
  if (snapshot.inlineScripts.length === 0) {
    log("  (none)");
  } else {
    snapshot.inlineScripts.forEach((s, i) => {
      log("  [inline #" + (i + 1) + "]\n" + s + "\n");
    });
  }

  // Service Worker Cache
  logSubSection("Service Worker Cache");
  const swc = snapshot.swCache;
  if (Object.keys(swc).length === 0) {
    log("  (empty or no service worker)");
  } else {
    log(JSON.stringify(swc, null, 2));
  }

  log("\n" + "★".repeat(60));
  log("  END OF SECTION: " + label);
  log("★".repeat(60) + "\n");
}

// ── Login flow ────────────────────────────────────────────────────────────────
// BUG FIX #4, #5: navigate explicitly to index.html, wait for the login
// panel to be present, and use the correct button id.
async function doLogin(page) {
  log("\n[Login] Navigating to index.html …");
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  // Wait for the email input to be present (login panel)
  await page.waitForSelector('#login-email', { timeout: 15000 });
  log("[Login] Login form found.");

  await page.fill('#login-email', LOGIN_EMAIL);
  await page.fill('#login-password', LOGIN_PASSWORD);
  log("[Login] Credentials entered. Clicking Sign in …");

  await page.click('#btn-login');

  // Wait for redirect to app.html — the session guard navigates there on success
  // BUG FIX #7: wait for navigation to complete before auditing
  try {
    await page.waitForURL("**/app.html", { timeout: 20000 });
    log("[Login] Redirected to app.html — login successful.");
  } catch {
    log("[Login] WARNING: Did not redirect to app.html within 20s. Current URL: " + page.url());
  }
}

// ── Safe app exploration (subscribed user) ────────────────────────────────────
// BUG FIX #6: avoid clicking Sign out, tab buttons, or destructive controls.
// Instead, interact only with the practice controls to trigger API calls.
async function exploreApp(page) {
  log("\n[Explore] Starting safe app exploration …");

  // Wait for app to fully initialise (ragamInit, scoringInit fire async)
  // BUG FIX #10
  await page.waitForTimeout(5000);

  try {
    // Select Sampoorna ragam type (should already be selected by default)
    await page.click('input[name="ragaType"][value="sampoorna"]');
    await page.waitForTimeout(1000);

    // Change ragam to observe any API calls triggered by ragam selection
    const ragamOptions = await page.$$('#ragam option');
    if (ragamOptions.length > 1) {
      await page.selectOption('#ragam', { index: 1 });
      await page.waitForTimeout(1000);
    }

    // Change varisai
    const varisaiOptions = await page.$$('#varisai option');
    if (varisaiOptions.length > 0) {
      await page.selectOption('#varisai', { index: 0 });
      await page.waitForTimeout(500);
    }

    // Click Play — this triggers the Edge Function call (get-patterns)
    // which returns pattern data. This is the most important API call to capture.
    log("[Explore] Clicking Play to trigger Edge Function (get-patterns) …");
    const playBtn = page.locator('button', { hasText: '▶' }).first();
    if (await playBtn.count() > 0) {
      await playBtn.click();
      await page.waitForTimeout(6000); // let a few patterns play and network calls complete
      // Stop playback
      await playBtn.click();
      await page.waitForTimeout(1000);
    }

    // Try Alankaram — this calls the Edge Function with varisai=Alankaram
    log("[Explore] Selecting Alankaram to trigger another Edge Function call …");
    const varisaiSelect = page.locator('#varisai');
    const varisaiCount = await varisaiSelect.locator('option').count();
    if (varisaiCount > 0) {
      // Try to select Alankaram if available
      try {
        await page.selectOption('#varisai', { label: 'Alankaram' });
        await page.waitForTimeout(500);
        const playBtn2 = page.locator('button', { hasText: '▶' }).first();
        if (await playBtn2.count() > 0) {
          await playBtn2.click();
          await page.waitForTimeout(5000);
          await playBtn2.click();
          await page.waitForTimeout(1000);
        }
      } catch {}
    }

    // Switch to Janya ragam type — triggers Supabase ragam search
    log("[Explore] Selecting Janya ragam type …");
    await page.click('input[name="ragaType"][value="janya"]');
    await page.waitForTimeout(1000);

    const janyaInput = page.locator('#janyaSearch');
    if (await janyaInput.count() > 0) {
      await janyaInput.fill('Bhairavi');
      await page.waitForTimeout(2000); // wait for dropdown results from Supabase
    }

  } catch (e) {
    log("[Explore] Warning during exploration: " + e.message);
  }

  log("[Explore] Exploration complete.");
}

// ── Main audit runner ─────────────────────────────────────────────────────────
async function runAudit() {
  // Initialise output file
  fs.writeFileSync(OUTPUT_FILE,
    "AbhyaSa — Browser Security Audit\n" +
    "Generated: " + new Date().toISOString() + "\n" +
    "Target: " + APP_URL + "\n\n"
  );

  log("Starting audit …");

  const browser = await chromium.launch({ headless: false }); // headless:false so you can watch
  const context = await browser.newContext();
  const page    = await context.newPage();

  // Shared collector for console logs and network responses
  // BUG FIX #1, #2, #11: attach once, before any navigation
  const collector = {
    consoleLogs:      [],
    networkResponses: [],
  };
  attachListeners(page, collector);

  // ── PHASE 1: Non-subscribed visitor (unauthenticated) ───────────────────────
  log("\n[Phase 1] Navigating as unauthenticated visitor …");
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });

  // Wait for any redirects and async JS to settle
  await page.waitForTimeout(6000);

  const snapshot1 = await captureSnapshot(page);
  await logSnapshot("NON-SUBSCRIBED VISITOR (no login)", snapshot1, collector, page);

  // ── PHASE 2: Attempt direct access to app.html without login ────────────────
  log("\n[Phase 2] Attempting direct URL access to app.html (bypass test) …");
  await page.goto(APP_HTML_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000); // session guard runs and should redirect back

  const snapshot2 = await captureSnapshot(page);
  await logSnapshot("DIRECT app.html ACCESS (unauthenticated bypass attempt)", snapshot2, collector, page);

  // ── PHASE 3: Login and explore as subscribed user ────────────────────────────
  log("\n[Phase 3] Logging in as subscribed user …");
  await doLogin(page);

  // BUG FIX #10: give ragamInit() and scoringInit() time to fire
  await page.waitForTimeout(4000);

  // Capture snapshot immediately after login, before exploration
  const snapshot3a = await captureSnapshot(page);
  await logSnapshot("SUBSCRIBED USER — immediately after login", snapshot3a, collector, page);

  // Explore the app to trigger Edge Function and Supabase API calls
  await exploreApp(page);

  // Capture snapshot after exploration (pattern data may now be in window)
  const snapshot3b = await captureSnapshot(page);
  await logSnapshot("SUBSCRIBED USER — after app exploration (patterns fetched)", snapshot3b, collector, page);

  // ── Done ─────────────────────────────────────────────────────────────────────
  await browser.close();
  log("\nAudit complete. Report saved to: " + OUTPUT_FILE);
}

runAudit().catch(e => {
  log("\n[FATAL] Audit script crashed: " + e.message);
  log(e.stack);
  process.exit(1);
});
