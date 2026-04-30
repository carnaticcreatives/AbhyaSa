/* ── Runtime ragam dicts populated from Supabase ──────────────────────────
   These start as the inline hardcoded dicts (fallback).
   ragamInit() replaces them with Supabase data once the user is logged in. */
let _audava_ragam_dict_live = null;   // null = "not yet loaded from SB"
let _shadava_ragam_dict_live = null;

/** Load ALL ragam types (audava, shadava, janya) from Supabase in ONE query.
 *  Falls back to hardcoded inline dicts if Supabase is unavailable. */
async function loadAllRagamsFromSupabase() {
  const sb = window.__appUser?.supabase;
  if (!sb) {
    console.error('[Ragams] Supabase not available — ragams cannot be loaded');
    return;
  }

  // Fetch all ragams with pagination — Supabase default cap is 1000 rows
  // We page through until all records are retrieved
  let allData = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data: page, error } = await sb
      .from('ragams')
      .select('name, arohanam, avarohanam, type, melakarta')
      .in('type', ['audava', 'shadava'])
      .range(from, from + PAGE - 1);

    if (error) {
      console.error('[Ragams] Supabase load error:', error);
      return;
    }

    if (!page || page.length === 0) break;
    allData = allData.concat(page);
    if (page.length < PAGE) break;   // last page
    from += PAGE;
  }

  const data = allData;

  // ── Build audava dict  { name: { aro, ava } } ──────────────────────────
  const newAudava = {};
  data.filter(r => r.type === 'audava').forEach(r => {
    newAudava[r.name] = { aro: r.arohanam, ava: r.avarohanam };
  });
  _audava_ragam_dict_live = newAudava;

  // ── Build shadava dict  { name: { aro, ava } } ─────────────────────────
  const newShadava = {};
  data.filter(r => r.type === 'shadava').forEach(r => {
    newShadava[r.name] = { aro: r.arohanam, ava: r.avarohanam };
  });
  _shadava_ragam_dict_live = newShadava;


  // ── Build melakarta dict { melaNo: [name, aro, ava] } ─────────────────
  // Fetch separately as it's a small fixed set (72 rows)
  const { data: melaData, error: melaErr } = await sb
    .from('ragams')
    .select('name, arohanam, avarohanam, melakarta')
    .eq('type', 'sampoorna')
    .order('melakarta', { ascending: true });

  if (!melaErr && melaData && melaData.length > 0) {
    melaData.forEach(r => {
      melakarta_dict[r.melakarta] = [r.name, r.arohanam, r.avarohanam];
    });
  } else {
    console.warn('[Ragams] Melakarta load failed:', melaErr?.message);
  }
}

/** Return the live audava dict (Supabase if loaded, else hardcoded) */
function getAudavaDict() {
  return _audava_ragam_dict_live || audava_ragam_dict;
}

/** Return the live shadava dict (Supabase if loaded, else hardcoded) */
function getShadavaDict() {
  return _shadava_ragam_dict_live || shadava_ragam_dict;
}

/***********************
 * UI INIT
 ***********************/
const ragamSelect=document.getElementById("ragam");
const varisaiSelect=document.getElementById("varisai");
const staticInfo=document.getElementById("staticInfo");
const dynamicInfo=document.getElementById("dynamicInfo");
const progressBar=document.getElementById("progress");

function loadSampoornaRagams() {
  ragamSelect.innerHTML = "";
  for (const k in melakarta_dict) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = `${melakarta_dict[k][0]} (${k})`;
    ragamSelect.appendChild(o);
  }
  ragamSelect.value = "15"; // Mayamalavagaula
}

function loadAudavaRagams() {
  ragamSelect.innerHTML = "";
  const dict = getAudavaDict();
  Object.keys(dict).forEach(name => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    ragamSelect.appendChild(o);
  });
}

function loadShadavaRagams() {
  ragamSelect.innerHTML = "";
  const dict = getShadavaDict();
  Object.keys(dict).forEach(name => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    ragamSelect.appendChild(o);
  });
}

/* Keep a single promise for the full Supabase ragam load */
let ragamInitPromise = null;

document.querySelectorAll("input[name=ragaType]").forEach(r => {
  r.onchange = async () => {

    // Hide janya search widget when switching away from Janya
    if (r.value !== "janya") {
      document.getElementById("janyaSearchWrap").style.display = "none";
      ragamSelect.style.display = "";
    }

    // For audava/shadava: wait for bulk Supabase load to finish first
    if ((r.value === "audava" || r.value === "shadava") && ragamInitPromise) {
      await ragamInitPromise;
    }

    if (r.value === "audava" && r.checked) {
      loadAudavaRagams();
      loadVarisais(VARISAI_AUDAVA);
    }

    if (r.value === "sampoorna" && r.checked) {
      loadSampoornaRagams();
      loadVarisais(currentVarisaiList());
    }

    if (r.value === "shadava" && r.checked) {
      loadShadavaRagams();
      loadVarisais(VARISAI_SHADAVA);
    }

    if (r.value === "janya" && r.checked) {
      // Janya data is never bulk-loaded — fetch on demand from server
      selectedJanyaKey = null;
      currentJanyaRecord = null;
      loadJanyaSearchUI();
      loadVarisais([]);
    }

  };
});

// Returns the correct varisai list based on current Variety selection.
// Tisram singing uses VARISAI_ALL (no Alankaram-Tisram — that's a separate path).
// All other varieties use VARISAI_ALL_WITH_TISRAM (includes Alankaram-Tisram option).
function currentVarisaiList() {
  return getVariety() === 'tisram' ? VARISAI_ALL : VARISAI_ALL_WITH_TISRAM;
}

// VARISAI_ALL_WITH_TISRAM — full list including Alankaram-Tisram option.
// Shown when Tisram singing variety is NOT active.
const VARISAI_ALL_WITH_TISRAM = [
  "Sarali Varisai",
  "Janta Varisai",
  "Dhatu Varisai",
  "Hechusthayi Varisai",
  "Mandrasthayi Varisai",
  "Alankaram",
  "Alankaram-Tisram"
];

/* INITIAL LOAD — all ragam data comes from Supabase via ragamInit() */
(async function initApp() {
  // Don't call loadSampoornaRagams() here — melakarta_dict is empty until ragamInit()
  // ragamInit() calls loadSampoornaRagams() after loading from Supabase
  loadVarisais(VARISAI_ALL_WITH_TISRAM);
})();

/** Called from app.html session guard after __appUser is confirmed.
 *  Loads audava, shadava and janya ragams from Supabase.
 *  If the user is currently viewing audava/shadava/janya, refreshes the dropdown. */
async function ragamInit() {
  ragamInitPromise = loadAllRagamsFromSupabase();
  try {
    await ragamInitPromise;

    // Refresh whichever tab is currently active
    const currentType = document.querySelector("input[name=ragaType]:checked")?.value;
    if (currentType === "sampoorna" || !currentType) {
      loadSampoornaRagams();  // melakarta_dict now populated from Supabase
    } else if (currentType === "audava") {
      loadAudavaRagams();
    } else if (currentType === "shadava") {
      loadShadavaRagams();
    } else if (currentType === "janya") {
      loadJanyaSearchUI();  // janya is on-demand — just show the search UI
    }
    // Always rebuild sampoorna in background for tab switching
    loadSampoornaRagams();

  } catch(e) {
    console.error('[RagamInit] Failed to load ragams from Supabase:', e.message);
  }
}


/***********************
 * AUDIO ENGINE STATE *
 ***********************/
let audioCtx = null;
let masterGain = null;
let tanpuraBuffer = null;
let tanpuraSource = null;
let isPlaying = false;
let skipRequested = false;
let playQueueGlobal = [];
let currentQueueIndex = 0;

// Incremented every time a new play session starts.
// playPattern captures this at call time; after its sleep it checks whether
// the session ID has changed (Stop+Play while sleeping) and bails out.
let playSessionId = 0;

// Mutex: prevents a second playSelected() from entering during the async
// getSession() + edge-function fetch window of the first call.
// Without this, Stop+Play faster than ~300 ms can launch two concurrent
// playback loops that both pass the isPlaying guard and schedule notes
// simultaneously — the root cause of overlay at 60/80 BPM.
let _playLock = false;


/***********************
 * PROGRESS STATE
 ***********************/
let totalNotes = 0;
let playedNotes = 0;



/***********************
 * AUDIO CONTEXT
 ***********************/
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  return audioCtx;
}

/***********************
 * TANPURA
 ***********************/
async function loadTanpura() {
  if (tanpuraBuffer) return;

  const ctx = getAudioCtx();
  const res = await fetch("cmpasset01.ogg");   // served via http
  const arr = await res.arrayBuffer();
  tanpuraBuffer = await ctx.decodeAudioData(arr);
}

async function startTanpura(srutiFactor = 1.0) {
  if (tanpuraSource) return;

  await loadTanpura();

  const ctx = getAudioCtx();
  tanpuraSource = ctx.createBufferSource();
  tanpuraSource.buffer = tanpuraBuffer;
  tanpuraSource.loop = true;

  tanpuraSource.playbackRate.value = srutiFactor;

  const g = ctx.createGain();
  g.gain.value = 0.35;  // raised from 0.06 — tanpura audible for sruti alignment

  tanpuraSource.connect(g).connect(masterGain);
  tanpuraSource.start();
}

function stopTanpura() {
  if (tanpuraSource) {
    tanpuraSource.stop();
    tanpuraSource.disconnect();
    tanpuraSource = null;
  }
}


function resolveAudavaPattern(pattern, ragamNotes) {
  const map = {
    a1: ragamNotes[0],
    a2: ragamNotes[1],
    a3: ragamNotes[2],
    a4: ragamNotes[3],
    a5: ragamNotes[4],
    a6: ragamNotes[5]
  };

  return pattern.replace(/\b(a[1-6]|A1)\b/g, m =>
    m === "A1" ? ragamNotes[0].toUpperCase() : map[m]
  );
}

function resolveAudavaPatternForDisplay(pattern, ragamNotes) {
  const map = {
    a1: ragamNotes[0],
    a2: ragamNotes[1],
    a3: ragamNotes[2],
    a4: ragamNotes[3],
    a5: ragamNotes[4],
    a6: ragamNotes[5]
  };

  return pattern.replace(/\b(a[1-6]|A1)\b/g, m =>
    m === "A1" ? ragamNotes[0].toUpperCase() : map[m]
  );
}


/***********************
 * PATTERN PARSER
 * Handles note extensions via comma (,)
 ***********************/
function parsePattern(pattern) {

  const cleaned = pattern.replace(/\|+/g, "").trim();
  const regex = /\(([^)]+)\)|\{([^}]+)\}|([^\s]+)/g;

  const events = [];
  let match;
  let lastEvent = null;

  function parseInnerTokens(text) {
    const tokens = text.trim().split(/\s+/);
    const subEvents = [];
    let lastSub = null;

    for (const tok of tokens) {

      if (tok === ",") {
        if (lastSub) lastSub.beats += 1;
        continue;
      }

      const ev = { note: tok, beats: 1 };
      subEvents.push(ev);
      lastSub = ev;
    }

    return subEvents;
  }

  while ((match = regex.exec(cleaned)) !== null) {

    // ( ... )
    if (match[1]) {
      events.push({
        type: "group1",
        subEvents: parseInnerTokens(match[1])
      });
      continue;
    }

    // { ... }
    if (match[2]) {
      events.push({
        type: "group2",
        subEvents: parseInnerTokens(match[2])
      });
      continue;
    }

    const tok = match[3];

    if (tok === ",") {
      if (lastEvent) lastEvent.beats += 1;
      continue;
    }

    const ev = {
      type: "normal",
      note: tok,
      beats: 1
    };

    events.push(ev);
    lastEvent = ev;
  }

  return events;
}

/***********************
 * NOTE → FREQUENCY
 ***********************/
function resolveFrequency(note, ragamNotes, srutiFactor, isOwnNotes) {
  if (!note || note === ",") return null;

  let octave = 1;

  if (note.startsWith("L_")) {
    octave = 0.5;
    note = note.slice(2);
  }

  if (note === note.toUpperCase()) {
    octave = 2;
  }

  note = note.toLowerCase();

  // ⭐ OWN NOTES: direct swara mapping
  if (isOwnNotes) {
    if (!base_freqs[note]) return null;
    return base_freqs[note] * octave * srutiFactor;
  }

  // ⭐ RAGAM-BASED
  const swara = ragamNotes.find(n => n.startsWith(note));
  if (!swara) return null;

  return base_freqs[swara] * octave * srutiFactor;
}

/***********************
 * NOTE SYNTH
 ***********************/
function playPiano(freq, dur, startTime, ctx) {
  if (!ctx) ctx = getAudioCtx();  // fallback for any direct callers

  const gain = ctx.createGain();
  gain.connect(masterGain);

  /* SMOOTH ENVELOPE */
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(0.7, startTime + 0.12);
  gain.gain.setValueAtTime(0.6, startTime + dur * 0.7);
  gain.gain.linearRampToValueAtTime(0.001, startTime + dur + 0.15);

  /* HARMONIUM-LIKE OSCILLATORS */
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();

  osc1.type = "sawtooth";
  osc2.type = "triangle";

  osc1.frequency.value = freq;
  osc2.frequency.value = freq * 2;

  const g1 = ctx.createGain(); g1.gain.value = 0.65;
  const g2 = ctx.createGain(); g2.gain.value = 0.35;

  osc1.connect(g1).connect(gain);
  osc2.connect(g2).connect(gain);

  osc1.start(startTime);
  osc2.start(startTime);

  const stopTime = startTime + dur + 0.2;
  osc1.stop(stopTime);
  osc2.stop(stopTime);

  // CRITICAL: disconnect gain from masterGain as soon as oscillators finish.
  // Without this, when a skip zeroes masterGain and the next pattern immediately
  // restores it to 0.9, any still-running oscillators from the previous pattern
  // (which haven't hit their .stop() time yet) are suddenly re-amplified through
  // masterGain and become audible again — causing the overlap.
  // onended fires when the last oscillator in this note's graph stops.
  osc2.onended = () => {
    try { gain.disconnect(); } catch (_) {}
  };
}

// Display full pattern
/* Format a raw pattern string for display in adi talam 4|2|2 template.
   Strips existing leading/trailing ||, normalises spacing, then ensures
   the line always renders as: || n n n n | n n | n n ||
   - 4-token lines  (dhatu 3-9):   pad with silence → 4 | , , | , ,
   - 8-token lines with 1 pipe:    re-split as 4 | 2 | 2
   - lines already with 2+ pipes:  leave as-is, just wrap              */
function formatPatternLine(raw) {
  // Strip leading/trailing | or ||
  let s = raw.trim().replace(/^\|+/, "").replace(/\|+$/, "").trim();
  // Normalise spaces around pipes
  s = s.replace(/\s*\|\s*/g, " | ");
  s = s.replace(/  +/g, " ").trim();

  // Tokenise (split on spaces, keeping | as its own token)
  const tokens = s.split(" ");
  const noteTokens = tokens.filter(t => t !== "|");
  const pipeCount  = tokens.filter(t => t === "|").length;

  if (pipeCount >= 2) {
    // Already properly segmented (dhatu 1,2,6,10-12, alankaram, etc.)
    return "|| " + s + " ||";
  }

  if (noteTokens.length === 8 && pipeCount <= 1) {
    // 8-note line: re-split as 4 | 2 | 2 (mandrasthayi / hechusthayi)
    return "|| " + noteTokens.slice(0,4).join(" ") +
           " | " + noteTokens.slice(4,6).join(" ") +
           " | " + noteTokens.slice(6,8).join(" ") + " ||";
  }

  // All other lines (4-note dhatu lines, 6-note, etc.): wrap as-is
  // Each line is one anga of the talam — no filler silences
  return "|| " + s + " ||";
}

function displayFullPattern(label, patternGroup) {

  const ragaType =
    document.querySelector("input[name=ragaType]:checked").value;

  // 🚫 For Janya ragams, suppress dynamic pattern display
  if (ragaType === "janya") {
    dynamicInfo.innerHTML = "";
    return;
  }

  let displayGroup = patternGroup;
  let ragamNotes = null;

  if (
    (ragaType === "audava" || ragaType === "shadava") &&
    (varisaiSelect.value === "Alankaram" || varisaiSelect.value === "Alankaram-Tisram")
  ) {

    if (ragaType === "audava") {
      ragamNotes = getAudavaDict()[ragamSelect.value]
        .aro.split(" ");
    }

    if (ragaType === "shadava") {
      ragamNotes = getShadavaDict()[ragamSelect.value]
        .aro.split(" ")
        .slice(0, 6); // exactly 6 notes
    }

    displayGroup = patternGroup.map(p =>
      resolveAudavaPatternForDisplay(p, ragamNotes)
    );
  }

  const formatted = displayGroup.map(formatPatternLine);

  dynamicInfo.innerHTML =
    `<b>${label}</b><br>` +
    formatted.map((ln, i) =>
      `<span id="pline-${i}" style="display:block; padding:1px 3px; border-radius:3px;">${ln}</span>`
    ).join('');
}

/***********************
 * TRANSPORT CONTROLS
 ***********************/
function skipForward() {
  if (!isPlaying) return;
  skipRequested = "FORWARD";
  // Destroy the AudioContext entirely. silenceAllAudioInstantly() only zeroes
  // masterGain — but the old scheduled oscillators stay alive and reconnect
  // when masterGain is restored for the next pattern, causing overlap.
  // hardStopAllAudio() closes the context, permanently killing all scheduled notes.
  // The playback loop recreates a fresh context for the next pattern via getAudioCtx().
  hardStopAllAudio();
}

function skipBackward() {
  if (!isPlaying) return;
  skipRequested = "BACKWARD";
  hardStopAllAudio();
}

function clearDisplay() {
  staticInfo.innerHTML = "";
  dynamicInfo.innerHTML = "";
  if (progressBar) progressBar.value = 0;
}

function togglePlay() {
  if (isPlaying) {
    isPlaying = false;
    skipRequested = false;
    _playLock = false;          // release lock so next Play can enter immediately
    hardStopAllAudio();         // destroy AudioContext FIRST — kills scheduled oscillators
    stopMetronome();            // then clean up metronome (avoids getAudioCtx() recreating ctx)
    stopTanpura();
    clearDisplay();
    // Notify scoring engine that playback stopped
    if (typeof scoringOnPlayStop === 'function') scoringOnPlayStop();
  } else {
    playSelected();
  }
}

/***********************
 * PATTERN-AWARE SKIP HELPERS
 ***********************/
function findPatternStartIndex(fromIndex) {
  const pid = playQueueGlobal[fromIndex]?.pid;
  for (let i = fromIndex; i >= 0; i--) {
    if (playQueueGlobal[i].pid !== pid) {
      return i + 1;
    }
  }
  return 0;
}

 function findNextPatternIndex(fromIndex) {
  const currentPid = playQueueGlobal[fromIndex]?.pid;
  for (let i = fromIndex + 1; i < playQueueGlobal.length; i++) {
    if (playQueueGlobal[i].pid !== currentPid) {
      return i;
    }
  }
  return playQueueGlobal.length; // end
}

function findPrevPatternIndex(fromIndex) {
  const currentPid = playQueueGlobal[fromIndex]?.pid;

  // Step 1: find previous pid
  let prevPid = null;
  for (let i = fromIndex - 1; i >= 0; i--) {
    if (playQueueGlobal[i].pid !== currentPid) {
      prevPid = playQueueGlobal[i].pid;
      break;
    }
  }

  if (prevPid === null) return 0;

  // Step 2: find FIRST occurrence of that pid
  for (let i = 0; i < playQueueGlobal.length; i++) {
    if (playQueueGlobal[i].pid === prevPid) {
      return i;
    }
  }

  return 0;
}

/***********************
 * PLAY CONTROL
 ***********************/
async function playSelected() {

  // _playLock prevents a second call from sneaking in during the async
  // getSession() + edge-function fetch window before isPlaying is effective.
  if (isPlaying || _playLock) return;
  _playLock = true;

  isPlaying = true;
  skipRequested = false;
  playSessionId++;                    // invalidate any sleeping playPattern from old session
  const mySessionId = playSessionId;  // this call's session token

  // Ensure AudioContext is fully awake before any scheduling begins.
  // audioCtx.resume() returns a Promise — not awaiting it means the context
  // may still be suspended when the first note is scheduled, causing it to
  // drop or bunch up on resume. We call getAudioCtx() to create the context
  // if needed, then await resume() only if it is actually suspended.
  {
    const _ctx = getAudioCtx();
    if (_ctx.state === 'suspended') {
      await _ctx.resume();
    }
  }

  const bpm = +document.querySelector("input[name=speed]:checked").value;

  /* === SRUTI === */
  const srutiKey = document.getElementById("sruti").value;
  const srutiFactor = KATTAI_RATIOS[srutiKey];

  /* === RAGAM === */
  const ragaType =
  document.querySelector("input[name=ragaType]:checked").value;

  // Tambura only mode
  if (ragaType === "tambura") {
    const variety_t = getVariety();
    if (variety_t === 'tala') {
      // Tala practice with tambura drone — start both
      await startTanpura(srutiFactor);
      staticInfo.innerHTML = `<b>Tala + Sruti Practice</b> &nbsp;·&nbsp; ${srutiKey}`;
      dynamicInfo.innerHTML = '';
      isPlaying = true;
      await practiceMode_TalamOnly(srutiFactor);
      stopTanpura();
      stopMetronome();
      isPlaying = false;
      _playLock = false;
    } else {
      // Pure tambura — sruti alignment only
      await startTanpura(srutiFactor);
      staticInfo.innerHTML = `<b>Chosen Sruti: ${srutiKey}</b>`;
      dynamicInfo.innerHTML = 'Sing along to align with your Sruti, then choose the Ragam Type to begin';
      if (progressBar) progressBar.value = 0;
      isPlaying = false;
      _playLock = false;
    }
    return;
  }

let ragamName, aro, ava, ragamNotes;

if (ragaType === "sampoorna") {
  [ragamName, aro, ava] = melakarta_dict[ragamSelect.value];
  ragamNotes = aro.split(" ");
}

if (ragaType === "audava") {
  const r = getAudavaDict()[ragamSelect.value];
  ragamName = ragamSelect.value;
  aro = r.aro;
  ava = r.ava;
  ragamNotes = aro.split(" ");
}

if (ragaType === "shadava") {
  const r = getShadavaDict()[ragamSelect.value];
  ragamName = ragamSelect.value;
  aro = r.aro;
  ava = r.ava;
  ragamNotes = aro.split(" ").slice(0, 6); // 👈 EXACTLY 6 notes
}

if (ragaType === "janya") {
  // currentJanyaRecord is set by fetchJanyaRecord() when user selects a ragam
  // It is fetched on-demand from server — never bulk loaded into the browser
  const r = currentJanyaRecord;
  if (!r) { console.error('[Janya] No record loaded — cannot play'); return; }
  ragamName = r.name;
  aro = r.arohanam;
  ava = r.avarohanam;

  // Combine aro + ava swaras
  const aroNotes = aro.split(" ");
  const avaNotes = ava.split(" ");
  ragamNotes = [...new Set([...aroNotes, ...avaNotes])];
}

let skipVarisai = false;

  // ── SCORING: notify engine which ragam + sruti is being practiced ──
  if (typeof scoringOnPlayStart === 'function') {
    const _rn = ragamName || (ragaType === 'janya' ? currentJanyaRecord?.name : null);
    scoringOnPlayStart(_rn, srutiFactor);
  }

  // ── Variety / practice mode ──────────────────────────────────────────────
  const variety          = getVariety();
  const isTisramSinging  = (variety === 'tisram');
  const isTalaPracticeOnly = (variety === 'tala');

  // isTisram: true when "Alankaram-Tisram" is selected in the Varisai dropdown.
  // Routes to the edge function's Alankaram-Tisram pattern set.
  const isTisram = (varisaiSelect?.value === 'Alankaram-Tisram');

  // ── Gati / talam for guided playback ─────────────────────────────────────
  if (isTisramSinging) {
    currentTalamKey = "triputa";
    currentGati     = 3;    // Tisram: 3 matras per aksharam
    currentJati     = 4;
  } else {
    currentTalamKey = "triputa";
    currentGati     = 4;
    currentJati     = 4;
  }

  // ── Practice mode ───────────────────────────────────────────────────────
  // "guided"     = play swarams + metronome (default, also Tisram singing)
  // "talam"      = talam-only metronome (Tala practice variety selected)
  // Tisram singing is guided mode with gati=3 — not talam-only.
  const practiceMode = isTalaPracticeOnly ? "talam" : "guided";

  if (practiceMode === "talam") {
    await practiceMode_TalamOnly(srutiFactor);
    stopMetronome();
    isPlaying = false;
    _playLock = false;
    return;
  }

  // Declared here so the playPattern call (outside the !skipVarisai block) can access it.
  // Assigned inside the !skipVarisai block; stays false for janya.

/* === JANYA RAGAM: ARO + AVA ONLY === */
if (ragaType === "janya") {

  // Build play queue manually
  await startTanpura(srutiFactor);

  const _gamakamResult = await playJanyaWithGamakam({
    ragamId:    selectedJanyaKey,
    arohanam:   aro,
    avarohanam: ava,
    melakarta:  currentJanyaRecord.melakarta,
    srutiFactor,
    bpm,
    mySessionId,
  });

  if (_gamakamResult !== null) {
    // Aro/ava gamakam ran — if it completed normally, follow up with
    // the ragam's signature (pidi) phrases stored in ragams.swaras.
    if (_gamakamResult === "DONE" && isPlaying && mySessionId === playSessionId) {
      await playSignaturePhrases(selectedJanyaKey, srutiFactor, bpm, mySessionId);
    }
    // Clean up regardless of whether phrases ran or were skipped/stopped
    stopTanpura();
    isPlaying = false;
    _playLock = false;
    return;
  }
  // null = edge function unreachable — fall through to original plain aro/ava below
  playQueueGlobal = [
    { patternGroup: [aro], bpm: bpm, metronomeBpm: bpm, label: "Arohanam",   pid: 1 },
    { patternGroup: [ava], bpm: bpm, metronomeBpm: bpm, label: "Avarohanam", pid: 2 }
  ];

// Derive Melakarta from the fetched record
const melaNo = currentJanyaRecord.melakarta;
const melaName = melakarta_dict[melaNo]?.[0] || "Unknown";

// Display info (Janya-specific)
staticInfo.innerHTML =
  `<b>Ragam:</b> ${ragamName}<br>` +
  `<b>Melakarta Ragam:</b> ${melaName} (${melaNo})<br>` +
  `<b>Arohanam:</b> ${aro}<br>` +
  `<b>Avarohanam:</b> ${ava}`;

  // Progress calculation
  totalNotes = 0;
  playedNotes = 0;

  for (const item of playQueueGlobal) {
    for (const line of item.patternGroup) {
      totalNotes += parsePattern(line)
  .reduce((s, e) => {

    if (e.type === "normal") {
      return s + e.beats;
    }

    // group
    return s + e.subEvents
      .reduce((ss, sub) => ss + sub.beats, 0);

  }, 0);

    }
  }

  if (progressBar) progressBar.value = 0;
  skipVarisai = true;

}

    /* === VARISAI — patterns fetched from Edge Function === */

if (!skipVarisai) {
  staticInfo.innerHTML =
    `<b>Ragam:</b> ${ragamName} | ` +
    `<b>Arohanam:</b> ${aro} | ` +
    `<b>Avarohanam:</b> ${ava}` +
    (isTisramSinging ? ` | <b style="color:#7a3c00">Tisram Singing</b>` : '');
}

// isTisramNonAlankaram declared here (not inside !skipVarisai) so the playback
// loop can read it. Assigned inside !skipVarisai; stays false for janya path.
let isTisramNonAlankaram = false;

if (!skipVarisai) {
  /* === FETCH PLAY QUEUE FROM EDGE FUNCTION === */
  const sb = window.__appUser?.supabase;
  if (!sb) {
    console.error('[Patterns] Supabase not available');
    stopTanpura();
    isPlaying = false;
    _playLock = false;
    return;
  }

  let efResponse;
  try {
    // Get the session token via getSession() — always works whether the
    // session was established via signIn or setSession (used in session guard).
    // refreshSession() is NOT used here: it fails silently when the client was
    // hydrated via setSession(), causing the play button to do nothing.
    const { data: sessData } = await sb.auth.getSession();
    const _sess = sessData?.session;

    // Guard: Stop+Play while getSession was awaiting
    if (mySessionId !== playSessionId) { stopTanpura(); _playLock = false; return; }

    if (!_sess?.access_token) {
      stopTanpura();
      isPlaying = false;
      _playLock = false;
      window.location.href = 'index.html';
      return;
    }

    const efUrl = 'https://wcpbbvurfbraqqqlpsro.supabase.co/functions/v1/get-patterns';
    const ANON_KEY = SUPABASE_ANON;

    // For Alankaram in Tisram nadai → use the Tisram-pattern variant in the edge function.
    // For all other varisais, pass the nadai (gati) value so the edge function
    // can return patterns with the correct number of notes per aksharam.
    const efVarisai = (isTisram && varisaiSelect.value === "Alankaram")
      ? "Alankaram-Tisram"
      : varisaiSelect.value;

    const efRes = await fetch(efUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_sess.access_token}`,
        'apikey':        ANON_KEY
      },
      body: JSON.stringify({
        varisai:  efVarisai,
        ragaType: ragaType,
        arohanam: aro || '',
        nadai:    currentGati          // ← tell the edge function which gati
      })
    });

    if (!efRes.ok) {
      const errText = await efRes.text();
      console.error('[Patterns] Edge Function HTTP error:', efRes.status, errText);
      stopTanpura();
      isPlaying = false;
      _playLock = false;
      return;
    }

    efResponse = await efRes.json();

    // ── Session guard: Stop+Play can happen while the fetch was in flight ──
    // If playSessionId changed since we started, a new session is already
    // running. Bail out silently — don't touch isPlaying (the new session owns it).
    if (mySessionId !== playSessionId) {
      stopTanpura();
      _playLock = false;
      return;
    }

  } catch (err) {
    console.error('[Patterns] Edge Function fetch failed:', err);
    stopTanpura();
    isPlaying = false;
    _playLock = false;
    return;
  }

  // ── 1st Speed Only / Tisram singing filter ────────────────────────────
  const firstSpeedOnly = (variety === 'firstSpeed') ||
                         document.getElementById('firstSpeedOnly')?.checked;

  // isTisramNonAlankaram: Tisram nadai selected for a non-Alankaram varisai
  // via the old gati dropdown path (now unused in guided mode, kept for compat).
  isTisramNonAlankaram = isTisram && varisaiSelect.value !== 'Alankaram' && varisaiSelect.value !== 'Alankaram-Tisram';
  const forceFirstSpeed = (firstSpeedOnly && !isTisramSinging) || isTisramNonAlankaram;

  let rawQueue = efResponse.playQueue;

  if (forceFirstSpeed) {
    // Group by pid, keep the item with the smallest raw bpm value per pid,
    // then force that item's bpm multiplier to 1.
    const byPid = new Map();
    for (const item of rawQueue) {
      const existing = byPid.get(item.pid);
      if (!existing || item.bpm < existing.bpm) {
        byPid.set(item.pid, item);
      }
    }
    rawQueue = Array.from(byPid.values())
      .sort((a, b) => {
        // Restore original ordering by pid
        const idxA = efResponse.playQueue.findIndex(i => i === a);
        const idxB = efResponse.playQueue.findIndex(i => i === b);
        return idxA - idxB;
      })
      .map(item => ({
        ...item,
        bpm:          1,   // will be scaled by base bpm below → plays at 1×
        metronomeBpm: 1
      }));
  }

  // Scale the BPM multipliers from the Edge Function (1/2/4) by the user's chosen base BPM.
  if (isTisramSinging) {
    // Map edge function bpm values to Tisram multipliers.
    // The edge function intentionally omits 1st speed for patterns 10-14 (it sends
    // bpm:2 as the first/slowest speed for those patterns). Deduplication by pid+bpm
    // key drops the duplicate 3rd-speed repeat the edge function sends per pattern.
    //
    //   Edge bpm 1 → Tisram ×1   → label "1st Speed"
    //   Edge bpm 2 → Tisram ×1.5 → label "2nd Speed"
    //   Edge bpm 4 → Tisram ×3   → label "3rd Speed"
    //
    // Patterns 10-14 start at bpm:2, so they correctly play 2nd then 3rd speed only,
    // grouped the same way Normal Sarali is: all 2nd speeds first, then all 3rd speeds.
    const seenPidBpm = new Set();
    playQueueGlobal = [];
    for (const item of rawQueue) {
      const key = `${item.pid}-${item.bpm}`;
      if (seenPidBpm.has(key)) continue;  // drop duplicate 3rd-speed repeat
      seenPidBpm.add(key);
      let tisramM, speedLabel;
      if (item.bpm === 1)      { tisramM = 1;        speedLabel = '1st Speed'; }
      else if (item.bpm === 2) { tisramM = 1.5;      speedLabel = '2nd Speed'; }
      else if (item.bpm === 4) { tisramM = 3;        speedLabel = '3rd Speed'; }
      else                     { tisramM = item.bpm; speedLabel = item.label;  }
      playQueueGlobal.push({
        ...item,
        label:        speedLabel,
        bpm:          tisramM * bpm,
        metronomeBpm: item.metronomeBpm * bpm,
      });
    }
  } else {
    playQueueGlobal = rawQueue.map(item => ({
      ...item,
      // Trust item.label from the edge function for all varisais, including
      // Alankaram-Tisram. The edge function already sends the correct labels:
      //   "1st Speed", "2nd Speed", "Tisram", "Tisram (Repeat)",
      //   "Tisram (Repeat 2)", "3rd Speed", "3rd Speed (Repeat)"
      label:        item.label,
      bpm:          item.bpm * bpm,
      metronomeBpm: item.metronomeBpm * bpm,
    }));
  }

  // If this is an Alankaram session (either variant), store the talam names for display
  if ((varisaiSelect.value === 'Alankaram' || varisaiSelect.value === 'Alankaram-Tisram') && efResponse.alankaramMeta) {
    window._alankaramNamesLive = efResponse.alankaramMeta.names;
  } else {
    window._alankaramNamesLive = null;
  }
}
  currentQueueIndex = 0;

  /* === PROGRESS INIT === */
  totalNotes = 0;
  playedNotes = 0;

  for (const item of playQueueGlobal) {
    for (const line of item.patternGroup) {
      totalNotes += parsePattern(line)
  .reduce((s, e) => {

    if (e.type === "normal") {
      return s + e.beats;
    }

    // group
    return s + e.subEvents
      .reduce((ss, sub) => ss + sub.beats, 0);

  }, 0);

    }
  }

  if (progressBar) progressBar.value = 0;

  buildBeatDots();  // rebuild with correct talam/jati for current mode

  /* === PLAYBACK LOOP === */
  let lastPatternId = null;
  let lastBpm   = null;
  let lastLabel = null;

  // _metronomeStartTime is set the first time playPattern runs so metronome
  // and notes share the exact same audio clock origin.
  let _metronomeStarted = false;
  let _nextLineStart = null;   // Web Audio clock time for next line's t0 — chains patterns seamlessly

  for (; currentQueueIndex < playQueueGlobal.length; currentQueueIndex++) {

  if (!isPlaying) break;

  // 🔁 HANDLE SKIP REQUESTS (single source of truth)
  //
  // IMPORTANT: When a skip is triggered mid-playback, silenceAllAudioInstantly() mutes
  // the output and sets skipRequested. The playPattern sleep loop checks skipRequested
  // and returns "SKIP". The inner line loop then breaks, and the outer
  // for-loop executes its own currentQueueIndex++ BEFORE reaching this check again
  // via continue. So currentQueueIndex here is already 1 ahead of where playback
  // actually stopped. We correct with (currentQueueIndex - 1) as the played index.
if (skipRequested === "FORWARD") {
  skipRequested = false;
  const playedIndex = Math.max(0, currentQueueIndex - 1);
  const nextPidStart = findNextPatternIndex(playedIndex);
  currentQueueIndex = nextPidStart - 1;
  lastPatternId = null;
  lastLabel     = null;
  lastBpm = null;
  _nextLineStart = null;
  _metronomeStarted = false;  // restart metronome in sync with next pattern's first line
  continue;
}

if (skipRequested === "BACKWARD") {
  skipRequested = false;
  const playedIndex = Math.max(0, currentQueueIndex - 1);
  const currentStart = findPatternStartIndex(playedIndex);
  const target = (playedIndex - currentStart <= 1 && currentStart > 0)
    ? findPrevPatternIndex(currentStart)
    : currentStart;
  currentQueueIndex = target - 1;
  lastPatternId = null;
  lastLabel     = null;
  lastBpm = null;
  _nextLineStart = null;
  _metronomeStarted = false;  // restart metronome in sync with next pattern's first line
  continue;
}

  const item = playQueueGlobal[currentQueueIndex];

  if (!isPlaying) break;

    // Determine the talam for this item
    let newTalamKey = "triputa"; // default = Adi (Chatusra jati Triputa)
    let title = `${item.label} (Pattern ${item.pid})`;
    const isAlankaramVariant = (varisaiSelect.value === "Alankaram" || varisaiSelect.value === "Alankaram-Tisram");
    if (isAlankaramVariant) {
      const tala = (window._alankaramNamesLive || {})[item.pid];
      if (tala) {
        title =
          `<span style="font-size:14px;color:#555">${tala}</span><br>` +
          `<b>${item.label} (Pattern ${item.pid})</b>`;
      }
      newTalamKey = ALANKARAM_TALAM_MAP[item.pid] || "triputa";
      // Also update jati — each Alankaram talam has its own prescribed jati
      currentJati = ALANKARAM_JATI_MAP[item.pid] || 4;
    }

    const pidChanged   = (item.pid   !== lastPatternId);
    const labelChanged = (item.label !== lastLabel);

    // On pattern change: reset both _nextLineStart and _metronomeStarted so the
    // new pattern always starts from a fresh audio clock anchor (currentTime+0.05).
    // NOT resetting _nextLineStart was the root cause of overlap — a stale future
    // Web Audio timestamp from the previous pattern would cause the new pattern's
    // notes to schedule far ahead, fire instantly, and play simultaneously with
    // the previous pattern's tail. The first-line sync block handles the cold-start
    // (lineStartTime === null) path correctly for all cases.
    if (pidChanged) {
      _nextLineStart = null;
      _metronomeStarted = false;
      currentTalamKey = newTalamKey;
      // Update jati for Alankaram variants — each pid has its own prescribed jati
      if (isAlankaramVariant) {
        currentJati = ALANKARAM_JATI_MAP[item.pid] || 4;
      }
      if (isMetronomeEnabled()) buildBeatDots();
      displayFullPattern(title, item.patternGroup);
    } else if (labelChanged) {
      // Same pattern, different speed/label (e.g. 1st → 2nd → 3rd speed of Sarali).
      // Update the title in the display without resetting timing or metronome.
      displayFullPattern(title, item.patternGroup);
    }

    lastPatternId = item.pid;
    lastLabel     = item.label;
    lastBpm       = item.bpm;

    if (isMetronomeEnabled()) {
      const display = document.getElementById('metronomeBeatDisplay');
      if (display) display.style.display = 'inline-flex';
    }

    for (let _li = 0; _li < item.patternGroup.length; _li++) {
      const line = item.patternGroup[_li];

      // Highlight current line yellow, clear others
      item.patternGroup.forEach((_, idx) => {
        const span = document.getElementById('pline-' + idx);
        if (span) span.style.background = (idx === _li) ? '#ffe066' : '';
      });

        let lineToPlay = line;

        // ⭐ AUDAVA SARALI RESOLUTION
        if (
          ragaType === "audava" &&
          (varisaiSelect.value === "Sarali Varisai" ||
          varisaiSelect.value === "Alankaram" ||
          varisaiSelect.value === "Alankaram-Tisram")
        ) {
          lineToPlay = resolveAudavaPattern(line, ragamNotes);
        }
        
        if (
          ragaType === "shadava" &&
          (varisaiSelect.value === "Alankaram" || varisaiSelect.value === "Alankaram-Tisram")
        ) {
          lineToPlay = resolveAudavaPattern(line, ragamNotes);
        }

        // Compute t0 for first line — start metronome in sync with first note.
        // After that, chain each line from where the previous ended (result.nextT).
        let lineStartTime = _nextLineStart;
        if (!_metronomeStarted && _li === 0) {
          const ctx = getAudioCtx();
          lineStartTime = ctx.currentTime + 0.05;
          if (isMetronomeEnabled() && !skipVarisai) {
            startMetronome(ctx, bpm, currentGati, lineStartTime, false, isTisramSinging);
          }
          _metronomeStarted = true;
        }

        // ── SAFETY GUARD: discard stale lineStartTime from a replaced context ──
        // If lineStartTime is more than 2 seconds ahead of the current audio clock,
        // the timestamp is from a previous AudioContext (Stop+Play race or browser
        // suspension). Discard it and force a cold-start anchor instead.
        // This is a last-resort catch — the session ID check in playPattern is the
        // primary fix, but this prevents any stale timestamp from being used at all.
        if (lineStartTime !== null) {
          const _guardCtx = getAudioCtx();
          if (lineStartTime > _guardCtx.currentTime + 2.0) {
            console.warn(
              `[OVERLAP-GUARD] Stale lineStartTime detected (${lineStartTime.toFixed(3)}s vs ctx ${_guardCtx.currentTime.toFixed(3)}s) — discarding`
            );
            lineStartTime = _guardCtx.currentTime + 0.05;
            _metronomeStarted = false;
          }
        }

        const result = await playPattern(
            lineToPlay,
            item.bpm,
            ragamNotes,
            srutiFactor,
            false,
            lineStartTime,
            mySessionId
        );

      if (result === "STOP") {
        stopMetronome();
        stopTanpura();
        isPlaying = false;
        _playLock = false;
        return;
      }

      if (result === "SKIP") {
        _nextLineStart = null;
        _metronomeStarted = false;  // so next pattern restarts metronome in sync
        break;
      }

      // Chain: next line starts exactly where this one ended on the Web Audio clock
      _nextLineStart = result.nextT;

    }
  }

  // Tell the metronome scheduler not to fire any clicks after the last note ends.
  // This prevents pre-scheduled sub-clicks from firing naked after music stops.
  if (_nextLineStart !== null) _metronomeEndTime = _nextLineStart;
  stopMetronome();
  stopTanpura();
  isPlaying = false;
  _playLock = false;
}

/* ══════════════════════════════════════════════════════════════════════════
   METRONOME ENGINE — Sooladi Sapta Talam × Jati × Gati
   ──────────────────────────────────────────────────────────────────────────
   Architecture:
   • Talams are built dynamically from anga definitions + chosen jati,
     exactly matching the standalone metronome widget.
   • Runs a Web Audio lookahead scheduler (independent of note playback).
   • One click per aksharam "tha" beat; gati sub-syllables fire as soft clicks.
   • Beat-dot display lights on every aksharam "tha", ignores sub-syllables.
   ══════════════════════════════════════════════════════════════════════════ */

// ── Talam family definitions (anga sequences) ─────────────────────────────
// Each anga: "L" = laghu (length = jati), "D" = drutam (always 2), "A" = anudruta (always 1)
const TALAM_ANGAS = {
  druva:   { angas: ["L","D","L","L"], label: "Druva"  },
  matya:   { angas: ["L","D","L"],     label: "Matya"  },
  rupaka:  { angas: ["D","L"],         label: "Rupaka" },
  jhampa:  { angas: ["L","A","D"],     label: "Jhampa" },
  triputa: { angas: ["L","D","D"],     label: "Triputa"},
  ata:     { angas: ["L","L","D","D"], label: "Ata"    },
  eka:     { angas: ["L"],             label: "Eka"    },
};

// Alankaram pattern pid → jati (finger count for Laghu)
const ALANKARAM_JATI_MAP = {
  1: 4,  // Druva    — Chatusra jati
  2: 4,  // Matya    — Chatusra jati
  3: 4,  // Rupaka   — Chatusra jati
  4: 7,  // Jhampa   — Mishra jati
  5: 3,  // Triputa  — Tisra jati
  6: 5,  // Ata      — Khanda jati
  7: 4,  // Eka      — Chatusra jati
};

// Alankaram pattern pid → talam family key
const ALANKARAM_TALAM_MAP = {
  1: "druva", 2: "matya", 3: "rupaka",
  4: "jhampa", 5: "triputa", 6: "ata", 7: "eka"
};

// ── Build aksharams array for a given talam + jati ────────────────────────
// Returns [{accent, angaLabel}, …] — one entry per aksharam beat.
// accent values: "sam" | "laghu" | "drutam-wave" | "drutam-finger" | "anudruta"
function buildTalamAksharams(talamKey, jati) {
  const def = TALAM_ANGAS[talamKey];
  if (!def) return buildTalamAksharams("triputa", 4); // fallback = Adi
  const result = [];
  for (const a of def.angas) {
    if (a === "L") {
      for (let i = 0; i < jati; i++) {
        result.push({ accent: "laghu", angaLabel: "L" });
      }
    } else if (a === "D") {
      result.push({ accent: "drutam-wave",   angaLabel: "D" });
      result.push({ accent: "drutam-finger", angaLabel: "D" });
    } else if (a === "A") {
      result.push({ accent: "anudruta", angaLabel: "A" });
    }
  }
  if (result.length > 0) result[0].accent = "sam";
  return result;
}

// ── Groups array for dot display (anga boundaries) ────────────────────────
function buildTalamGroups(talamKey, jati) {
  const def = TALAM_ANGAS[talamKey];
  if (!def) return buildTalamGroups("triputa", 4);
  const groups = [];
  let cursor = 0;
  for (const a of def.angas) {
    const size = a === "L" ? jati : a === "D" ? 2 : 1;
    const group = [];
    for (let i = 0; i < size; i++) group.push(cursor++);
    groups.push(group);
  }
  return groups;
}

// ── Active metronome state ────────────────────────────────────────────────
let currentTalamKey = "triputa"; // default = Adi (Chatusra jati Triputa)
let currentJati     = 4;         // Chatusra jati
let currentGati     = 4;         // Chatusra nadai (default)

let _metronomeTimer  = null;
let _metronomeActive = false;
let _metronomeEndTime = Infinity;
let _pendingOscillators = [];   // sub-click oscs scheduled ahead — stopped on metronome stop

function _gatiSubClick(ctx, t) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(masterGain || ctx.destination);
  osc.frequency.value = 600;
  gain.gain.setValueAtTime(0.30, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  osc.start(t);
  osc.stop(t + 0.05);
  _pendingOscillators.push(osc);
}

function _metronomeClick(ctx, t, accent) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(masterGain || ctx.destination);

  if (accent === "sam") {
    osc.frequency.value = 1400;
    gain.gain.setValueAtTime(0.70, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
  } else if (accent === "laghu") {
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0.38, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  } else if (accent === "drutam-wave") {
    osc.frequency.value = 750;
    gain.gain.setValueAtTime(0.30, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  } else if (accent === "drutam-finger") {
    osc.frequency.value = 550;
    gain.gain.setValueAtTime(0.20, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  } else { // anudruta
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.24, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  }

  osc.start(t); osc.stop(t + 0.09);
  _pendingOscillators.push(osc);
}

// ── Metronome timing ──────────────────────────────────────────────────────
// BPM = aksharams per minute at Chatusram reference.
// matraDur = aksharamDur / 4 — the constant matra pulse.
// aksharamDur scales with gati so Kandam/Misram aksharams are longer.
//
//   matraDur    = (21.6 / baseBpm) / 4   ← constant matra pulse
//   aksharamDur = matraDur * gati
//
// At 80 BPM, matraDur = 0.0675 s:
//   Tisram    (3): aksharamDur = 0.2025 s  — wait, that's too fast.
//
// Correct: BPM = aksharams/min. aksharamDur = 21.6/baseBpm for Chatusram.
// matraDur = aksharamDur / gati. For other gatis, aksharamDur stays the
// same (same foot-tap rate) but matraDur shrinks for higher gatis.
// Sub-clicks fire silently at each matra to drive the timing loop.
//
// TALA PRACTICE: user wants same BPM label = same matra speed across gatis.
// So matraDur is constant = 21.6/baseBpm, aksharamDur = matraDur * gati.
// Main click fires every gati matras. This is the correct Carnatic model:
// same matra pulse, grouping changes.

const GATI_MATRAS = { 3: 3, 4: 4, 5: 5, 7: 7 };

function startMetronome(ctx, baseBpm, gati, startTime, forceTalam = false, tisramSinging = false) {
  stopMetronome();
  if (!isMetronomeEnabled(forceTalam)) return;

  _metronomeActive = true;
  _metronomeEndTime = Infinity;

  const aksharams   = buildTalamAksharams(currentTalamKey, currentJati);
  const totalAk     = aksharams.length;
  const matraDur    = 21.6 / baseBpm;
  const aksharamDur = matraDur * gati;   // gati=3 for Tisram → correct aksharam length

  const LOOKAHEAD = 0.15;
  const TICK_MS   = 50;

  let nextTime = startTime;
  let akCursor = 0;

  function schedule() {
    if (!_metronomeActive) { stopMetronome(); return; }

    const now = ctx.currentTime;
    while (nextTime < now + LOOKAHEAD) {
      const ak     = akCursor % totalAk;
      const accent = aksharams[ak].accent;
      const t      = nextTime;

      // Only schedule clicks up to the end time — prevents pre-scheduled
      // sub-clicks from firing naked after the last note ends.
      if (t >= _metronomeEndTime) break;

      // Main aksharam click — audible, pitched by anga type
      _metronomeClick(ctx, t, accent);

      // Tisram singing: fire 2 audible sub-clicks at 1/3 and 2/3 of each
      // aksharam so the student hears the ta · ki · ta grouping clearly.
      if (tisramSinging) {
        if (t + matraDur     < _metronomeEndTime) _gatiSubClick(ctx, t + matraDur);
        if (t + matraDur * 2 < _metronomeEndTime) _gatiSubClick(ctx, t + matraDur * 2);
      }

      const delay = Math.max(0, (t - now) * 1000);
      const capturedAk = ak;
      _displayTimers.push(setTimeout(() => updateBeatDisplay(capturedAk), delay));

      nextTime += aksharamDur;
      akCursor++;
    }
  }

  _metronomeTimer = setInterval(schedule, TICK_MS);
  schedule();
}

function stopMetronome() {
  _metronomeActive = false;
  _clearDisplayTimers();
  if (_metronomeTimer !== null) {
    clearInterval(_metronomeTimer);
    _metronomeTimer = null;
  }
  // Hard-stop any pre-scheduled sub-click oscillators.
  // IMPORTANT: do NOT call getAudioCtx() here — if hardStopAllAudio() already
  // nulled audioCtx, calling getAudioCtx() would silently recreate it, leaving
  // a zombie AudioContext open that the next Play session has to fight with.
  if (audioCtx) {
    const now = audioCtx.currentTime;
    for (const osc of _pendingOscillators) {
      try { osc.stop(now); } catch(e) {}
    }
  }
  _pendingOscillators = [];
  _metronomeEndTime = Infinity;
}

// Called from HTML when user clicks a talam button
function setCurrentTalam(key) {
  currentTalamKey = key;
  buildBeatDots();
}

// ── Dot display ───────────────────────────────────────────────────────────
let _litDotIdx = -1;          // tracks which dot is currently lit
let _displayTimers = [];      // pending setTimeout handles for dot updates

function _clearDisplayTimers() {
  _displayTimers.forEach(t => clearTimeout(t));
  _displayTimers = [];
}

function buildBeatDots() {
  const display = document.getElementById('metronomeBeatDisplay');
  if (!display) return;

  _litDotIdx = -1;
  _clearDisplayTimers();   // cancel any stale callbacks before rebuilding DOM

  const aksharams = buildTalamAksharams(currentTalamKey, currentJati);
  const groups    = buildTalamGroups(currentTalamKey, currentJati);

  display.innerHTML = "";

  let akIdx = 0;
  groups.forEach((group, gi) => {
    group.forEach(() => {
      const dot = document.createElement('span');
      const accent = aksharams[akIdx].accent;
      dot.className = 'beat-dot' + (accent === 'sam' ? ' sam' : '');
      dot.id = 'mbd' + akIdx;
      dot.dataset.accent = accent;
      dot.title = accent;
      display.appendChild(dot);
      akIdx++;
    });
    if (gi < groups.length - 1) {
      const gap = document.createElement('span');
      gap.className = 'anga-gap';
      display.appendChild(gap);
    }
  });
}

function updateBeatDisplay(akIdx) {
  const display = document.getElementById('metronomeBeatDisplay');
  if (!display) return;

  // Count dots from DOM — avoids stale total if talam changed
  const allDots = display.querySelectorAll('.beat-dot');
  const total   = allDots.length;
  if (total === 0) return;

  const idx = akIdx % total;

  // Clear only the previously lit dot
  if (_litDotIdx >= 0 && _litDotIdx < total) {
    const prev = document.getElementById('mbd' + _litDotIdx);
    if (prev) {
      const a = prev.dataset.accent || 'laghu';
      prev.className = 'beat-dot' + (a === 'sam' ? ' sam' : '');
    }
  }

  // Light the current dot using data-accent baked in at buildBeatDots time
  const dot = document.getElementById('mbd' + idx);
  if (dot) {
    const accent = dot.dataset.accent || 'laghu';
    const litClass =
      accent === 'sam'           ? 'lit-sam'      :
      accent === 'laghu'         ? 'lit-laghu'    :
      accent === 'drutam-wave'   ? 'lit-wave'     :
      accent === 'drutam-finger' ? 'lit-finger'   :
      accent === 'anudruta'      ? 'lit-anudruta' : 'lit-laghu';
    dot.className = 'beat-dot' + (accent === 'sam' ? ' sam' : '') + ' ' + litClass;
    _litDotIdx = idx;
  }
}

function resetBeatDisplay() {
  _litDotIdx = -1;
  const aksharams = buildTalamAksharams(currentTalamKey, currentJati);
  for (let i = 0; i < aksharams.length; i++) {
    const d = document.getElementById('mbd' + i);
    if (d) {
      const accent = d.dataset.accent || aksharams[i].accent;
      d.className = 'beat-dot' + (accent === 'sam' ? ' sam' : '');
    }
  }
}

function isMetronomeEnabled(forceTalam = false) {
  // In talam-only or self-practice mode the metronome IS the point —
  // bypass the checkbox and ragaType restrictions entirely.
  if (forceTalam) return true;
  if (!document.getElementById('metronomeOn')?.checked) return false;
  const ragaType = document.querySelector('input[name=ragaType]:checked')?.value;
  if (ragaType === 'janya') return false;
  return true;
}

function isAlankaramSelected() {
  return document.getElementById('varisai')?.value === 'Alankaram';
}

// selectTalam / selectJati / selectGati — called by dropdowns in app.html
function selectTalam(key) {
  currentTalamKey = key;
  buildBeatDots();
}

function selectJati(val) {
  currentJati = val;
  buildBeatDots();
}

function selectGati(val) {
  currentGati = val;
  // No dot rebuild needed — gati doesn't change dot layout, only timing
}

// Initialise on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  currentTalamKey = "triputa";
  currentJati     = 4;
  currentGati     = 4;
  buildBeatDots();
});

/* ══════════════════════════════════════════════════════════════════════════
   PRACTICE MODE — Tala Only
   ──────────────────────────────────────────────────────────────────────────
   Activated by the "Tala practice only" checkbox.
   Reads talam/jati/gati from the dedicated tala practice selectors.
   ══════════════════════════════════════════════════════════════════════════ */

// ── Tala practice UI handlers ─────────────────────────────────────────────
// ── Variety dropdown handler ───────────────────────────────────────────────
// Mutually exclusive options: normal / firstSpeed / tala / tisram
function onVarietyChange(val) {
  const talaCtrl = document.getElementById('talaPracticeControls');
  if (talaCtrl) talaCtrl.style.display = (val === 'tala') ? 'block' : 'none';
  // Rebuild varisai list for all ragam types except audava/shadava (which have fixed lists).
  // Alankaram-Tisram only appears when variety is NOT tisram singing.
  const ragaType = document.querySelector('input[name=ragaType]:checked')?.value;
  if (ragaType !== 'audava' && ragaType !== 'shadava') {
    loadVarisais(val === 'tisram' ? VARISAI_ALL : VARISAI_ALL_WITH_TISRAM);
  }
  buildBeatDots();
}

// Convenience helpers so old code referencing these still works
function getVariety() {
  return document.getElementById('varietySel')?.value || 'normal';
}

function onTalaPracticeToggle(checked) {
  // Legacy — called if anything still references it
  const v = document.getElementById('varietySel');
  if (v) v.value = checked ? 'tala' : 'normal';
  onVarietyChange(v?.value || 'normal');
}

function onTisramSingingToggle(checked) {
  const v = document.getElementById('varietySel');
  if (v) v.value = checked ? 'tisram' : 'normal';
  onVarietyChange(v?.value || 'normal');
}

function onTpTalamChange(val) {
  currentTalamKey = val;
  buildBeatDots();
}

function onTpJatiChange(val) {
  currentJati = val;
  buildBeatDots();
}

function onTpGatiChange(val) {
  currentGati = val;
}

async function practiceMode_TalamOnly(srutiFactor) {
  // Read from tala practice selectors (not the hidden main talam dropdowns)
  const tpTalamSel = document.getElementById('tpTalamSel');
  const tpJatiSel  = document.getElementById('tpJatiSel');
  const tpGatiSel  = document.getElementById('tpGatiSel');
  if (tpTalamSel) currentTalamKey = tpTalamSel.value;
  if (tpJatiSel)  currentJati     = +tpJatiSel.value || 4;
  if (tpGatiSel)  currentGati     = +tpGatiSel.value || 4;

  const bpmVal   = +document.querySelector("input[name=speed]:checked").value;
  const talamDef = TALAM_ANGAS[currentTalamKey];
  const jatiNames = { 3:"Tisra", 4:"Chatusra", 5:"Khanda", 7:"Misra", 9:"Sankeerna" };
  const gatiNames = { 3:"Tisram", 4:"Chatusram", 5:"Kandam", 7:"Misram" };
  const talamLabel = `${jatiNames[currentJati] || currentJati} Jati ${talamDef?.label || currentTalamKey}`;
  const numAksharams = buildTalamAksharams(currentTalamKey, currentJati).length;

  buildBeatDots();

  const ctx = getAudioCtx();
  startMetronome(ctx, bpmVal, currentGati, ctx.currentTime + 0.1, true);

  staticInfo.innerHTML =
    `<b>Tala Practice</b> &nbsp;·&nbsp; ${talamLabel} &nbsp;·&nbsp; ${gatiNames[currentGati] || currentGati} gati` +
    `<br><span style="font-size:12px;color:#777">${numAksharams} aksharams &nbsp;·&nbsp; ${bpmVal} BPM &nbsp;·&nbsp; Press Stop when done</span>`;
  dynamicInfo.innerHTML = '';

  while (isPlaying) {
    await new Promise(r => setTimeout(r, 200));
  }
}

async function playPattern(pattern, bpm, ragamNotes, srutiFactor, isOwnNotes, startTime = null, sessionId = 0) {

  const ctx = getAudioCtx();
  // Capture ctx ONCE here. Every playPiano call below uses this same reference
  // so that if a skip recreates the AudioContext, this pattern's note scheduling
  // stays consistent with the timing clock used for the sleep at the end.

  // Ensure masterGain is at full volume — silenceAllAudioInstantly() may have
  // zeroed it for a skip, and the scheduled restore at +45 ms might not have
  // fired yet when this call begins (especially at slow BPM where cold-start
  // happens quickly). Explicitly restoring here is the definitive fix.
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(0.9, ctx.currentTime);
  }

  const baseBeatDur = (21.6 / bpm) * currentGati;

  if (!isPlaying) return "STOP";

  const seq = parsePattern(pattern);

  // Use caller-provided startTime so metronome and notes share the same audio clock origin.
  const t0 = startTime !== null ? startTime : ctx.currentTime + 0.05;
  let t = t0;

  // ── Schedule ALL notes into Web Audio upfront ─────────────────────────
  // No per-note await — advance t, queue sounds, check stop/skip flags,
  // then sleep ONCE at the end for the total duration.
  // This eliminates per-note jitter accumulation that causes sync drift at
  // higher speeds (3rd speed has 4 notes per metronome tick — 4× the jitter).

  for (const ev of seq) {

    if (!isPlaying) return "STOP";
    if (skipRequested) return "SKIP";

    // =========================
    // NORMAL NOTE
    // =========================
    if (ev.type === "normal") {

      const dur = baseBeatDur * ev.beats;

      if (!isOwnNotes) {

        const freq = resolveFrequency(ev.note, ragamNotes, srutiFactor, false);
        if (freq) {
          if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
          playPiano(freq, dur, t, ctx);
        }

      } else {

        const noteToken = ev.note;
        const isKampita = noteToken.endsWith("^");
        const glideMatch = noteToken.includes("~");
        let cleanNote = noteToken.replace("^", "");
        let freq = null;
        let glideToFreq = null;

        if (glideMatch) {
          const parts = cleanNote.split("~");
          freq = resolveFrequency(parts[0], ragamNotes, srutiFactor, true);
          glideToFreq = resolveFrequency(parts[1], ragamNotes, srutiFactor, true);
        } else {
          freq = resolveFrequency(cleanNote, ragamNotes, srutiFactor, true);
        }

        if (freq) {
          if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
          playPiano(freq, dur, t, ctx);
        }
      }

      t += dur;
      playedNotes += ev.beats;
    }

    // =========================
    // GROUP NOTES
    // =========================
    else {

      // 🔴 OLD VARISAI BEHAVIOR
      if (!isOwnNotes) {

        let effectiveBpm = bpm;
        if (ev.type === "group1") effectiveBpm = bpm + 20;
        if (ev.type === "group2") effectiveBpm = bpm * 2;
        const beatDur = (21.6 / effectiveBpm) * currentGati;

        for (const sub of ev.subEvents) {
          const dur = beatDur * sub.beats;
          const freq = resolveFrequency(sub.note, ragamNotes, srutiFactor, isOwnNotes);
          if (freq) {
            if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
            playPiano(freq, dur, t, ctx);
          }
          t += dur;
          playedNotes += sub.beats;
        }

      }
      // 🟢 OWN NOTES GAMAKA MODE
      else {

        const totalBeats = ev.subEvents.reduce((s, sub) => s + sub.beats, 0);
        const subUnit = baseBeatDur / totalBeats;

        for (const sub of ev.subEvents) {
          const dur = subUnit * sub.beats;
          const noteToken = sub.note;
          const isKampita = noteToken.endsWith("^");
          const glideMatch = noteToken.includes("~");
          let cleanNote = noteToken.replace("^", "");
          let freq = null;
          let glideToFreq = null;

          if (glideMatch) {
            const parts = cleanNote.split("~");
            freq = resolveFrequency(parts[0], ragamNotes, srutiFactor, true);
            glideToFreq = resolveFrequency(parts[1], ragamNotes, srutiFactor, true);
          } else {
            freq = resolveFrequency(cleanNote, ragamNotes, srutiFactor, true);
          }

          if (freq) {
            if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
            playPiano(freq, dur, t, ctx);
          }
          t += dur;
          playedNotes += sub.beats;
        }
      }
    }

    if (progressBar) progressBar.value = (playedNotes / totalNotes) * 100;
  }

  // ── Single sleep for the entire pattern line ──────────────────────────
  // Use Web Audio clock (t) as reference — immune to JS event loop jitter.
  if (!isPlaying) return "STOP";
  if (skipRequested) return "SKIP";

  // ── Guaranteed-yield sleep ────────────────────────────────────────────
  // Problem diagnosed from OVERLAP-DIAG logs:
  //   remaining = (t - ctx.now)*1000 - 30
  //   At 60 BPM the gap between lineStartTime and ctx.now when the DIAG fires
  //   is only 18–28ms. Subtracting 30ms gives a negative remaining (-12ms to -1ms).
  //   `if (remaining > 0)` then skips the sleep entirely → setTimeout never fires
  //   → the JS loop spins at 100% CPU with no yield between lines.
  //
  //   Effect: the browser event loop is starved. Stop-button clicks, visibility-
  //   change events (idle timer), and other async events pile up in the queue.
  //   When a zero-sleep setTimeout(0) yield finally happens (it still yields once),
  //   ALL queued events flush simultaneously — including any pending Stop — causing
  //   an abrupt halt mid-session without the user pressing Stop.
  //
  // Fix: always sleep at least MIN_YIELD_MS (= 8ms, above the browser's 4ms floor).
  // If the real remaining time is larger, use that. This guarantees:
  //   1. A real yield on every line → events are processed promptly
  //   2. Wakeup still happens before the line ends at all practical BPMs
  //   3. No regression at fast BPM (remaining is large enough anyway)
  //
  // The 30ms early-wakeup was originally meant to give the loop time to schedule
  // the next line's notes before the current line finishes. Since ALL notes are
  // scheduled upfront at the start of playPattern (not per-note), waking up even
  // 8ms early is more than enough — the scheduling is O(n) note-object creation,
  // which takes < 1ms for any practical pattern.
  const MIN_YIELD_MS = 8;
  const rawRemaining = (t - ctx.currentTime) * 1000 - MIN_YIELD_MS;
  const sleepMs = Math.max(MIN_YIELD_MS, rawRemaining);
  await new Promise(r => setTimeout(r, sleepMs));

  // ── CRITICAL: re-check isPlaying AFTER the sleep ──────────────────────
  // The sleep above can last many seconds (slow BPM, long line). During that
  // time the user may press Stop, which sets isPlaying=false and nulls audioCtx,
  // then immediately press Play again, which sets isPlaying=true and creates a
  // new audioCtx (currentTime=0). Without this check, the old playSelected()
  // call wakes up, sees isPlaying=true (the NEW session), and returns nextT
  // from the OLD audio clock (e.g. 322s) — causing the new context to schedule
  // notes 322 seconds in the future, then fire them all at once when the clock
  // catches up, overlapping with the new session's notes.
  if (!isPlaying) return "STOP";
  if (skipRequested) return "SKIP";
  // AudioContext null-check: hardStopAllAudio() may have destroyed ctx during
  // the sleep. If so, our timestamps are stale and must not be returned as nextT.
  if (!audioCtx || !masterGain) return "STOP";
  // Session check: if playSessionId changed while we slept, a new play session
  // has started — our timestamps are from the old AudioContext and must be discarded.
  if (sessionId !== 0 && sessionId !== playSessionId) return "STOP";

  return { done: true, nextT: t }; // caller uses nextT as startTime for next line
}

function hardStopAllAudio() {
  if (!audioCtx) return;

  try {
    audioCtx.close();
  } catch {}

  audioCtx = null;
  masterGain = null;
  tanpuraSource = null;

  // do NOT reset tanpuraBuffer — keep it cached for next play
}

/**
 * Silence all scheduled audio IMMEDIATELY without closing the AudioContext.
 * Used by skip functions so the Web Audio clock and oscillator graph survive —
 * only the sound is cut.  Already-scheduled oscillator .stop() calls still fire
 * (cleaning up nodes), but the masterGain ramp to 0 means you hear nothing.
 * The gain is NOT restored here — startMetronome() and the playback loop both
 * set gain explicitly before their first note, so restoring it here at a fixed
 * 45 ms offset risks colliding with the new session's first scheduled sound.
 */
function silenceAllAudioInstantly() {
  if (!audioCtx || !masterGain) return;
  const now = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  // Ramp to zero over 20ms — fast enough to be perceived as instant, but
  // smooth enough to avoid a click artifact on the currently-playing note.
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(0.0001, now + 0.02);
  masterGain.gain.setValueAtTime(0, now + 0.02);
  // Do NOT pre-schedule a restore here. playPattern() sets masterGain.gain = 0.9
  // at its entry point before scheduling any notes. Pre-scheduling a restore at a
  // fixed offset from now collides with that explicit set, and also re-amplifies
  // still-running oscillators from the previous pattern (the root cause of overlap).
}

/***********************
 * MIC LISTENING ENGINE
 ***********************/
/* Detection functions removed */

/* ══════════════════════════════════════════════════════════════════════════
   JANYA — ON-DEMAND SERVER FETCH
   ──────────────────────────────────────────────────────────────────────────
   Janya ragam data (7,000+ rows) is never bulk-loaded into the browser.
   - The search box queries Supabase for matching names only (no aro/ava)
   - Selecting a ragam fetches that single row's full details
   - currentJanyaRecord holds the active ragam for playback
   ══════════════════════════════════════════════════════════════════════════ */

let selectedJanyaKey  = null;   // Supabase row id of currently selected janya
let currentJanyaRecord = null;  // { name, arohanam, avarohanam, melakarta }
let _janyaSearchTimer  = null;  // debounce handle

/* ── Fetch matching ragam names from server (no aro/ava returned) ─────── */
async function searchJanyaRagams(query) {
  const sb = window.__appUser?.supabase;
  if (!sb) return [];

  const q = query.trim();
  let req = sb
    .from('ragams')
    .select('id, name, melakarta')   // deliberately exclude arohanam/avarohanam
    .eq('type', 'janya')
    .order('name', { ascending: true })
    .limit(60);

  if (q.length >= 2) {
    req = req.ilike('name', `%${q}%`);
  }

  const { data, error } = await req;
  if (error) { console.error('[Janya] Search error:', error.message); return []; }
  return data || [];
}

/* ── Fetch full record for selected ragam (aro/ava only when needed) ──── */
/* Routes through get_ragam_detail RPC (SECURITY DEFINER, rate-limited)   */
/* rather than a direct table query — prevents bulk janya aro/ava scraping */
async function fetchJanyaRecord(id) {
  const sb = window.__appUser?.supabase;
  if (!sb) return null;

  const { data, error } = await sb.rpc('get_ragam_detail', { ragam_id: id });

  if (error) {
    if (error.message?.includes('Rate limit exceeded')) {
      console.warn('[Janya] Rate limit hit — too many ragam fetches this minute');
    } else {
      console.error('[Janya] Fetch error:', error.message);
    }
    return null;
  }

  // RPC returns an array (RETURNS TABLE) — take the first row
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) { console.warn('[Janya] No record found for id:', id); return null; }

  return {
    id:         id,           // Supabase row UUID — needed by playSignaturePhrases
    name:       row.name,
    arohanam:   row.arohanam,
    avarohanam: row.avarohanam,
    melakarta:  row.melakarta
  };
}

/* ── Show the search UI (called when Janya radio is selected) ─────────── */
function loadJanyaSearchUI() {
  document.getElementById('janyaSearchWrap').style.display = 'block';
  ragamSelect.style.display = 'none';
  ragamSelect.innerHTML = '';

  // Clear previous selection
  const inp = document.getElementById('janyaSearch');
  inp.value = '';
  document.getElementById('janyaDropdown').innerHTML = '';
  closeJanyaDropdown();

  // Show initial list immediately
  renderJanyaResults('');
}

/* ── Render search results in the dropdown ────────────────────────────── */
async function renderJanyaResults(query) {
  const dd = document.getElementById('janyaDropdown');
  dd.innerHTML = `<div class="jd-count">Searching…</div>`;
  openJanyaDropdown();

  const results = await searchJanyaRagams(query);

  if (results.length === 0) {
    dd.innerHTML = `<div class="jd-count">No ragams found</div>`;
    return;
  }

  const q = query.trim().toLowerCase();
  const countLine = q.length < 2
    ? `<div class="jd-count">Showing first 60 — type 2+ letters to search</div>`
    : `<div class="jd-count">${results.length} match${results.length !== 1 ? 'es' : ''} for "${query}"</div>`;

  const esc = s => s.replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function highlight(name) {
    if (!q || q.length < 2) return esc(name);
    const idx = name.toLowerCase().indexOf(q);
    if (idx < 0) return esc(name);
    return esc(name.slice(0, idx)) +
           `<mark>${esc(name.slice(idx, idx + q.length))}</mark>` +
           esc(name.slice(idx + q.length));
  }

  dd.innerHTML = countLine + results.map(r =>
    `<div class="jd-item" data-id="${r.id}" data-name="${esc(r.name)}" data-mela="${r.melakarta}">
       <span class="jd-name">${highlight(r.name)}</span>
       <span class="jd-meta">Mela ${r.melakarta} · ${melakarta_dict[r.melakarta]?.[0] || ''}</span>
     </div>`
  ).join('');

  dd.querySelectorAll('.jd-item').forEach(el => {
    el.addEventListener('mousedown', async e => {
      e.preventDefault();
      await selectJanyaItem(el.dataset.id, el.dataset.name, el.dataset.mela);
    });
  });

  openJanyaDropdown();
}

/* ── Select a janya ragam — fetches full record from server ───────────── */
async function selectJanyaItem(id, name, melaNo) {
  const inp = document.getElementById('janyaSearch');
  inp.value = `${name}  —  Mela ${melaNo}`;
  closeJanyaDropdown();

  // Show loading state
  selectedJanyaKey   = id;
  currentJanyaRecord = null;

  // Fetch the full record (aro/ava) from server
  const rec = await fetchJanyaRecord(id);
  if (rec) {
    currentJanyaRecord = rec;
    // Mirror into hidden select so ragamSelect.value works for rest of app
    ragamSelect.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = name;
    ragamSelect.appendChild(opt);
    ragamSelect.value = id;
  } else {
    inp.value = '';
    currentJanyaRecord = null;
  }
}

function openJanyaDropdown()  { document.getElementById('janyaDropdown').classList.add('open');    }
function closeJanyaDropdown() { document.getElementById('janyaDropdown').classList.remove('open'); }

/* ── Wire up the search input ─────────────────────────────────────────── */
(function initJanyaSearch() {
  const inp = document.getElementById('janyaSearch');

  inp.addEventListener('input', () => {
    const val = inp.value;
    // Debounce — wait 300ms after user stops typing before hitting server
    clearTimeout(_janyaSearchTimer);
    _janyaSearchTimer = setTimeout(() => renderJanyaResults(val), 300);
  });

  inp.addEventListener('focus', () => {
    const raw = inp.value;
    const query = raw.includes(' — ') ? '' : raw;
    if (raw.includes(' — ')) inp.value = '';
    renderJanyaResults(query);
  });

  inp.addEventListener('blur', () => {
    setTimeout(closeJanyaDropdown, 150);
    // Restore display text if a ragam is selected
    if (selectedJanyaKey && currentJanyaRecord && !inp.value.includes(' — ')) {
      inp.value = `${currentJanyaRecord.name}  —  Mela ${currentJanyaRecord.melakarta}`;
    }
  });

  // Keyboard navigation
  inp.addEventListener('keydown', e => {
    const dd   = document.getElementById('janyaDropdown');
    const items = Array.from(dd.querySelectorAll('.jd-item'));
    const cur   = dd.querySelector('.jd-item.active');
    let idx     = cur ? items.indexOf(cur) : -1;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (idx < items.length - 1) {
        cur?.classList.remove('active');
        items[idx + 1].classList.add('active');
        items[idx + 1].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (idx > 0) {
        cur?.classList.remove('active');
        items[idx - 1].classList.add('active');
        items[idx - 1].scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const active = dd.querySelector('.jd-item.active') || items[0];
      if (active) selectJanyaItem(active.dataset.id, active.dataset.name, active.dataset.mela);
    } else if (e.key === 'Escape') {
      closeJanyaDropdown();
    }
  });
})();

/* ══════════════════════════════════════════════════════════════════════════
   GAMAKAM ENGINE
   ══════════════════════════════════════════════════════════════════════════ */

const _GAMAKAM_BASE_FREQS = {
  s:130.8128,r1:138.5913,r2:146.8324,g1:146.8324,
  r3:155.5635,g2:155.5635,g3:164.8138,m1:174.6141,
  m2:184.9972,p:195.9977,d1:207.6524,d2:220.0000,
  n1:220.0000,d3:233.0819,n2:233.0819,n3:246.9417
};

function _centsToRatio(cents) { return Math.pow(2, cents / 1200); }

function _tokenToFreq(token, srutiFactor) {
  if (!token) return null;
  let octave = 1, key = token;
  if (key.startsWith("L_")) { octave = 0.5; key = key.slice(2); }
  if (key === key.toUpperCase() && key.length > 0) octave = 2;
  key = key.toLowerCase();
  const base = _GAMAKAM_BASE_FREQS[key];
  if (!base) return null;
  return base * octave * srutiFactor;
}

class GamakamEngine {
  constructor(ctx, masterGain) {
    this.ctx = ctx;
    this.masterGain = masterGain;
  }

  scheduleNote(freq, startTime, durSec, profile) {
    if (!freq || durSec <= 0) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.connect(this.masterGain);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = "sawtooth"; osc2.type = "triangle";
    osc1.frequency.value = freq;
    osc2.frequency.value = freq * 2;

    const g1 = ctx.createGain(); g1.gain.value = 0.65;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    osc1.connect(g1).connect(g);
    osc2.connect(g2).connect(g);

    const t0 = startTime, t_end = t0 + durSec;
    g.gain.setValueAtTime(0.001, t0);
    g.gain.linearRampToValueAtTime(0.7, t0 + Math.min(0.12, durSec * 0.15));
    g.gain.setValueAtTime(0.6, t0 + durSec * 0.70);
    g.gain.linearRampToValueAtTime(0.001, t_end + 0.12);

    if (profile && profile.type !== "none") {
      this._applyToOsc(osc1, osc2, freq, t0, durSec, profile);
    }

    osc1.start(t0); osc2.start(t0);
    const stopT = t_end + 0.18;
    osc1.stop(stopT); osc2.stop(stopT);
    osc2.onended = () => { try { g.disconnect(); } catch (_) {} };
  }

  _applyToOsc(osc1, osc2, freq, t0, durSec, profile) {
    switch (profile.type) {
      case "kampita":    this._kampita(osc1, osc2, freq, t0, durSec, profile); break;
      case "meend_up":   this._meendUp(osc1, osc2, freq, t0, profile);         break;
      case "meend_down": this._meendDown(osc1, osc2, freq, t0, durSec, profile); break;
      case "sphurita":   this._sphurita(osc1, osc2, freq, t0, profile);        break;
      case "andola":     this._andola(osc1, osc2, freq, t0, durSec, profile);  break;
    }
  }

  _kampita(osc1, osc2, base, t0, dur, p) {
    const delay  = (p.delayMs ?? 80) / 1000;
    const depth  = _centsToRatio(p.depthCents ?? 50);
    const period = 1 / (p.rateHz ?? 5);
    const tStart = t0 + delay, tEnd = t0 + dur;

    // Anchor both oscillators to base frequency before delay
    osc1.frequency.setValueAtTime(base,     t0);
    osc2.frequency.setValueAtTime(base * 2, t0);

    let t = tStart;
    while (t + period < tEnd) {
      // Asymmetric: 30% up, 70% down — Carnatic kampita biases toward lower pitch
      osc1.frequency.linearRampToValueAtTime(base * depth,     t + period * 0.30);
      osc1.frequency.linearRampToValueAtTime(base / depth,     t + period * 0.70);
      osc1.frequency.linearRampToValueAtTime(base,             t + period);
      osc2.frequency.linearRampToValueAtTime(base * depth * 2, t + period * 0.30);
      osc2.frequency.linearRampToValueAtTime(base / depth * 2, t + period * 0.70);
      osc2.frequency.linearRampToValueAtTime(base * 2,         t + period);
      t += period;
    }
    // Always return to exact base at note end — no dangling ramp
    osc1.frequency.linearRampToValueAtTime(base,     tEnd);
    osc2.frequency.linearRampToValueAtTime(base * 2, tEnd);
  }

  _meendUp(osc1, osc2, base, t0, p) {
    const fromFreq = base * _centsToRatio(p.fromOffsetCents ?? -100);
    const slideDur = (p.durationMs ?? 130) / 1000;
    // Start below pitch, slide up to base
    osc1.frequency.setValueAtTime(fromFreq,     t0);
    osc1.frequency.exponentialRampToValueAtTime(base,     t0 + slideDur);
    osc1.frequency.setValueAtTime(base,          t0 + slideDur); // anchor — prevents drift after slide
    osc2.frequency.setValueAtTime(fromFreq * 2, t0);
    osc2.frequency.exponentialRampToValueAtTime(base * 2, t0 + slideDur);
    osc2.frequency.setValueAtTime(base * 2,      t0 + slideDur); // anchor
  }

  _meendDown(osc1, osc2, base, t0, dur, p) {
    const toFreq     = base * _centsToRatio(p.toOffsetCents ?? -80);
    const slideDur   = (p.durationMs ?? 110) / 1000;
    const slideStart = t0 + dur - slideDur;
    // Anchor to base at note start — ensures clean start regardless of prior gamakam state
    osc1.frequency.setValueAtTime(base,     t0);
    osc2.frequency.setValueAtTime(base * 2, t0);
    // Hold base until slide begins, then ramp down
    osc1.frequency.setValueAtTime(base,     slideStart);
    osc1.frequency.exponentialRampToValueAtTime(toFreq,     t0 + dur);
    osc2.frequency.setValueAtTime(base * 2, slideStart);
    osc2.frequency.exponentialRampToValueAtTime(toFreq * 2, t0 + dur);
  }

  _sphurita(osc1, osc2, base, t0, p) {
    const upper = base * _centsToRatio(p.aboveCents ?? 100);
    const dur   = (p.durationMs ?? 65) / 1000;
    osc1.frequency.setValueAtTime(upper,     t0);
    osc1.frequency.exponentialRampToValueAtTime(base,     t0 + dur);
    osc2.frequency.setValueAtTime(upper * 2, t0);
    osc2.frequency.exponentialRampToValueAtTime(base * 2, t0 + dur);
  }

  _andola(osc1, osc2, base, t0, dur, p) {
    const delay  = (p.delayMs ?? 0) / 1000;
    const depth  = _centsToRatio(p.depthCents ?? 120);
    const period = 1 / (p.rateHz ?? 2.5);
    const tStart = t0 + delay, tEnd = t0 + dur;

    // Anchor to base at t0 (holds through the delay)
    osc1.frequency.setValueAtTime(base,     t0);
    osc2.frequency.setValueAtTime(base * 2, t0);

    let t = tStart;
    while (t + period < tEnd) {
      osc1.frequency.linearRampToValueAtTime(base * depth,     t + period * 0.30);
      osc1.frequency.linearRampToValueAtTime(base / depth,     t + period * 0.70);
      osc1.frequency.linearRampToValueAtTime(base,             t + period);
      osc2.frequency.linearRampToValueAtTime(base * depth * 2, t + period * 0.30);
      osc2.frequency.linearRampToValueAtTime(base / depth * 2, t + period * 0.70);
      osc2.frequency.linearRampToValueAtTime(base * 2,         t + period);
      t += period;
    }
    // Close any partial cycle — always land on base at note end
    osc1.frequency.linearRampToValueAtTime(base,     tEnd);
    osc2.frequency.linearRampToValueAtTime(base * 2, tEnd);
  }
}

/* ── Edge function fetch helper ──────────────────────────────────────────── */
const GAMAKAM_EF_URL = 'https://wcpbbvurfbraqqqlpsro.supabase.co/functions/v1/get-gamakam';

async function _fetchGamakamQueue(mode, payload) {
  const sb = window.__appUser?.supabase;
  if (!sb) throw new Error('[Gamakam] Supabase not available');
  const { data: sessData } = await sb.auth.getSession();
  const token = sessData?.session?.access_token;
  if (!token) throw new Error('[Gamakam] No auth token');
  const res = await fetch(GAMAKAM_EF_URL, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey':        SUPABASE_ANON,
    },
    body: JSON.stringify({ mode, ...payload }),
  });
  if (!res.ok) { const err = await res.text(); throw new Error(`[Gamakam] EF ${res.status}: ${err}`); }
  return res.json();
}

/* ── playJanyaWithGamakam ────────────────────────────────────────────────── */
//
// Beat-duration logic for gamakam aro/ava:
//   One swara = one beat = 60/bpm seconds.
//   Gamakam types need minimum durations:
//     kampita  @ 5 Hz  → 1 oscillation = 0.20 s  → need ≥ 0.50 s (2+ cycles)
//     andola   @ 2.5Hz → 1 oscillation = 0.40 s  → need ≥ 0.60 s (1+ cycle)
//     meend_up/down    → slide is 130 ms → rest of note is plain
//     sphurita         → mordent is 65 ms → rest of note is plain
//   At 60 BPM: 60/60 = 1.00 s per beat  — all types work
//   At 80 BPM: 60/80 = 0.75 s per beat  — all types work
//   At 100BPM: 60/100= 0.60 s per beat  — kampita & andola borderline, acceptable
//
// Per-swara duration override: swaras tagged with gamakam types kampita/andola
// are given 1.5× the base duration so oscillations complete cleanly.
// Sa and Pa (no gamakam, type "none") are given 0.75× — they are anchor notes.
//
async function playJanyaWithGamakam({ ragamId, arohanam, avarohanam, melakarta, srutiFactor, bpm, mySessionId }) {
  let efData;
  try {
    efData = await _fetchGamakamQueue("aro_ava", { ragamId, arohanam, avarohanam, melakarta });
  } catch (e) {
    console.error('[Gamakam]', e.message);
    return null; // caller falls back to plain playback
  }

  if (mySessionId !== playSessionId) return "STOP";

  const ctx    = getAudioCtx();
  const engine = new GamakamEngine(ctx, masterGain);

  if (masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(0.9, ctx.currentTime);
  }

  // ── FIXED: one beat = 60/bpm seconds, not the varisai aksharam formula ──
  // The old formula  (21.6 / bpm) * currentGati  was for varisai patterns
  // where currentGati (4 or 3) subdivides each aksharam. For aro/ava each
  // swara IS one beat — no subdivision needed.
  const oneBeat = 60 / bpm;

  // Duration multiplier per gamakam type so oscillations complete cleanly
  function _noteDur(profileName) {
    if (profileName === 'kampita') return oneBeat * 1.5;  // 2+ oscillation cycles
    if (profileName === 'andola')  return oneBeat * 1.6;  // 1+ wide cycle
    if (profileName === 'none')    return oneBeat * 0.85; // anchor notes slightly shorter
    return oneBeat;                                        // meend_up/down, sphurita: 1 beat
  }

  let t = ctx.currentTime + 0.05;

  for (const item of efData.playQueue) {
    if (!isPlaying) return "STOP";
    if (skipRequested) return "SKIP";

    dynamicInfo.innerHTML = `<b>${item.label}</b>`;

    const { swaras, freqOffsets, gamakamDefs } = item;

    for (let i = 0; i < swaras.length; i++) {
      const freq        = _tokenToFreq(swaras[i], srutiFactor);
      const profileName = freqOffsets[i] ?? "none";
      const profile     = gamakamDefs[profileName] ?? { type: "none" };
      const durSec      = _noteDur(profileName);

      if (freq) {
        engine.scheduleNote(freq, t, durSec, profile);
        if (typeof scoringOnNote === 'function') scoringOnNote(freq, durSec * 1000);
      }
      t += durSec;
    }

    // Gap between arohanam and avarohanam — one plain beat
    t += oneBeat * 0.5;

    const MIN_YIELD_MS = 8;
    const rawRemaining = (t - ctx.currentTime) * 1000 - MIN_YIELD_MS;
    await new Promise(r => setTimeout(r, Math.max(MIN_YIELD_MS, rawRemaining)));

    if (!isPlaying) return "STOP";
    if (skipRequested) return "SKIP";
    if (!audioCtx || !masterGain) return "STOP";
    if (mySessionId !== playSessionId) return "STOP";
  }

  return "DONE";
}

/* ── playSignaturePhrases ────────────────────────────────────────────────── */
//
// Plays the characteristic (pidi) phrases stored in ragams.swaras for a janya
// ragam.  Called automatically after aro/ava gamakam playback completes.
//
// Profile merge strategy — inline phrase values win over the shared profile:
//   profile = { ...allGamakamProfiles[gDef.type], ...gDef }
// This lets stored phrases tune depthCents / rateHz per-context without
// requiring a separate profile key in the edge function.
//
async function playSignaturePhrases(ragamId, srutiFactor, bpm, mySessionId) {
  if (!ragamId) return;
  let efData;
  try {
    efData = await _fetchGamakamQueue('phrases', { ragamId });
  } catch (e) {
    console.error('[Gamakam] Phrase fetch failed:', e.message);
    return;
  }

  const { phrases, allGamakamProfiles } = efData;
  if (!phrases || phrases.length === 0) {
    dynamicInfo.innerHTML = '<i>No signature phrases stored for this ragam yet.</i>';
    return;
  }

  if (mySessionId !== playSessionId) return;

  const ctx = getAudioCtx();
  const engine = new GamakamEngine(ctx, masterGain);
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(0.9, ctx.currentTime);
  }

  // one beat = 60/bpm seconds; duration_beats scales each swara relative to that.
  const oneBeat = 60 / bpm;

  // Minimum note duration for gamakam types that need time to complete their
  // oscillation or slide — mirrors the logic in playJanyaWithGamakam._noteDur().
  function _phraseDur(beatCount, profileType) {
    const raw = oneBeat * (beatCount ?? 1);
    if (profileType === 'kampita') return Math.max(raw, oneBeat * 1.5);
    if (profileType === 'andola')  return Math.max(raw, oneBeat * 1.6);
    return raw;
  }

  // Brief separator shown in the UI between aro/ava block and phrases
  dynamicInfo.innerHTML = '<b>Characteristic Phrases</b>';
  await new Promise(r => setTimeout(r, 300));

  let t = ctx.currentTime + 0.05;

  for (const phrase of phrases) {
    if (!isPlaying || skipRequested || mySessionId !== playSessionId) break;

    dynamicInfo.innerHTML =
      `<b>Phrase: ${phrase.name || phrase.id}</b>` +
      `<span style="font-weight:normal;color:#666"> (${phrase.direction === 'aro' ? '\u2191' : '\u2193'})</span>`;

    const { swaras, gamakam = [], duration_beats = [] } = phrase;

    // Index gamakam entries by swara position for O(1) lookup
    const gByIndex = {};
    for (const g of gamakam) gByIndex[g.swara_index] = g;

    for (let i = 0; i < swaras.length; i++) {
      const freq  = _tokenToFreq(swaras[i], srutiFactor);
      const gDef  = gByIndex[i];

      // Merge: shared profile sets defaults; inline phrase values override them.
      // Strip swara_index from the merged object — it is metadata, not an audio param.
      let profile = { type: 'none' };
      if (gDef) {
        const base = allGamakamProfiles[gDef.type] ?? {};
        const { swara_index: _drop, ...inlineParams } = gDef;
        profile = { ...base, ...inlineParams };
      }

      const durSec = _phraseDur(duration_beats[i], profile.type);
      if (freq) engine.scheduleNote(freq, t, durSec, profile);
      t += durSec;
    }

    // One-beat gap between phrases — lets the last note ring and gives a
    // rhythmic breath before the next phrase starts.
    t += oneBeat;

    const MIN_YIELD_MS = 8;
    const rawRemaining = (t - ctx.currentTime) * 1000 - MIN_YIELD_MS;
    await new Promise(r => setTimeout(r, Math.max(MIN_YIELD_MS, rawRemaining)));
  }
}