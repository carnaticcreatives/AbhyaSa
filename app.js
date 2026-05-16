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
  // Normalise names (trim + collapse whitespace) before keying so that DB rows
  // which differ only by invisible characters don't produce duplicate dropdown entries.
  const newAudava = {};
  data.filter(r => r.type === 'audava').forEach(r => {
    const key = r.name.trim().replace(/\s+/g, ' ');
    newAudava[key] = { aro: r.arohanam, ava: r.avarohanam };
  });
  _audava_ragam_dict_live = newAudava;

  // ── Build shadava dict  { name: { aro, ava } } ─────────────────────────
  const newShadava = {};
  data.filter(r => r.type === 'shadava').forEach(r => {
    const key = r.name.trim().replace(/\s+/g, ' ');
    newShadava[key] = { aro: r.arohanam, ava: r.avarohanam };
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

    // Clear display boxes whenever ragam type changes
    staticInfo.innerHTML = "";
    dynamicInfo.innerHTML = "";

    // Hide janya search widget when switching away from Janya
    if (r.value !== "janya") {
      document.getElementById("janyaSearchWrap").style.display = "none";
      ragamSelect.style.display = "";
    }

    // For audava/shadava: always wait for the Supabase load before populating
    // the dropdown, even if ragamInitPromise hasn't been set yet (user clicked
    // the tab before ragamInit() fired). If ragamInitPromise is null we start
    // ragamInit() ourselves so there is a promise to await.
    if (r.value === "audava" || r.value === "shadava") {
      if (!ragamInitPromise) ragamInit(); // kick off if not already started
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
 *  Loads audava, shadava and sampoorna ragams from Supabase, then populates
 *  whichever tab is currently active.
 *
 *  ROOT CAUSE OF DUPLICATE: The old code ran the per-tab branch first
 *  (e.g. loadAudavaRagams()), then called loadSampoornaRagams() unconditionally
 *  at the end. That unconditional call wiped ragamSelect and refilled it with
 *  sampoorna ragams. The onchange handler — which was ALSO awaiting
 *  ragamInitPromise — then called loadAudavaRagams() again to fix the display,
 *  resulting in two successive populations of the audava list and therefore
 *  two copies of every ragam including Suddha Saveri.
 *
 *  FIX: call loadSampoornaRagams() FIRST (so melakarta_dict is in the DOM for
 *  later tab switching), then overwrite ragamSelect with the correct active-tab
 *  content. No unconditional second call at the end. Guard against re-entry. */
async function ragamInit() {
  if (ragamInitPromise) {
    // Already running or completed — reuse the existing promise, don't re-fetch
    await ragamInitPromise;
    return;
  }

  ragamInitPromise = loadAllRagamsFromSupabase();
  try {
    await ragamInitPromise;

    // Step 1: always fill sampoorna first so the sampoorna tab is ready
    // for switching, and so melakarta_dict is populated into the DOM.
    loadSampoornaRagams();

    // Step 2: if the user is on a different tab, overwrite ragamSelect now.
    // This MUST come after step 1 — if it came before, loadSampoornaRagams()
    // would wipe the audava/shadava fill and trigger the duplicate bug.
    const currentType = document.querySelector("input[name=ragaType]:checked")?.value;
    if (currentType === "audava") {
      loadAudavaRagams();
    } else if (currentType === "shadava") {
      loadShadavaRagams();
    } else if (currentType === "janya") {
      loadJanyaSearchUI();
    }
    // sampoorna / tambura / null: step 1 already set ragamSelect correctly.

  } catch(e) {
    console.error('[RagamInit] Failed to load ragams from Supabase:', e.message);
  }
}


/***********************
 * AUDIO ENGINE STATE *
 ***********************/
let audioCtx = null;
let masterGain = null;
let tanpuraGainNode = null;   // Dedicated gain node — clamps tanpura to background level
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



// ── Vocal Formant Dictionary ────────────────────────────────────────────────
// Each vowel defines 3 formant frequencies (Hz), Q values, and relative gains.
// The gain array correctly weights the three peaks — F1 loudest, F3 quietest.
//   'Aa' — open mouth, main Carnatic akaram vowel
//   'Ee' — bright, front vowel — upper register phrases
//   'Oo' — dark, rounded — lower register (mandraa sthayi)
const VOWEL_MAP = {
  'Aa': { f: [730, 1090, 2440], q: [7,  8,  10], g: [1.0, 0.60, 0.35] },
  'Ee': { f: [270, 2290, 3010], q: [10, 12, 12], g: [1.0, 0.40, 0.25] },
  'Oo': { f: [300,  870, 2240], q: [8,  10, 10], g: [1.0, 0.50, 0.18] }
};

// ── S-Curve legato in log-Hz space ──────────────────────────────────────────
// Interpolates fromHz→toHz using 3t²-2t³ smoothstep, working in CENTS (log
// domain) so the acceleration feels symmetric to the ear. A straight Hz ramp
// sounds faster going down; a cents-domain curve is perceptually even.
function getSCurveHz(fromHz, toHz, srutiSaHz, len) {
  len = len || 128;
  const curve    = new Float32Array(len);
  const fromCent = 1200 * Math.log2(Math.max(20, fromHz) / srutiSaHz);
  const toCent   = 1200 * Math.log2(Math.max(20, toHz)   / srutiSaHz);
  for (let i = 0; i < len; i++) {
    const t   = i / (len - 1);
    const sqt = t * t * (3 - 2 * t);
    curve[i]  = Math.max(20, srutiSaHz * Math.pow(2, (fromCent + (toCent - fromCent) * sqt) / 1200));
  }
  return curve;
}

// ── Vocal "Grit" WaveShaper — cached singleton ──────────────────────────────
// tanh(x*1.1)/tanh(1.1) is a very soft saturation — adds ~10% THD which
// the ear perceives as "organic" texture rather than audible distortion.
let _vocalGritCurve = null;
function getVocalGritCurve() {
  if (_vocalGritCurve) return _vocalGritCurve;
  const n = 4096, norm = Math.tanh(1.1);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; c[i] = Math.tanh(x * 1.1) / norm; }
  _vocalGritCurve = c;
  return c;
}

/***********************
 * AUDIO CONTEXT
 ***********************/
function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    // Master output node — carries melody, varisai, and raga lakshana
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.9;
    masterGain.connect(audioCtx.destination);

    // Dedicated tanpura gain — clamped to 14% so the drone stays in the background
    // and never overpowers the melodic content routed through masterGain
    tanpuraGainNode = audioCtx.createGain();
    tanpuraGainNode.gain.value = 0.14;
    tanpuraGainNode.connect(audioCtx.destination);
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

  // ACOUSTIC BALANCE FIX: Route tanpura through the dedicated tanpuraGainNode
  // (clamped to 0.14 in getAudioCtx) rather than through masterGain.
  // This keeps the drone at ~14% while melodic content on masterGain stays dominant.
  tanpuraGainNode.gain.setValueAtTime(0.14, ctx.currentTime);
  tanpuraSource.connect(tanpuraGainNode);
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
  // ragamNotes has 5 entries for audava, 6 for shadava.
  // Alankaram patterns use a1-a6 as positional placeholders:
  //   a1-a5 = the ragam's own swaras in arohanam order
  //   a6    = high-octave repetition of a1 (tara sthayi)
  //           For audava (5 notes) ragamNotes[5] is undefined — derive it.
  //   A1    = same as a6 (uppercase DSL token = tara sa)
  const highOctaveA1 = ragamNotes[0] ? ragamNotes[0].toUpperCase() : ragamNotes[0];

  const map = {
    a1: ragamNotes[0],
    a2: ragamNotes[1],
    a3: ragamNotes[2],
    a4: ragamNotes[3],
    a5: ragamNotes[4],
    // a6: for audava (5-note), ragamNotes[5] is undefined — fall back to tara sa
    a6: ragamNotes[5] !== undefined ? ragamNotes[5] : highOctaveA1,
  };

  return pattern.replace(/\b(a[1-6]|A1)\b/g, m =>
    m === "A1" ? highOctaveA1 : (map[m] ?? m)
  );
}

function resolveAudavaPatternForDisplay(pattern, ragamNotes) {
  const highOctaveA1 = ragamNotes[0] ? ragamNotes[0].toUpperCase() : ragamNotes[0];

  const map = {
    a1: ragamNotes[0],
    a2: ragamNotes[1],
    a3: ragamNotes[2],
    a4: ragamNotes[3],
    a5: ragamNotes[4],
    a6: ragamNotes[5] !== undefined ? ragamNotes[5] : highOctaveA1,
  };

  return pattern.replace(/\b(a[1-6]|A1)\b/g, m =>
    m === "A1" ? highOctaveA1 : (map[m] ?? m)
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

  // ── Vocal "Aa" formant engine — matches playNote() vocal path ────────────
  // Replaces the old harmonium (sawtooth + octave triangle, no filter).
  // Now: sawtooth (buzz) + triangle (body) → 3 parallel bandpass formants
  // + breath drift LFO for natural pitch instability.

  // 1. Breath drift LFO (+/-9 cents at ~3.5 Hz)
  const driftLfo  = ctx.createOscillator();
  const driftGain = ctx.createGain();
  driftLfo.type            = 'sine';
  driftLfo.frequency.value = 3.5 + (Math.random() - 0.5) * 0.8;
  driftGain.gain.value     = 9;
  driftLfo.connect(driftGain);

  // 2. Oscillators — buzz + body blend
  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'sawtooth'; // vocal cord buzz
  osc2.type = 'triangle'; // chest resonance
  osc1.frequency.value = freq;
  osc2.frequency.value = freq;
  driftGain.connect(osc1.detune);
  driftGain.connect(osc2.detune);

  const g1 = ctx.createGain(); g1.gain.value = 0.48;
  const g2 = ctx.createGain(); g2.gain.value = 0.52;
  osc1.connect(g1);
  osc2.connect(g2);

  // 3. Register-aware vowel + formant filter bank with per-filter gain weighting
  const vowelKey = freq > 523 ? 'Ee' : (freq < 131 ? 'Oo' : 'Aa');
  const vDef     = VOWEL_MAP[vowelKey];
  const atkEnd   = startTime + 0.03;

  const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = vDef.q[0];
  const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = vDef.q[1];
  const f3 = ctx.createBiquadFilter(); f3.type = 'bandpass'; f3.Q.value = vDef.q[2];
  f1.frequency.setValueAtTime(vDef.f[0] * 1.12, startTime); f1.frequency.exponentialRampToValueAtTime(vDef.f[0], atkEnd);
  f2.frequency.setValueAtTime(vDef.f[1] * 1.18, startTime); f2.frequency.exponentialRampToValueAtTime(vDef.f[1], atkEnd);
  f3.frequency.setValueAtTime(vDef.f[2] * 1.14, startTime); f3.frequency.exponentialRampToValueAtTime(vDef.f[2], atkEnd);

  const fgArr = [f1, f2, f3].map((f, i) => {
    const fg = ctx.createGain(); fg.gain.value = vDef.g[i];
    g1.connect(f); g2.connect(f); f.connect(fg);
    return fg;
  });

  const fMix = ctx.createGain(); fMix.gain.value = 0.88;
  fgArr.forEach(fg => fg.connect(fMix));

  // Vocal grit (tanh soft-clip) — subtle organic saturation
  const grit = ctx.createWaveShaper();
  grit.curve      = getVocalGritCurve();
  grit.oversample = '2x';
  fMix.connect(grit);
  grit.connect(gain);

  // 4. Smooth vocal envelope — peak at 0.82 so melody cuts clearly over the tanpura drone
  const atk = Math.min(0.04, Math.max(0.012, dur * 0.06));
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.82,  startTime + atk);
  gain.gain.setValueAtTime(0.72, startTime + dur * 0.75);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur + 0.08);

  driftLfo.start(startTime);
  osc1.start(startTime);
  osc2.start(startTime);

  const stopTime = startTime + dur + 0.2;
  driftLfo.stop(stopTime);
  osc1.stop(stopTime);
  osc2.stop(stopTime);

  osc2.onended = () => {
    try { f1.disconnect(); f2.disconnect(); f3.disconnect();
          fgArr.forEach(fg => fg.disconnect());
          fMix.disconnect(); grit.disconnect(); gain.disconnect(); } catch (_) {}
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
  // Tisram gati (3) applies for BOTH:
  //   • isTisramSinging — the "Tisram singing" variety dropdown
  //   • isTisram        — "Alankaram-Tisram" varisai (audava/shadava/sampoorna)
  // Without this, Alankaram-Tisram patterns play at Chatusram speed (too fast/slow).
  if (isTisramSinging || isTisram) {
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

  // Derive Melakarta from the fetched record
  const melaNo = currentJanyaRecord.melakarta;
  const melaName = melakarta_dict[melaNo]?.[0] || "Unknown";

  // Display info (Janya-specific) — always shown regardless of gamakam path
  staticInfo.innerHTML =
    `<b>Ragam:</b> ${ragamName}<br>` +
    `<b>Melakarta Ragam:</b> ${melaName} (${melaNo})<br>` +
    `<b>Arohanam:</b> ${aro}<br>` +
    `<b>Avarohanam:</b> ${ava}<br>` +
    `<span style="font-size:12px;color:#c0392b">
      <b>The arohanam and avarohanam played here are only indicative. A raga’s true character cannot be conveyed through a simple scale; it emerges through characteristic phrases, gamakas, and nuanced rendition.<b>
    </span>`;

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
    // Aro/ava gamakam ran — follow up with signature phrases unless the user
    // explicitly stopped playback (isPlaying=false) or the session changed.
    // "SKIP" means the user skipped past aro/ava — we still play phrases.
    // "STOP" means isPlaying was set false — respect that and bail out.
    const shouldPlayPhrases = (_gamakamResult === "DONE" || _gamakamResult === "SKIP")
      && isPlaying
      && mySessionId === playSessionId;

    if (shouldPlayPhrases) {
      skipRequested = false; // clear any skip flag so phrases play uninterrupted
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

  //playPatternQueue();

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

function startMetronome(ctx, baseBpm, gati, startTime, forceTalam = false, tisramSinging = false, matraClicks = false) {
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

      // Tala practice matra clicks: fire (gati-1) sub-clicks, one per matra
      // subdivision within the aksharam. Works for any gati (3/4/5/7).
      if (matraClicks && !tisramSinging && gati > 1) {
        for (let m = 1; m < gati; m++) {
          const tm = t + matraDur * m;
          if (tm < _metronomeEndTime) _gatiSubClick(ctx, tm);
        }
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

  const matraClicks = document.getElementById('tpMatraClicks')?.checked || false;

  const ctx = getAudioCtx();
  startMetronome(ctx, bpmVal, currentGati, ctx.currentTime + 0.1, true, false, matraClicks);

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
  tanpuraGainNode = null;
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

  // pack field stores popularity tier: P1 (top ~50) → P2 (~100) → P3 (rest)
  const TIER_ORDER = { 'P1': 1, 'P2': 2, 'P3': 3 };

  let req = sb
    .from('ragams')
    .select('id, name, melakarta, pack')   // pack = popularity tier (P1/P2/P3)
    .eq('type', 'janya')
    .order('pack', { ascending: true })    // P1 < P2 < P3 alphabetically
    .order('name', { ascending: true })
    .limit(60);

  if (q.length >= 2) {
    req = req.ilike('name', `%${q}%`);
  }

  const { data, error } = await req;
  if (error) { console.error('[Janya] Search error:', error.message); return []; }

  // Re-sort client-side using explicit tier order in case DB ordering differs
  return (data || []).sort((a, b) => {
    const ta = TIER_ORDER[a.pack] ?? 9;
    const tb = TIER_ORDER[b.pack] ?? 9;
    if (ta !== tb) return ta - tb;
    return a.name.localeCompare(b.name);
  });
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
  dd.innerHTML = '<div class="jd-count">Searching\u2026</div>';
  openJanyaDropdown();

  const results = await searchJanyaRagams(query);

  if (results.length === 0) {
    dd.innerHTML = '<div class="jd-count">No ragams found</div>';
    return;
  }

  const q = query.trim().toLowerCase();
  const isSearching = q.length >= 2;

  const countLine = !isSearching
    ? '<div class="jd-count">Showing first 60 \u2014 type 2+ letters to search</div>'
    : '<div class="jd-count">' + results.length + ' match' + (results.length !== 1 ? 'es' : '') + ' for "' + query + '"</div>';

  const esc = s => s.replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  function highlight(name) {
    if (!q || q.length < 2) return esc(name);
    const idx = name.toLowerCase().indexOf(q);
    if (idx < 0) return esc(name);
    return esc(name.slice(0, idx)) +
           '<mark>' + esc(name.slice(idx, idx + q.length)) + '</mark>' +
           esc(name.slice(idx + q.length));
  }

  const TIER_LABEL = { 'P1': '\u2B50 Popular', 'P2': 'Well Known', 'P3': 'All Ragams' };

  let html = countLine;
  let lastTier = null;

  results.forEach(function(r) {
    // Insert section header when tier changes (browse mode only)
    if (!isSearching && r.pack !== lastTier) {
      html += '<div class="jd-tier-header">' + (TIER_LABEL[r.pack] || r.pack) + '</div>';
      lastTier = r.pack;
    }

    // Show tier badge inline during search
    const tierBadge = isSearching
      ? '<span class="jd-tier jd-tier-' + r.pack + '">' + r.pack + '</span>'
      : '';

    html += '<div class="jd-item" data-id="' + r.id + '" data-name="' + esc(r.name) + '" data-mela="' + r.melakarta + '">' +
      '<span class="jd-name">' + highlight(r.name) + tierBadge + '</span>' +
      '<span class="jd-meta">Mela ' + r.melakarta + ' \u00B7 ' + (melakarta_dict[r.melakarta]?.[0] || '') + '</span>' +
      '</div>';
  });

  dd.innerHTML = html;

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

    // Refresh display box immediately on selection
    const melaName = melakarta_dict[rec.melakarta]?.[0] || 'Unknown';
    staticInfo.innerHTML =
      `<b>Ragam:</b> ${rec.name}<br>` +
      `<b>Melakarta Ragam:</b> ${melaName} (${rec.melakarta})<br>` +
      `<b>Arohanam:</b> ${rec.arohanam}<br>` +
      `<b>Avarohanam:</b> ${rec.avarohanam}<br>` +
      `<span style="font-size:12px;color:#c0392b">` +
      `<b>The arohanam and avarohanam played here are only indicative. A raga's true character cannot be conveyed through a simple scale; it emerges through characteristic phrases, gamakas, and nuanced rendition.</b>` +
      `</span>`;
    dynamicInfo.innerHTML = '';
  } else {
    inp.value = '';
    currentJanyaRecord = null;
    staticInfo.innerHTML = '';
    dynamicInfo.innerHTML = '';
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

    // ── Vocal timbre — matches the upgraded playNote() vocal path ────────────
    // sawtooth (buzz) + triangle (body) → parallel "Aa" formant filters → gain
    // This makes aro/ava (legacy PATH B) sound identical to phrase playback.
    const t0    = startTime;
    const t_end = t0 + durSec;

    const g = ctx.createGain();
    g.connect(this.masterGain);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc2.detune.value = 0;  // breath LFO handles spread

    const g1 = ctx.createGain(); g1.gain.value = 0.48;
    const g2 = ctx.createGain(); g2.gain.value = 0.52;
    osc1.connect(g1); osc2.connect(g2);

    // Breath drift LFO
    const driftLfo  = ctx.createOscillator();
    const driftGain = ctx.createGain();
    driftLfo.type            = 'sine';
    driftLfo.frequency.value = 3.5 + (Math.random() - 0.5) * 0.8;
    driftGain.gain.value     = 9;
    driftLfo.connect(driftGain);
    driftGain.connect(osc1.detune);
    driftGain.connect(osc2.detune);
    driftLfo.start(t0);
    driftLfo.stop(t_end + 0.05);

    // Register-aware vowel selection + per-filter gain weighting
    const vowelKey = freq > 523 ? 'Ee' : (freq < 131 ? 'Oo' : 'Aa');
    const vDef     = VOWEL_MAP[vowelKey];

    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = vDef.q[0];
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = vDef.q[1];
    const f3 = ctx.createBiquadFilter(); f3.type = 'bandpass'; f3.Q.value = vDef.q[2];

    const atkMs = 0.03;
    f1.frequency.setValueAtTime(vDef.f[0] * 1.12, t0); f1.frequency.exponentialRampToValueAtTime(vDef.f[0], t0 + atkMs);
    f2.frequency.setValueAtTime(vDef.f[1] * 1.18, t0); f2.frequency.exponentialRampToValueAtTime(vDef.f[1], t0 + atkMs);
    f3.frequency.setValueAtTime(vDef.f[2] * 1.14, t0); f3.frequency.exponentialRampToValueAtTime(vDef.f[2], t0 + atkMs);

    const fgArr = [f1, f2, f3].map((f, i) => {
      const fg = ctx.createGain(); fg.gain.value = vDef.g[i];
      g1.connect(f); g2.connect(f); f.connect(fg);
      return fg;
    });

    const fMix = ctx.createGain(); fMix.gain.value = 0.88;
    fgArr.forEach(fg => fg.connect(fMix));

    const grit = ctx.createWaveShaper();
    grit.curve      = getVocalGritCurve();
    grit.oversample = '2x';
    fMix.connect(grit);
    grit.connect(g);

    // ACOUSTIC BALANCE: Melody peak is raised to 0.75/0.72 so raga aro/ava and
    // signature phrase notes remain clearly dominant over the 14% tanpura drone.
    const peakGain    = (profile?.type === 'kampita' || profile?.type === 'andola') ? 0.75 : 0.72;
    const atk         = Math.min(0.025, Math.max(0.010, durSec * 0.06));
    const releaseFloor = durSec >= 0.45 ? 0.001 : 0.18;
    const rel          = 0.018;

    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(peakGain,       t0 + atk);
    g.gain.setValueAtTime(peakGain * 0.88,              t_end - rel);
    g.gain.exponentialRampToValueAtTime(releaseFloor,   t_end);

    if (profile && profile.type !== "none") {
      this._applyToOsc(osc1, osc2, freq, t0, durSec, profile);
    } else {
      osc1.frequency.setValueAtTime(freq, t0);
      osc2.frequency.setValueAtTime(freq, t0);
    }

    osc1.start(t0); osc2.start(t0);
    const stopT = t_end + 0.02;
    osc1.stop(stopT); osc2.stop(stopT);
    osc2.onended = () => {
      try { f1.disconnect(); f2.disconnect(); f3.disconnect();
            fgArr.forEach(fg => fg.disconnect());
            fMix.disconnect(); grit.disconnect(); g.disconnect(); } catch (_) {}
    };
  }

  // ── scheduleCurve ────────────────────────────────────────────────────────
  //
  // Plays a phrase as a SINGLE continuous oscillator whose pitch is driven by
  // a curve array: [{t: ms_from_phrase_start, c: cents_relative_to_sruti}, ...]
  //
  // Why one oscillator per phrase instead of one per note:
  //   A violin string or voice never stops between notes — pitch moves
  //   continuously. Carnatic gamakas (jaru, kampita, meend) are defined by
  //   the trajectory between notes, not by what happens on each note alone.
  //   Multiple oscillators each starting from silence produce audible clicks
  //   and destroy continuity. One oscillator + AudioParam automation =
  //   physically continuous pitch motion.
  //
  // humanize: { timeFrac: 0–0.08, cents: 0–15 }
  //   Slightly jitters each control point in time and pitch so repeated
  //   playback never sounds identical — matches natural performance variation.
  //
  scheduleCurve(curvePoints, startTime, totalDurSec, humanize = {}) {
    if (!curvePoints || curvePoints.length < 2 || totalDurSec <= 0) return;
    const ctx = this.ctx;

    // ── Build humanized control points ──────────────────────────────────
    const timeFrac  = humanize.timeFrac ?? 0;
    const centJit   = humanize.cents    ?? 0;

    // We need frequencies, not cents — caller has already set srutiHz
    // so we receive pre-converted frequencies in curvePoints[].f
    // (see _curveFreqs() in playSignaturePhrases which does the conversion)
    const pts = curvePoints.map((pt, i) => {
      const tJit = (i > 0 && i < curvePoints.length - 1)
        ? pt.tSec * (1 + (Math.random() * 2 - 1) * timeFrac)
        : pt.tSec;
      const cJit = centJit > 0
        ? pt.f * Math.pow(2, (Math.random() * 2 - 1) * centJit / 1200)
        : pt.f;
      return { tSec: tJit, f: cJit };
    });

    // ── Vocal formant engine — identical to playNote/playGlide ───────────
    // Previously: sawtooth+triangle directly to gain, osc2 octave-doubled,
    // linear gain ramps, exponential pitch ramps between control points.
    // Now: formant bank + grit + breath drift + S-curve pitch segments.
    const t0    = startTime;
    const t_end = t0 + totalDurSec;

    const g = ctx.createGain();
    g.connect(this.masterGain);

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth'; osc2.type = 'triangle';

    const g1 = ctx.createGain(); g1.gain.value = 0.48;
    const g2 = ctx.createGain(); g2.gain.value = 0.52;
    osc1.connect(g1); osc2.connect(g2);

    // Breath drift LFO — same as playNote
    const driftLfo  = ctx.createOscillator();
    const driftGain = ctx.createGain();
    driftLfo.type = 'sine'; driftLfo.frequency.value = 3.5 + (Math.random() - 0.5) * 0.8;
    driftGain.gain.value = 9;
    driftLfo.connect(driftGain);
    driftGain.connect(osc1.detune); driftGain.connect(osc2.detune);
    driftLfo.start(t0); driftLfo.stop(t_end + 0.1);

    // Register-aware vowel from the MIDPOINT of the phrase
    const midPt   = pts[Math.floor(pts.length / 2)];
    const midFreq = midPt ? midPt.f : (pts[0] ? pts[0].f : 220);
    const vowelKey = midFreq > 523 ? 'Ee' : (midFreq < 131 ? 'Oo' : 'Aa');
    const vDef     = VOWEL_MAP[vowelKey];

    const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = vDef.q[0]; f1.frequency.value = vDef.f[0];
    const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.Q.value = vDef.q[1]; f2.frequency.value = vDef.f[1];
    const f3 = ctx.createBiquadFilter(); f3.type = 'bandpass'; f3.Q.value = vDef.q[2]; f3.frequency.value = vDef.f[2];

    const fgArr = [f1, f2, f3].map((f, i) => {
      const fg = ctx.createGain(); fg.gain.value = vDef.g[i];
      g1.connect(f); g2.connect(f); f.connect(fg);
      return fg;
    });
    const fMix = ctx.createGain(); fMix.gain.value = 0.88;
    fgArr.forEach(fg => fg.connect(fMix));

    const grit = ctx.createWaveShaper();
    grit.curve = getVocalGritCurve(); grit.oversample = '2x';
    fMix.connect(grit); grit.connect(g);

    // ── Phrase-level gain envelope — exponential (smoother than linear) ──
    const atk = Math.min(0.12, Math.max(0.03, totalDurSec * 0.08));
    const rel = Math.min(0.18, Math.max(0.05, totalDurSec * 0.12));

    g.gain.setValueAtTime(0.001, t0);
    g.gain.exponentialRampToValueAtTime(0.68, t0 + atk);
    g.gain.setValueAtTime(0.68, t_end - rel);
    g.gain.exponentialRampToValueAtTime(0.001, t_end + 0.06);

    // ── S-curve pitch automation between control points ───────────────────
    // Each segment uses getSCurveHz (3t²−2t³ in log-Hz space) instead of a
    // raw exponentialRamp — gives the slow-fast-slow vocal glide character.
    // hold points get a straight setValueAtTime anchor (no ramp needed).
    osc1.frequency.setValueAtTime(Math.max(20, pts[0].f), t0 + pts[0].tSec);
    osc2.frequency.setValueAtTime(Math.max(20, pts[0].f), t0 + pts[0].tSec);

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const tAbs = t0 + curr.tSec;
      const segDur = Math.max(0.001, curr.tSec - prev.tSec);

      if (curr.hold) {
        osc1.frequency.setValueAtTime(Math.max(20, curr.f), tAbs);
        osc2.frequency.setValueAtTime(Math.max(20, curr.f), tAbs);
        // Sustain hold
        osc1.frequency.setValueAtTime(Math.max(20, curr.f), tAbs + 0.15);
        osc2.frequency.setValueAtTime(Math.max(20, curr.f), tAbs + 0.15);
      } else {
        // S-curve glide — srutiSaHz approximated from first point frequency
        const refHz = pts[0].f;
        const scCurve = getSCurveHz(prev.f, curr.f, refHz, 96);
        osc1.frequency.setValueCurveAtTime(scCurve, t0 + prev.tSec, segDur);
        osc2.frequency.setValueCurveAtTime(scCurve, t0 + prev.tSec, segDur);
      }
    }

    // Anchor to last point at t_end to prevent drift
    const lastF = Math.max(20, pts[pts.length - 1].f);
    osc1.frequency.setValueAtTime(lastF, t_end);
    osc2.frequency.setValueAtTime(lastF, t_end);

    osc1.start(t0); osc2.start(t0);
    const stopT = t_end + 0.10;
    osc1.stop(stopT); osc2.stop(stopT);
    osc2.onended = () => {
      try { f1.disconnect(); f2.disconnect(); f3.disconnect();
            fgArr.forEach(fg => fg.disconnect());
            fMix.disconnect(); grit.disconnect(); g.disconnect(); } catch (_) {}
    };
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

  // ── NOTE: osc2 is now a same-pitch chorus partner (7¢ detune), NOT an
  //    octave doubler. All gamakam methods must drive osc2 at `base`, not
  //    `base * 2`. The detune.value on osc2 provides the chorus spread — the
  //    frequency automation here controls the fundamental pitch only.

  _kampita(osc1, osc2, base, t0, dur, p) {
    // FIX: default delay reduced from 80ms → 30ms so the oscillation is heard
    // immediately on short notes (the signature jiva swara kampita in Abhogi
    // on g2/m1 is 350ms; 80ms settle left only 1.35 cycles at 5Hz — inaudible)
    const delay   = (p.delayMs   ?? 30) / 1000;
    const rateHz  = p.rateHz     ?? 5;
    const depthHz = base * _centsToRatio(p.depthCents ?? 50) - base; // Hz swing above base
    const tStart  = t0 + delay;
    const tEnd    = t0 + dur;

    // Anchor at base during the settle window
    osc1.frequency.setValueAtTime(base, t0);
    osc2.frequency.setValueAtTime(base, t0);

    // Build a high-resolution sine curve — 120 control points per second
    // gives smooth oscillation with no audible corners at the peaks/troughs
    const curveDur = Math.max(0, tEnd - tStart);
    if (curveDur <= 0) return;

    const sampleRate = 120;
    const curveLen   = Math.max(2, Math.ceil(curveDur * sampleRate));
    const curve      = new Float32Array(curveLen);

    for (let i = 0; i < curveLen; i++) {
      const phase = (i / sampleRate) * rateHz * 2 * Math.PI;
      // FIX: taper in over 20ms (was 40ms) — matches how singers attack jiva swaras
      const taper = Math.min(1, i / (sampleRate * 0.02));
      curve[i] = Math.max(20, base + depthHz * Math.sin(phase) * taper);
    }

    osc1.frequency.setValueCurveAtTime(curve, tStart, curveDur);
    osc2.frequency.setValueCurveAtTime(curve, tStart, curveDur);

    // Land cleanly on base after the kampita window
    osc1.frequency.setValueAtTime(base, tEnd);
    osc2.frequency.setValueAtTime(base, tEnd);
  }

  _meendUp(osc1, osc2, base, t0, p) {
    const fromFreq = base * _centsToRatio(p.fromOffsetCents ?? -100);
    const slideDur = (p.durationMs ?? 130) / 1000;
    osc1.frequency.setValueAtTime(fromFreq, t0);
    osc1.frequency.exponentialRampToValueAtTime(base, t0 + slideDur);
    osc1.frequency.setValueAtTime(base, t0 + slideDur);
    osc2.frequency.setValueAtTime(fromFreq, t0);
    osc2.frequency.exponentialRampToValueAtTime(base, t0 + slideDur);
    osc2.frequency.setValueAtTime(base, t0 + slideDur);
  }

  _meendDown(osc1, osc2, base, t0, dur, p) {
    const toFreq     = base * _centsToRatio(p.toOffsetCents ?? -80);
    const slideDur   = (p.durationMs ?? 110) / 1000;
    const slideStart = t0 + dur - slideDur;
    osc1.frequency.setValueAtTime(base,    t0);
    osc2.frequency.setValueAtTime(base,    t0);
    osc1.frequency.setValueAtTime(base,    slideStart);
    osc1.frequency.exponentialRampToValueAtTime(toFreq, t0 + dur);
    osc2.frequency.setValueAtTime(base,    slideStart);
    osc2.frequency.exponentialRampToValueAtTime(toFreq, t0 + dur);
  }

  _sphurita(osc1, osc2, base, t0, p) {
    const upper = base * _centsToRatio(p.aboveCents ?? 100);
    const dur   = (p.durationMs ?? 65) / 1000;
    osc1.frequency.setValueAtTime(upper, t0);
    osc1.frequency.exponentialRampToValueAtTime(base, t0 + dur);
    osc2.frequency.setValueAtTime(upper, t0);
    osc2.frequency.exponentialRampToValueAtTime(base, t0 + dur);
  }

  _andola(osc1, osc2, base, t0, dur, p) {
    const delay   = (p.delayMs   ?? 0) / 1000;
    const rateHz  = p.rateHz     ?? 2.5;
    const depthHz = base * _centsToRatio(p.depthCents ?? 120) - base;
    const tStart  = t0 + delay;
    const tEnd    = t0 + dur;

    osc1.frequency.setValueAtTime(base, t0);
    osc2.frequency.setValueAtTime(base, t0);

    const curveDur = Math.max(0, tEnd - tStart);
    if (curveDur <= 0) return;

    // Andola (wide, slow sway) — same sine approach, but depth tapers in over 80ms
    const sampleRate = 120;
    const curveLen   = Math.max(2, Math.ceil(curveDur * sampleRate));
    const curve      = new Float32Array(curveLen);

    for (let i = 0; i < curveLen; i++) {
      const phase = (i / sampleRate) * rateHz * 2 * Math.PI;
      const taper = Math.min(1, i / (sampleRate * 0.08)); // 80ms taper-in
      curve[i] = Math.max(20, base + depthHz * Math.sin(phase) * taper);
    }

    osc1.frequency.setValueCurveAtTime(curve, tStart, curveDur);
    osc2.frequency.setValueCurveAtTime(curve, tStart, curveDur);

    osc1.frequency.setValueAtTime(base, tEnd);
    osc2.frequency.setValueAtTime(base, tEnd);
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

    //dynamicInfo.innerHTML = `<b>${item.label}</b>`;

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

/* ══════════════════════════════════════════════════════════════════════════
 *  PHRASE NOTATION ENGINE
 *
 *  A compact text notation encodes Carnatic phrases including duration,
 *  grouping, and gamakam — then renders them as discrete notes (same
 *  playPiano timbre as the rest of the app) with in-note pitch automation.
 *
 *  ── DURATION NOTATION ────────────────────────────────────────────────────
 *  MATRA = base time unit (default 0.35s at alapana pace).
 *  Each token occupies note_duration + 1-matra silence after it, EXCEPT
 *  inside groups where there is no inter-note silence.
 *
 *    s        plain swaram — 1 matra note, then 1 matra silence
 *    s,,      sustained   — (1 + N commas) matras note, then 1 matra silence
 *    (s r g)  normal group — each 1 matra, NO gaps within, 1 matra after
 *    {s r g}  fast group   — each 0.5 matra, NO gaps within, 1 matra after
 *    |s r g|  glide group  — smooth pitch glide across all notes, 1 matra total
 *
 *  ── GAMAKAM SUFFIXES ─────────────────────────────────────────────────────
 *  Appended directly to the swaram letter (before commas):
 *
 *    s~   kampita  — oscillate ±50c at 5Hz after 80ms settle
 *    s^   nokku    — quick grace from +80c above, falls to pitch in 60ms
 *    s_   meend_in — approach from 100c below, glide up to pitch over 120ms
 *    s`   meend_out— pitch falls 80c in last 120ms of note
 *
 * ══════════════════════════════════════════════════════════════════════════ */

// All phrase data comes from ragams.swaras in the DB — nothing hardcoded here.

// Swaram → cents from Sa
// Full swara→cents map covering all 12 swara variants (12-ET approximation).
// Single letters r/g/d/n default to the most common variants (R1/G3/D1/N3)
// which matches Mela 15 (Saveri's parent). All other ragams use explicit
// two-character tokens: r2, g2, m2, d2, n2 etc. in their notation strings.
const SWARA_CENTS = {
  s:  0,                          // Shadja
  r:  90,  r1:  90,  r2: 200,     // Rishabha  (R1=suddha, R2=chatusruti)
  g:  300, g1: 100,  g2: 300, g3: 400,  // Gandhara  (G2=sadharana, G3=antara)
  m:  500, m1: 500,  m2: 600,     // Madhyama  (M1=suddha, M2=prati)
  p:  700,                        // Panchama
  d:  800, d1: 800,  d2: 900,     // Dhaivata  (D1=suddha, D2=chatusruti)
  n:  1100,n1: 900,  n2:1000, n3:1100,  // Nishada   (N2=kaisika, N3=kakali)
  S:  1200,                       // Upper Shadja
};

/* ── parsePhrase ────────────────────────────────────────────────────────────
 *  Turns a notation string into an ordered array of note events.
 *  Each event: { cents, noteDur, gap, gamakam }
 *  noteDur is in seconds; gap is the inter-note breath in seconds.
 *
 *  FIX: The original used gap = matra (0.35s) after every note, making
 *  phrases sound choppy — each note was half note, half silence. Real
 *  Carnatic singing is legato; inter-note silence is 20ms (a glottal breath),
 *  not a full matra. Phrase-boundary gaps are added by the caller (GAP_SEC).
 *
 *  New gap policy:
 *    plain note      → 20ms inter-note breath
 *    sustained note  → 40ms after the sustained portion (already long enough)
 *    group ( )       → 0ms within, 20ms after last note
 *    fast group { }  → 0ms within, 20ms after last note
 *    glide group | | → 20ms after
 */
function parsePhrase(notation, matra) {
  const events = [];
  const str = notation.trim();
  let i = 0;

  while (i < str.length) {
    if (str[i] === ' ') { i++; continue; }

    // ── Normal group (s r g) ───────────────────────────────────────────────
    if (str[i] === '(') {
      const end = str.indexOf(')', i);
      const inner = str.slice(i + 1, end).trim().split(/\s+/);
      const notes = inner.map(tok => parseSwaramToken(tok));
      for (let j = 0; j < notes.length; j++) {
        events.push({ ...notes[j], noteDur: matra, gap: j === notes.length - 1 ? 0.020 : 0 });
      }
      i = end + 1;
      continue;
    }

    // ── Fast group {s r g} ─────────────────────────────────────────────────
    if (str[i] === '{') {
      const end = str.indexOf('}', i);
      const inner = str.slice(i + 1, end).trim().split(/\s+/);
      const notes = inner.map(tok => parseSwaramToken(tok));
      for (let j = 0; j < notes.length; j++) {
        events.push({ ...notes[j], noteDur: matra * 0.5, gap: j === notes.length - 1 ? 0.020 : 0 });
      }
      i = end + 1;
      continue;
    }

    // ── Glide group |s r g| ────────────────────────────────────────────────
    if (str[i] === '|') {
      const end = str.indexOf('|', i + 1);
      const inner = str.slice(i + 1, end).trim().split(/\s+/);
      const notes = inner.map(tok => parseSwaramToken(tok));
      events.push({ cents: notes.map(n => n.cents), gamakam: 'glide', noteDur: matra, gap: 0.020 });
      i = end + 1;
      continue;
    }

    // ── Plain swaram (possibly with gamakam suffix and commas) ────────────
    let j = i;
    while (j < str.length && str[j] !== ' ') j++;
    const raw = str.slice(i, j);
    i = j;

    let commas = 0;
    let token = raw;
    while (token.endsWith(',')) { commas++; token = token.slice(0, -1); }

    const note    = parseSwaramToken(token);
    const noteDur = matra * (1 + commas);
    // Sustained notes (nyasa swaras): 40ms breath; plain notes: 20ms
    const gap = commas > 0 ? 0.040 : 0.020;
    events.push({ ...note, noteDur, gap });
  }

  return events;
}

/* ── parseSwaramToken ────────────────────────────────────────────────────── */
function parseSwaramToken(token) {
  // Extract gamakam suffix: ~  ^  _  `
  let gamakam = 'none';
  let sw = token;

  // Check for suffix characters at the end
  const GAMAKAM_CHARS = { '~': 'kampita', '^': 'nokku', '_': 'meend_in', '`': 'meend_out' };
  for (const [ch, name] of Object.entries(GAMAKAM_CHARS)) {
    if (sw.endsWith(ch)) { gamakam = name; sw = sw.slice(0, -1); break; }
  }

  const cents = SWARA_CENTS[sw];
  if (cents === undefined) {
    console.warn('[phraseEngine] Unknown swaram token:', sw);
    return { cents: 0, gamakam: 'none' };
  }
  return { cents, gamakam };
}

/* ── Raga-aware kampita depth table ────────────────────────────────────────
 *  Kampita (oscillation) depth varies by swara AND by ragam character.
 *  A generic ±50 cents on every note sounds "stiff" — a real singer applies
 *  heavier oscillation on jiva swaras and near-flat on vadi/anchor notes.
 *
 *  Format: { ragamName: { centOffset: depthCents } }
 *  centOffset = cents mod 1200 (maps any octave to the same entry).
 *  Falls back to DEFAULT_KAMPITA_DEPTH (50¢) for unrecognised ragam/swara.
 *
 *  How to read Abhogi's entry:
 *    g2 (300¢) → 70¢ oscillation: heavy, signature jiva swara
 *    m1 (500¢) → 65¢: slightly lighter — vadi but still prominent
 *    r2 (200¢) → 15¢: nearly flat — passing/shadowed in Abhogi
 *    d2 (900¢) → 40¢: moderate — present but not as expressive as g2/m1
 *    s  (0¢)   → 20¢: anchor note — very slight, mostly plain
 */
const DEFAULT_KAMPITA_DEPTH = 50; // cents — fallback for unlisted ragam/swara

const RAGAM_KAMPITA_DEPTH = {
  'Abhogi':    { 0: 20, 200: 15, 300: 70, 500: 65, 900: 40 },
  'Bhairavi':  { 0: 20, 90: 55,  200: 25, 300: 65, 500: 55, 700: 20, 800: 60, 1000: 50 },
  'Kambhoji':  { 0: 20, 200: 30, 400: 60, 500: 55, 700: 20, 900: 50, 1100: 40 },
  'Kalyani':   { 0: 20, 200: 30, 400: 55, 600: 50, 700: 20, 900: 45, 1100: 60 },
  'Shankarabharanam': { 0: 20, 200: 35, 400: 55, 500: 50, 700: 20, 900: 45, 1100: 55 },
  'Todi':      { 0: 20, 90: 65,  200: 20, 300: 70, 500: 55, 700: 20, 800: 60, 1000: 50 },
  'Varali':    { 0: 20, 90: 60,  200: 20, 300: 70, 600: 55, 700: 20, 800: 65, 1000: 50 },
  'Natabhairavi': { 0: 20, 200: 30, 300: 65, 500: 55, 700: 20, 800: 60, 1000: 50 },
  'Kharaharapriya': { 0: 20, 200: 40, 300: 55, 500: 55, 700: 20, 900: 50, 1000: 60 },
  'Harikambhoji': { 0: 20, 200: 35, 400: 55, 500: 50, 700: 20, 900: 45, 1000: 50 },
};

/** Resolve kampita depth in cents for a given frequency within a ragam.
 *  srutiSaHz  — frequency of Sa at current sruti (used to recover cents offset)
 *  freq       — the note's frequency
 *  ragamName  — current ragam name (from currentJanyaRecord or ragamSelect)
 *  Returns depth in cents (integer). */
function _kampitaDepth(freq, srutiSaHz, ragamName) {
  const ragamEntry = RAGAM_KAMPITA_DEPTH[ragamName];
  if (!ragamEntry) return DEFAULT_KAMPITA_DEPTH;
  // Recover cents from Sa, reduce mod 1200 to get octave-independent swara offset
  const centsFromSa = Math.round(1200 * Math.log2(Math.max(20, freq) / Math.max(20, srutiSaHz)));
  const swaraCents  = ((centsFromSa % 1200) + 1200) % 1200; // always 0–1199
  // Find closest swara entry within ±30 cents (handles slight sruti variations)
  let best = null, bestDist = Infinity;
  for (const [key, depth] of Object.entries(ragamEntry)) {
    const dist = Math.abs(swaraCents - Number(key));
    if (dist < bestDist && dist <= 30) { bestDist = dist; best = depth; }
  }
  return best ?? DEFAULT_KAMPITA_DEPTH;
}

/* ── _buildVocalChain ──────────────────────────────────────────────────────
 *  Shared vocal signal chain used by playNote AND playGlide so both functions
 *  produce an identical timbre. The chain is:
 *    [osc1(saw,38%) + osc2(tri,62%)] × driftLFO(±4¢, 2.8Hz)
 *    → oscMix → warmthLP(LP 2800Hz Q=0.6) → presenceBP(BP 1200Hz Q=3)
 *    → fMix(0.85) → gain → masterGain
 *
 *  Why serial not parallel: parallel bandpass filters cause phase cancellation
 *  that thins the sound. A serial LP+BP chain mimics the vocal tract: the
 *  glottis generates harmonics, the pharynx rolls off highs, the oral cavity
 *  adds one presence peak. No WaveShaper grit — it adds harshness at these
 *  gain levels, not warmth.
 *
 *  Returns { osc1, osc2 } — caller sets frequency automation and start/stop.
 */
function _buildVocalChain(ctx, t0, t_end, peakGain) {
  const gain = ctx.createGain();
  gain.connect(masterGain);

  const osc1 = ctx.createOscillator();
  const osc2 = ctx.createOscillator();
  osc1.type = 'sawtooth'; // vocal cord buzz — rich in odd+even harmonics
  osc2.type = 'triangle'; // chest resonance — strong fundamental, few overtones

  const g1 = ctx.createGain(); g1.gain.value = 0.38; // less buzz
  const g2 = ctx.createGain(); g2.gain.value = 0.62; // more body
  osc1.connect(g1);
  osc2.connect(g2);

  // Breath drift LFO — ±4 cents at 2.8 Hz (subtle, not wobbly)
  const driftLfo  = ctx.createOscillator();
  const driftGain = ctx.createGain();
  driftLfo.type            = 'sine';
  driftLfo.frequency.value = 2.8 + (Math.random() - 0.5) * 0.4;
  driftGain.gain.value     = 4;
  driftLfo.connect(driftGain);
  driftGain.connect(osc1.detune);
  driftGain.connect(osc2.detune);
  driftLfo.start(t0);
  driftLfo.stop(t_end + 0.05);

  // Serial filter chain
  const oscMix = ctx.createGain(); oscMix.gain.value = 1.0;
  g1.connect(oscMix);
  g2.connect(oscMix);

  const warmthLP   = ctx.createBiquadFilter();
  warmthLP.type    = 'lowpass';
  warmthLP.Q.value = 0.6;

  const presenceBP   = ctx.createBiquadFilter();
  presenceBP.type    = 'bandpass';
  presenceBP.Q.value = 3;

  // Glottal sweep: 4% overshoot only, 50ms settle — sounds like throat
  // opening, not a filter zap. Both filters sweep together.
  const sweepEnd = t0 + 0.05;
  warmthLP.frequency.setValueAtTime(2800 * 1.04, t0);
  warmthLP.frequency.exponentialRampToValueAtTime(2800, sweepEnd);
  presenceBP.frequency.setValueAtTime(1200 * 1.04, t0);
  presenceBP.frequency.exponentialRampToValueAtTime(1200, sweepEnd);

  oscMix.connect(warmthLP);
  warmthLP.connect(presenceBP);

  const fMix = ctx.createGain(); fMix.gain.value = 0.85;
  presenceBP.connect(fMix);
  fMix.connect(gain);

  // Gain envelope
  const dur = t_end - t0;
  const atk = Math.min(0.030, Math.max(0.012, dur * 0.07));
  const releaseFloor = dur >= 0.45 ? 0.001 : 0.15;
  const rel = 0.020;

  gain.gain.setValueAtTime(0.001, t0);
  gain.gain.exponentialRampToValueAtTime(peakGain,     t0 + atk);
  gain.gain.setValueAtTime(peakGain * 0.90,            t_end - rel);
  gain.gain.exponentialRampToValueAtTime(releaseFloor, t_end);

  osc2.onended = () => {
    try {
      oscMix.disconnect(); warmthLP.disconnect(); presenceBP.disconnect();
      fMix.disconnect(); gain.disconnect();
    } catch (_) {}
  };

  return { osc1, osc2 };
}

function playNote(ctx, freq, dur, t0, gamakam, fromFreq = null, veenaMode = false, srutiSaHz = null, ragamName = null) {
  const t_end = t0 + dur;

  if (veenaMode) {
    // ── Veena pluck timbre — UNCHANGED ─────────────────────────────────────
    const gain   = ctx.createGain(); gain.connect(masterGain);
    const filter = ctx.createBiquadFilter(); filter.connect(gain);
    const osc1   = ctx.createOscillator();
    const osc2   = ctx.createOscillator();
    const g1 = ctx.createGain(); g1.gain.value = 0.60;
    const g2 = ctx.createGain(); g2.gain.value = 0.40;
    osc1.connect(g1).connect(filter);
    osc2.connect(g2).connect(filter);
    osc1.type = 'sawtooth'; osc2.type = 'triangle'; osc2.detune.value = 5;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, t0);
    filter.frequency.exponentialRampToValueAtTime(800, t0 + 0.2);
    gain.gain.setValueAtTime(0.001, t0);
    gain.gain.exponentialRampToValueAtTime(0.75,  t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.30,  t0 + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, t_end);
    const noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.02), ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = noiseBuffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.25, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.02);
    noise.connect(noiseGain).connect(gain);
    noise.start(t0);
    osc1.frequency.value = freq; osc2.frequency.value = freq;
    osc1.start(t0); osc2.start(t0);
    osc1.stop(t_end + 0.05); osc2.stop(t_end + 0.05);
    osc2.onended = () => { try { filter.disconnect(); gain.disconnect(); } catch (_) {} };
    return;
  }

  // ── Vocal branch — shared chain ───────────────────────────────────────────
  // ACOUSTIC BALANCE: Raised from 0.62/0.58 → 0.78/0.74 so phrase notes,
  // janya aro/ava, and raga lakshanam content sit clearly above the 14% tanpura.
  const peakGain = (gamakam === 'kampita' || gamakam === 'andola') ? 0.78 : 0.74;
  const { osc1, osc2 } = _buildVocalChain(ctx, t0, t_end, peakGain);

  // ── Frequency helpers — both oscs at same pitch (osc2 is chorus partner) ─
  const setF = (hz, t) => {
    osc1.frequency.setValueAtTime(Math.max(20, hz), t);
    osc2.frequency.setValueAtTime(Math.max(20, hz), t);
  };
  const expF = (hz, t) => {
    osc1.frequency.exponentialRampToValueAtTime(Math.max(20, hz), t);
    osc2.frequency.exponentialRampToValueAtTime(Math.max(20, hz), t);
  };

  // ── Per-gamakam pitch automation ─────────────────────────────────────────

  if (!gamakam || gamakam === 'none') {
    if (fromFreq && Math.abs(fromFreq - freq) > 1) {
      // Inter-note legato: S-curve glide from previous pitch, 22% of note dur
      const slideDur = Math.min(0.06, dur * 0.22);
      const scCurve  = getSCurveHz(fromFreq, freq, freq, 96);
      osc1.frequency.setValueCurveAtTime(scCurve, t0, slideDur);
      osc2.frequency.setValueCurveAtTime(scCurve, t0, slideDur);
      setF(freq, t0 + slideDur);
    } else {
      // First note: 0.8% upward scoop over 12ms — removes mechanical attack
      // without sounding like a detune artifact (was 1.5%/20ms — too obvious)
      const scoopStart = freq * 0.992;
      osc1.frequency.setValueAtTime(scoopStart, t0);
      osc2.frequency.setValueAtTime(scoopStart, t0);
      osc1.frequency.exponentialRampToValueAtTime(Math.max(20, freq), t0 + 0.012);
      osc2.frequency.exponentialRampToValueAtTime(Math.max(20, freq), t0 + 0.012);
    }

  } else if (gamakam === 'kampita') {
    // FIX: settle reduced from 80ms → 30ms so oscillation is heard immediately.
    // On a 350ms note at 5Hz: 80ms settle left only 1.35 cycles (barely audible);
    // 30ms settle leaves 1.6 cycles — the signature oscillation is clearly heard.
    const settle  = Math.min(0.030, dur * 0.08);
    const rateHz  = 5;
    // Raga-aware kampita depth: jiva swaras oscillate more heavily than
    // passing/anchor swaras. Falls back to 50¢ for unrecognised ragam.
    const _kdepth  = (srutiSaHz && ragamName)
      ? _kampitaDepth(freq, srutiSaHz, ragamName)
      : DEFAULT_KAMPITA_DEPTH;
    const depthHz  = freq * Math.pow(2, _kdepth / 1200) - freq;
    const tStart  = t0 + settle;

    setF(fromFreq ?? freq, t0);
    if (fromFreq && Math.abs(fromFreq - freq) > 1) expF(freq, tStart);
    else setF(freq, tStart);

    const curveDur = Math.max(0, t_end - tStart);
    if (curveDur > 0.01) {
      const sr  = 120;
      const len = Math.max(2, Math.ceil(curveDur * sr));
      const cur = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        // FIX: taper in over 20ms (was 40ms) — faster ramp-up matches how a
        // singer immediately applies oscillation on jiva swaras like g2 in Abhogi
        const taper = Math.min(1, i / (sr * 0.02));
        cur[i] = Math.max(20, freq + depthHz * Math.sin(i / sr * rateHz * 2 * Math.PI) * taper);
      }
      osc1.frequency.setValueCurveAtTime(cur, tStart, curveDur);
      osc2.frequency.setValueCurveAtTime(cur, tStart, curveDur);
    }
    setF(freq, t_end);

  } else if (gamakam === 'andola') {
    const rateHz  = 2.5;
    const depthHz = freq * Math.pow(2, 120 / 1200) - freq;
    setF(fromFreq ?? freq, t0);
    if (fromFreq && Math.abs(fromFreq - freq) > 1) expF(freq, t0 + 0.04);
    const curveDur = Math.max(0, dur);
    if (curveDur > 0.01) {
      const sr  = 120;
      const len = Math.max(2, Math.ceil(curveDur * sr));
      const cur = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        const taper = Math.min(1, i / (sr * 0.08));
        cur[i] = Math.max(20, freq + depthHz * Math.sin(i / sr * rateHz * 2 * Math.PI) * taper);
      }
      osc1.frequency.setValueCurveAtTime(cur, t0, curveDur);
      osc2.frequency.setValueCurveAtTime(cur, t0, curveDur);
    }
    setF(freq, t_end);

  } else if (gamakam === 'sphurita') {
    const upper = freq * Math.pow(2, 100 / 1200);
    setF(upper, t0);
    expF(freq,  t0 + 0.065);
    setF(freq,  t0 + 0.065);

  } else if (gamakam === 'nokku') {
    const above = freq * Math.pow(2, 80 / 1200);
    setF(above, t0);
    expF(freq,  t0 + 0.06);
    setF(freq,  t0 + 0.06);

  } else if (gamakam === 'meend_in') {
    // FIX: clamp slide to 30% of note dur — on short notes (0.28s) the old
    // fixed 130ms ate half the note; pitch never had time to settle
    const slideDur = Math.min(0.13, dur * 0.30);
    const below    = freq * Math.pow(2, -100 / 1200);
    setF(fromFreq ?? below, t0);
    expF(freq, t0 + slideDur);
    setF(freq, t0 + slideDur);

  } else if (gamakam === 'meend_out') {
    // FIX: clamp slide to 30% of note dur
    const slideDur   = Math.min(0.11, dur * 0.30);
    const toFreq     = freq * Math.pow(2, -80 / 1200);
    const slideStart = t_end - slideDur;
    setF(fromFreq ?? freq, t0);
    if (fromFreq && Math.abs(fromFreq - freq) > 1) expF(freq, t0 + 0.04);
    setF(freq,   slideStart);
    expF(toFreq, t_end);

  } else {
    setF(freq, t0);
  }

  osc1.start(t0); osc2.start(t0);
  osc1.stop(t_end + 0.02); osc2.stop(t_end + 0.02);
}

/* ── playGlide ──────────────────────────────────────────────────────────────
 *  Renders a smooth pitch glide across an array of cent values.
 *  cents[]   — cent offsets from Sa (e.g. [0, 700, 1200])
 *  srutiSaHz — frequency of Sa at the current sruti
 *  durSec    — total duration of the glide in seconds
 *  t0        — Web Audio start time
 *
 *  FIX: Now uses _buildVocalChain (same warmthLP→presenceBP serial chain as
 *  playNote) so glides and notes are timbrally identical. The old 3-formant +
 *  grit WaveShaper chain caused audible discontinuities when a glide followed
 *  a note — it sounded like a different instrument for that moment.
 */
function playGlide(ctx, cents, srutiSaHz, durSec, t0) {
  if (!cents || cents.length < 2 || durSec <= 0) return;

  const t_end = t0 + durSec;
  const { osc1, osc2 } = _buildVocalChain(ctx, t0, t_end, 0.60);

  // ── S-curve pitch automation between each control point ──────────────────
  const step = durSec / (cents.length - 1);
  let prevFreq = Math.max(20, srutiSaHz * Math.pow(2, cents[0] / 1200));
  osc1.frequency.setValueAtTime(prevFreq, t0);
  osc2.frequency.setValueAtTime(prevFreq, t0);

  for (let i = 1; i < cents.length; i++) {
    const nextFreq = Math.max(20, srutiSaHz * Math.pow(2, cents[i] / 1200));
    const segStart = t0 + (i - 1) * step;
    const segDur   = Math.max(0.001, step);
    const scCurve  = getSCurveHz(prevFreq, nextFreq, srutiSaHz, 96);
    osc1.frequency.setValueCurveAtTime(scCurve, segStart, segDur);
    osc2.frequency.setValueCurveAtTime(scCurve, segStart, segDur);
    prevFreq = nextFreq;
  }

  osc1.start(t0); osc2.start(t0);
  osc1.stop(t_end + 0.12); osc2.stop(t_end + 0.12);
}


/* ── playSignaturePhrases ────────────────────────────────────────────────────
 *
 *  ARCHITECTURE CHANGE (vs original)
 *  ──────────────────────────────────
 *  The edge function (get-gamakam, mode="phrases") now owns ALL musical
 *  intelligence:
 *    • role-based ordering  (foundation → identity → expansion → resolution)
 *    • register-aware MATRA (low=slow, high=faster)
 *    • nyasa sustain        (target note held 1.6× its base duration)
 *    • identity repetition  (identity-role phrases played twice)
 *    • inter-phrase glides  (smooth pitch bridge when register changes)
 *
 *  The edge function returns render_v2.sequenced_events — a flat, ordered
 *  array of play-ready events.  Each event is one of:
 *
 *    { type: "note",  cents, noteDur, gap, gamakam }
 *      — play a single note via playNote()
 *
 *    { type: "glide", cents: [c1,c2,...], noteDur, gap }
 *      — play a pitch glide via playGlide()
 *
 *    { type: "pause", dur }
 *      — silent gap (phrase boundary, inter-register breath)
 *
 *  app.js iterates this list and calls the appropriate primitive.
 *  No sequencing logic, no role/register/nyasa knowledge lives in the browser.
 *
 *  FORMAT B (legacy discrete phrases) is preserved as a fallback for ragams
 *  that have not yet been migrated to notation format in the DB.
 */
async function playSignaturePhrases(ragamId, srutiFactor, bpm, mySessionId) {
  if (!ragamId) return;
 
  // ── Fetch pre-sequenced events from edge function ─────────────────────────
  let efData;
  try {
    efData = await _fetchGamakamQueue('phrases', { ragamId });
  } catch (e) {
    console.error('[Gamakam] Phrase fetch failed:', e.message);
    return;
  }
 
  if (mySessionId !== playSessionId) return;
 
  // ── Audio context setup ───────────────────────────────────────────────────
  const ctx       = getAudioCtx();
  const srutiSaHz = _GAMAKAM_BASE_FREQS['s'] * srutiFactor;
 
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setValueAtTime(0.9, ctx.currentTime);
  }
 
  const ragamDisplayName = currentJanyaRecord?.name ?? 'Ragam';
  // For janya ragams: staticInfo already shows Ragam/Mela/Aro/Ava/disclaimer.
  // Do NOT write to dynamicInfo here — it would briefly flash "Characteristic
  // Phrases" over the info the user needs to read while listening.
  const _ragaTypeForBanner = document.querySelector("input[name=ragaType]:checked")?.value;
  if (_ragaTypeForBanner !== 'janya') {
    dynamicInfo.innerHTML = `<b>${ragamDisplayName} — Characteristic Phrases</b>`;
    await new Promise(r => setTimeout(r, 300));
  }
 
  let t = ctx.currentTime + 0.2;
 
  // ══════════════════════════════════════════════════════════════════════════
  //  PATH A — Pre-sequenced events from edge function (render_v2.sequenced_events)
  //
  //  The edge function returns a flat list of play-ready events that already
  //  encode all musical sequencing decisions (ordering, pacing, nyasa, glides).
  //  app.js is a pure playback consumer — no musical logic here.
  // ══════════════════════════════════════════════════════════════════════════
  if (efData.render_v2?.sequenced_events?.length > 0) {

    const events      = efData.render_v2.sequenced_events;

    // ── Gap clamping: DB rows generated before the edge-fn fix may have
    // inter-note gaps of 350ms (1 matra) within a phrase. Clamp any gap
    // that is larger than 25ms but smaller than a phrase boundary (150ms)
    // to 25ms so phrases play legato. Phrase-boundary pauses (≥ 150ms) and
    // the localGAP pauses (≥ 1s) are left untouched.
    const INTER_NOTE_MAX_GAP = 0.025;
    const PHRASE_MIN_GAP     = 0.150;
    for (const ev of events) {
      if ((ev.type === 'note' || ev.type === 'glide') &&
          (ev.gap ?? 0) > INTER_NOTE_MAX_GAP && (ev.gap ?? 0) < PHRASE_MIN_GAP) {
        ev.gap = INTER_NOTE_MAX_GAP;
      }
    }

    const ragaTypeNow = document.querySelector("input[name=ragaType]:checked")?.value;
    const isJanya     = (ragaTypeNow === 'janya');

    // prevFreq: carries the landing frequency of each note into the next
    // playNote() call so oscillators begin at the previous pitch (legato).
    // Cleared at phrase boundaries (pause events >= LEGATO_RESET_DUR) and
    // at every label event so each phrase has a clean defined attack.
    // Resolve current ragam name for raga-aware kampita depth
    const _currentRagamName = (() => {
      const rt = document.querySelector("input[name=ragaType]:checked")?.value;
      if (rt === 'janya') return currentJanyaRecord?.name ?? null;
      if (rt === 'sampoorna') return melakarta_dict[ragamSelect.value]?.[0] ?? null;
      if (rt === 'audava' || rt === 'shadava') return ragamSelect.value ?? null;
      return null;
    })();

    let prevFreq = null;
    const LEGATO_RESET_DUR = 0.15; // pauses shorter than this keep legato

    for (const ev of events) {
      if (!isPlaying || skipRequested || mySessionId !== playSessionId) break;

      // ── label: UI update only — no audio, no time advance, no sleep ──────────
      if (ev.type === 'label') {
        if (!isJanya) {
          dynamicInfo.innerHTML =
            `<b>${ragamDisplayName}</b>` +
            (ev.text ? ` — <span style="font-weight:normal;color:#555">${ev.text}</span>` : '');
        }
        prevFreq = null; // phrase boundary — reset legato
        continue;

      // ── note: schedule audio, advance t ────────────────────────────────────
      } else if (ev.type === 'note') {
        const freq    = Math.max(20, srutiSaHz * Math.pow(2, ev.cents / 1200));
        const gamakam = ev.gamakam ?? 'none';

        // fromFreq seeds the oscillator at the previous note's landing pitch,
        // giving legato continuity. playNote() falls back gracefully when null.
        playNote(ctx, freq, ev.noteDur, t, gamakam, prevFreq, false, srutiSaHz, _currentRagamName); // raga-aware
        t += ev.noteDur + (ev.gap ?? 0);

        // meend_out leaves pitch below the nominal — next note seeds from tail.
        prevFreq = (gamakam === 'meend_out')
          ? freq * Math.pow(2, -80 / 1200)
          : freq;

      // ── glide: schedule pitch sweep, advance t ──────────────────────────────
      } else if (ev.type === 'glide') {
        playGlide(ctx, ev.cents, srutiSaHz, ev.noteDur, t);
        t += ev.noteDur + (ev.gap ?? 0);
        // Seed legato from the glide's final pitch
        const lastC = Array.isArray(ev.cents) ? ev.cents[ev.cents.length - 1] : ev.cents;
        prevFreq = Math.max(20, srutiSaHz * Math.pow(2, lastC / 1200));

      // ── pause: phrase boundary — advance t, then yield ─────────────────────
      } else if (ev.type === 'pause') {
        if ((ev.dur ?? 0) >= LEGATO_RESET_DUR) prevFreq = null;
        t += ev.dur ?? 0;
        const sleepMs = Math.max(8, (t - ctx.currentTime) * 1000 - 200);
        await new Promise(r => setTimeout(r, sleepMs));
        const minT = getAudioCtx().currentTime + 0.05;
        if (t < minT) t = minT;
      }
    }

    const ragaTypeEnd = document.querySelector("input[name=ragaType]:checked")?.value;
    if (ragaTypeEnd !== 'janya') {
      dynamicInfo.innerHTML = `<b>${ragamDisplayName}</b>`;
    }
    return;
  }
 
  // ══════════════════════════════════════════════════════════════════════════
  //  PATH B — Legacy phrases[] (FORMAT A notation or FORMAT B discrete)
  //
  //  Preserved as a fallback for ragams not yet migrated.
  //  Behaviour is identical to the original app.js for these ragams.
  // ══════════════════════════════════════════════════════════════════════════
  // ✅ FIX
  const phrases = (efData.render_v2?.ordered_phrases?.length > 0)
    ? efData.render_v2.ordered_phrases
    : (efData.render_v2?.phrases?.length > 0)   // legacy v1 field name fallback
      ? efData.render_v2.phrases
      : efData.phrases;
 
  if (!phrases || phrases.length === 0) {
    dynamicInfo.innerHTML = '<i>No signature phrases stored for this ragam yet.</i>';
    return;
  }
 
  // Legacy engine for FORMAT B phrases
  const engine             = new GamakamEngine(ctx, masterGain);
  const allGamakamProfiles = efData.allGamakamProfiles ?? {};
  const oneBeat            = 60 / bpm;
  // FIX (Step C): 0.28s per matra 2248 70-75 BPM alapana pace.
  // 0.35s was "1st-speed varisai" pace 2014 too slow for raga lakshana phrases
  // which should feel like a moderate, natural vocal rendering.
  const MATRA              = 0.28;
  const GAP_SEC            = 1.2;
 
  for (const phrase of phrases) {
    if (!isPlaying || skipRequested || mySessionId !== playSessionId) break;
 
    const displayName = phrase.name || phrase.id || '';
    const ragaTypeNow = document.querySelector("input[name=ragaType]:checked")?.value;
    if (ragaTypeNow !== 'janya') {
      dynamicInfo.innerHTML =
        `<b>${ragamDisplayName}</b>` +
        (displayName ? ` — <span style="font-weight:normal;color:#555">${displayName}</span>` : '');
    }
 
    // ── FORMAT A: notation string ───────────────────────────────────────────
    if (typeof phrase.notation === 'string' && phrase.notation.trim().length > 0) {
 
      const events = parsePhrase(phrase.notation, MATRA);
 
      for (const ev of events) {
        if (!isPlaying || skipRequested || mySessionId !== playSessionId) break;
        if (ev.gamakam === 'glide') {
          playGlide(ctx, ev.cents, srutiSaHz, ev.noteDur, t);
        } else {
          const freq = Math.max(20, srutiSaHz * Math.pow(2, ev.cents / 1200));
          playNote(ctx, freq, ev.noteDur, t, ev.gamakam);
        }
        t += ev.noteDur + ev.gap;
      }
 
      t += GAP_SEC;
      const sleepMs = Math.max(8, (t - GAP_SEC - 0.2 - ctx.currentTime) * 1000);
      await new Promise(r => setTimeout(r, sleepMs));
 
    // ── FORMAT B: legacy discrete (swaras[] + gamakam[] + duration_beats[]) ─
    } else {
 
      const { swaras = [], gamakam = [], duration_beats = [] } = phrase;
      const gByIndex = {};
      for (const g of gamakam) gByIndex[g.swara_index] = g;
 
      for (let i = 0; i < swaras.length; i++) {
        const freq = _tokenToFreq(swaras[i], srutiFactor);
        const gDef = gByIndex[i];
        let profile = { type: 'none' };
        if (gDef) {
          const baseProfile = allGamakamProfiles[gDef.type] ?? {};
          const { swara_index: _drop, ...inlineParams } = gDef;
          profile = { ...baseProfile, ...inlineParams };
        }
        const raw    = oneBeat * (duration_beats[i] ?? 1);
        const durSec = (profile.type === 'kampita') ? Math.max(raw, oneBeat * 1.5)
                     : (profile.type === 'andola')  ? Math.max(raw, oneBeat * 1.6)
                     : raw;
        if (freq) engine.scheduleNote(freq, t, durSec, profile);
        t += durSec;
      }
      t += oneBeat * 2.0;
 
      const MIN_YIELD_MS = 8;
      const rawRemaining = (t - ctx.currentTime) * 1000 - MIN_YIELD_MS;
      await new Promise(r => setTimeout(r, Math.max(MIN_YIELD_MS, rawRemaining)));
    }
  }
 
  const ragaTypeEnd = document.querySelector("input[name=ragaType]:checked")?.value;
  if (ragaTypeEnd !== 'janya') {
    dynamicInfo.innerHTML = `<b>${ragamDisplayName}</b>`;
  }
}
 

