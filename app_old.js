
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
      loadVarisais(VARISAI_ALL);
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

/* INITIAL LOAD — all ragam data comes from Supabase via ragamInit() */
(async function initApp() {
  // Don't call loadSampoornaRagams() here — melakarta_dict is empty until ragamInit()
  // ragamInit() calls loadSampoornaRagams() after loading from Supabase
  loadVarisais(VARISAI_ALL);
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
function playPiano(freq, dur, startTime) {
  const ctx = getAudioCtx();

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

  osc1.stop(startTime + dur + 0.2);
  osc2.stop(startTime + dur + 0.2);
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
    varisaiSelect.value === "Alankaram"
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
    hardStopAllAudio();
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
   
  if (isPlaying) return;

  isPlaying = true;
  skipRequested = false;

  const bpm = +document.querySelector("input[name=speed]:checked").value;

  /* === SRUTI === */
  const srutiKey = document.getElementById("sruti").value;
  const srutiFactor = KATTAI_RATIOS[srutiKey];

  /* === RAGAM === */
  const ragaType =
  document.querySelector("input[name=ragaType]:checked").value;

  // Tambura only mode — start drone and exit before any pattern logic
  if (ragaType === "tambura") {
    await startTanpura(srutiFactor);
    staticInfo.innerHTML = `<b>Chosen Sruti: ${srutiKey}</b>`;
    dynamicInfo.innerHTML = 'Sing along to align with your Sruti,then choose the Ragam Type to begin';
    if (progressBar) progressBar.value = 0;
    isPlaying = false;
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

/* === JANYA RAGAM: ARO + AVA ONLY === */
if (ragaType === "janya") {

  // Build play queue manually
  playQueueGlobal = [
    {
      patternGroup: [aro],
      bpm: bpm,
      metronomeBpm: bpm,
      label: "Arohanam",
      pid: 1
    },
    {
      patternGroup: [ava],
      bpm: bpm,
      metronomeBpm: bpm,
      label: "Avarohanam",
      pid: 2
    }
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
    `<b>Avarohanam:</b> ${ava}`;
}

if (!skipVarisai) {
  /* === FETCH PLAY QUEUE FROM EDGE FUNCTION === */
  const sb = window.__appUser?.supabase;
  if (!sb) {
    console.error('[Patterns] Supabase not available');
    stopTanpura();
    isPlaying = false;
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

    if (!_sess?.access_token) {
      stopTanpura();
      isPlaying = false;
      window.location.href = 'index.html';
      return;
    }

    const efUrl = 'https://wcpbbvurfbraqqqlpsro.supabase.co/functions/v1/get-patterns';
    const ANON_KEY = SUPABASE_ANON;
    const efRes = await fetch(efUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_sess.access_token}`,
        'apikey':        ANON_KEY
      },
      body: JSON.stringify({
        varisai:  varisaiSelect.value,
        ragaType: ragaType,
        arohanam: aro || ''
      })
    });

    if (!efRes.ok) {
      const errText = await efRes.text();
      console.error('[Patterns] Edge Function HTTP error:', efRes.status, errText);
      stopTanpura();
      isPlaying = false;
      return;
    }

    efResponse = await efRes.json();
  } catch (err) {
    console.error('[Patterns] Edge Function fetch failed:', err);
    stopTanpura();
    isPlaying = false;
    return;
  }

  // ── 1st Speed Only filter ──────────────────────────────────────────────
  // If "1st Speed only" checkbox is checked, reduce each pid to a single
  // pass at 1× base BPM.
  //
  // Normal patterns have a 1× item in the queue — keep just that one.
  // Sarali patterns 10-14 only appear at 2× and 4× in the Edge Function
  // output (they always skip 1st speed normally). When "1st Speed only"
  // is checked, we take the lowest-multiplier item for that pid and
  // rewrite its bpm to 1 so it plays at the user's chosen base speed.
  const firstSpeedOnly = document.getElementById('firstSpeedOnly')?.checked;

  let rawQueue = efResponse.playQueue;

  if (firstSpeedOnly) {
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

  // Scale the BPM multipliers from the Edge Function (1/2/4) by the user's chosen base BPM
  playQueueGlobal = rawQueue.map(item => ({
    ...item,
    bpm:          item.bpm * bpm,
    metronomeBpm: item.metronomeBpm * bpm
  }));

  // If this is an Alankaram session, store the talam names for display
  if (varisaiSelect.value === 'Alankaram' && efResponse.alankaramMeta) {
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

  /* === PLAYBACK LOOP === */
  let lastPatternId = null;

  for (; currentQueueIndex < playQueueGlobal.length; currentQueueIndex++) {

  if (!isPlaying) break;

  // 🔁 HANDLE SKIP REQUESTS (single source of truth)
  //
  // IMPORTANT: When a skip is triggered mid-playback, hardStopAllAudio() causes
  // playPattern() to return "SKIP". The inner line loop then breaks, and the outer
  // for-loop executes its own currentQueueIndex++ BEFORE reaching this check again
  // via continue. So currentQueueIndex here is already 1 ahead of where playback
  // actually stopped. We correct with (currentQueueIndex - 1) as the played index.
if (skipRequested === "FORWARD") {
  skipRequested = false;
  const playedIndex = Math.max(0, currentQueueIndex - 1);
  const nextPidStart = findNextPatternIndex(playedIndex);
  currentQueueIndex = nextPidStart - 1; // -1 because for-loop continue will ++ again
  lastPatternId = null;
  continue;
}

if (skipRequested === "BACKWARD") {
  skipRequested = false;
  const playedIndex = Math.max(0, currentQueueIndex - 1);
  const currentStart = findPatternStartIndex(playedIndex);
  const target = (playedIndex - currentStart <= 1 && currentStart > 0)
    ? findPrevPatternIndex(currentStart)
    : currentStart;
  currentQueueIndex = target - 1; // -1 because for-loop continue will ++ again
  lastPatternId = null;
  continue;
}

  const item = playQueueGlobal[currentQueueIndex];

  if (!isPlaying) break;

    // Determine the talam for this item
    let newTalamKey = "adi";
    let title = `${item.label} (Pattern ${item.pid})`;
    if (varisaiSelect.value === "Alankaram") {
      const tala = (window._alankaramNamesLive || {})[item.pid];
      if (tala) {
        title =
          `<span style="font-size:14px;color:#555">${tala}</span><br>` +
          `<b>${item.label} (Pattern ${item.pid})</b>`;
      }
      newTalamKey = ALANKARAM_TALAM_MAP[item.pid] || "adi";
    }

    // Reset metronome whenever the pattern (pid) changes — this covers both
    // natural pattern-to-pattern transitions AND skip forward/backward.
    // Within a single pattern (1st/2nd/3rd speed + repeat) the beat flows on uninterrupted.
    const pidChanged = (item.pid !== lastPatternId);
    if (pidChanged) {
      currentTalamKey = newTalamKey;
      metronomeBeat = 0;
      metronomeBeatAccum = 0;
      if (isMetronomeEnabled()) buildBeatDots();
    }
    lastPatternId = item.pid;

    if (isMetronomeEnabled()) {
      const display = document.getElementById('metronomeBeatDisplay');
      if (display) display.style.display = 'inline-flex';
    }

    displayFullPattern(title, item.patternGroup);

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
          varisaiSelect.value === "Alankaram")
        ) {
          lineToPlay = resolveAudavaPattern(line, ragamNotes);
        }
        
        if (
          ragaType === "shadava" &&
          (varisaiSelect.value === "Alankaram")
        ) {
          lineToPlay = resolveAudavaPattern(line, ragamNotes);
        }

        const result = await playPattern(
            lineToPlay,
            item.bpm,
            ragamNotes,
            srutiFactor,
            false,
            item.metronomeBpm ?? item.bpm
        );

      if (result === "STOP") {
        stopTanpura();
        isPlaying = false;
        return;
      }

      if (result === "SKIP") {
        // let outer loop handle skip cleanly
        break;
      }

    }
  }

  stopTanpura();
  isPlaying = false;
}

/***********************
 * METRONOME — TALAM-AWARE
 * Supports Adi talam (default) and all 7 Alankaram talams.
 *
 * Each talam definition:
 *   beats   – total beat count per cycle
 *   accents – array of length `beats`:
 *               "sam"   = beat 1 (loudest)
 *               "laghu" = laghu subdivision (medium)
 *               "wave"  = drutam/anudruta wave (medium-loud)
 *               "finger"= drutam finger tap (soft)
 *   label   – short display name
 ***********************/
const TALAM_DEFS = {
  // Adi talam: laghu(4) + drutam(2) + drutam(2)
  adi: {
    beats: 8,
    accents: ["laghu","laghu","laghu","laghu", "wave","finger", "wave","finger"],
    label: "Adi",
    groups: [[0,1,2,3],[4,5],[6,7]]
  },
  // 1. Chatushra Jaati Druva: laghu(4)+drutam(2)+laghu(4)+laghu(4) = 14
  druva: {
    beats: 14,
    accents: ["laghu","laghu","laghu","laghu", "wave","finger",
              "laghu","laghu","laghu","laghu", "laghu","laghu","laghu","laghu"],
    label: "Druva",
    groups: [[0,1,2,3],[4,5],[6,7,8,9],[10,11,12,13]]
  },
  // 2. Chatushra Jaati Matya: laghu(4)+drutam(2)+laghu(4) = 10
  matya: {
    beats: 10,
    accents: ["laghu","laghu","laghu","laghu", "wave","finger", "laghu","laghu","laghu","laghu"],
    label: "Matya",
    groups: [[0,1,2,3],[4,5],[6,7,8,9]]
  },
  // 3. Chatushra Jaati Rupaka: drutam(2)+laghu(4) = 6
  rupaka: {
    beats: 6,
    accents: ["wave","finger", "laghu","laghu","laghu","laghu"],
    label: "Rupaka",
    groups: [[0,1],[2,3,4,5]]
  },
  // 4. Mishra Jaati Jhampa: laghu(7)+anudruta(1)+drutam(2) = 10
  jhampa: {
    beats: 10,
    accents: ["laghu","laghu","laghu","laghu","laghu","laghu","laghu", "anudruta", "wave","finger"],
    label: "Jhampa",
    groups: [[0,1,2,3,4,5,6],[7],[8,9]]
  },
  // 5. Thrisra Jaati Triputa: laghu(3)+drutam(2)+drutam(2) = 7
  triputa: {
    beats: 7,
    accents: ["laghu","laghu","laghu", "wave","finger", "wave","finger"],
    label: "Triputa",
    groups: [[0,1,2],[3,4],[5,6]]
  },
  // 6. Khanda Jaati Ata: laghu(5)+laghu(5)+drutam(2)+drutam(2) = 14
  ata: {
    beats: 14,
    accents: ["laghu","laghu","laghu","laghu","laghu",
              "laghu","laghu","laghu","laghu","laghu",
              "wave","finger", "wave","finger"],
    label: "Ata",
    groups: [[0,1,2,3,4],[5,6,7,8,9],[10,11],[12,13]]
  },
  // 7. Chatushra Jaati Eka: laghu(4) = 4
  eka: {
    beats: 4,
    accents: ["laghu","laghu","laghu","laghu"],
    label: "Eka",
    groups: [[0,1,2,3]]
  }
};

// Map alankaram pattern index → talam key
const ALANKARAM_TALAM_MAP = {
  1: "druva", 2: "matya", 3: "rupaka",
  4: "jhampa", 5: "triputa", 6: "ata", 7: "eka"
};

let metronomeBeat = 0;      // current beat index within the talam cycle
let metronomeBeatAccum = 0; // note-beats elapsed since last metronome tick
let currentTalamKey = null; // null forces rebuild on first item

function scheduleMetronomeClick(ctx, t, beatIndex) {
  const talam = TALAM_DEFS[currentTalamKey] || TALAM_DEFS.adi;
  const accent = talam.accents[beatIndex % talam.beats] || "laghu";

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(masterGain || ctx.destination);

  if (beatIndex % talam.beats === 0) {
    osc.frequency.value = 1200;
    gain.gain.setValueAtTime(0.55, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
  } else if (accent === "wave") {
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0.32, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  } else if (accent === "laghu") {
    osc.frequency.value = 700;
    gain.gain.setValueAtTime(0.20, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  } else { // finger
    osc.frequency.value = 600;
    gain.gain.setValueAtTime(0.13, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
  }

  osc.start(t);
  osc.stop(t + 0.07);

  const delay = Math.max(0, (t - ctx.currentTime) * 1000);
  setTimeout(() => updateBeatDisplay(beatIndex), delay);
}

function buildBeatDots() {
  const display = document.getElementById('metronomeBeatDisplay');
  if (!display) return;
  const talam = TALAM_DEFS[currentTalamKey] || TALAM_DEFS.adi;
  display.innerHTML = "";
  talam.groups.forEach((group, gi) => {
    group.forEach((bi) => {
      const dot = document.createElement('span');
      dot.className = 'beat-dot' + (bi === 0 ? ' sam' : '');
      dot.id = 'mbd' + bi;
      dot.title = talam.accents[bi];
      display.appendChild(dot);
    });
    // spacer between groups
    if (gi < talam.groups.length - 1) {
      const sp = document.createElement('span');
      sp.style.cssText = 'width:5px;display:inline-block';
      display.appendChild(sp);
    }
  });
}

function updateBeatDisplay(beatIndex) {
  const talam = TALAM_DEFS[currentTalamKey] || TALAM_DEFS.adi;
  for (let i = 0; i < talam.beats; i++) {
    const dot = document.getElementById('mbd' + i);
    if (dot) dot.classList.remove(
      'lit-laghu', 'lit-wave', 'lit-finger', 'lit-anudruta'
    );
  }
  const idx = beatIndex % talam.beats;
  const dot = document.getElementById('mbd' + idx);
  if (dot) {
    const accent = talam.accents[idx] || 'laghu';
    if (accent === 'wave') {
      dot.classList.add('lit-wave');
    } else if (accent === 'finger') {
      dot.classList.add('lit-finger');
    } else if (accent === 'anudruta') {
      dot.classList.add('lit-anudruta');
    } else {
      // sam and laghu both get red
      dot.classList.add('lit-laghu');
    }
  }
}

function resetBeatDisplay() {
  const talam = TALAM_DEFS[currentTalamKey] || TALAM_DEFS.adi;
  for (let i = 0; i < talam.beats; i++) {
    const dot = document.getElementById('mbd' + i);
    if (dot) dot.classList.remove('lit-laghu','lit-wave','lit-finger','lit-anudruta');
  }
}

function isMetronomeEnabled() {
  if (!document.getElementById('metronomeOn')?.checked) return false;
  // No metronome for janya ragam (plays aro/ava only, not a fixed pattern)
  const ragaType = document.querySelector('input[name=ragaType]:checked')?.value;
  if (ragaType === 'janya') return false;
  return true;
}

function isAlankaramSelected() {
  return document.getElementById('varisai')?.value === 'Alankaram';
}

// Show/hide beat dots when checkbox changes
document.addEventListener('DOMContentLoaded', () => {
  const cb = document.getElementById('metronomeOn');
  const display = document.getElementById('metronomeBeatDisplay');
  if (cb && display) {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        buildBeatDots();
        display.style.display = 'inline-flex';
      } else {
        display.style.display = 'none';
        resetBeatDisplay();
      }
    });
  }
  // Build default Adi talam dots on load
  currentTalamKey = "adi";
  buildBeatDots();
});


async function playPattern(pattern, bpm, ragamNotes, srutiFactor, isOwnNotes, metronomeBpm) {

  const ctx = getAudioCtx();
  const baseBeatDur = 60 / bpm;
  // How many note-beats fit in one talam beat (1 at 1st speed, 2 at 2nd, 4 at 3rd)
  const beatsPerTick = Math.max(1, Math.round(bpm / (metronomeBpm ?? bpm)));

  if (!isPlaying) return "STOP";

  const seq = parsePattern(pattern);

  let t = ctx.currentTime + 0.02;

  for (const ev of seq) {

    if (!isPlaying) return "STOP";
    if (skipRequested) return "SKIP";

    // =========================
    // NORMAL NOTE
    // =========================
    if (ev.type === "normal") {

  const dur = baseBeatDur * ev.beats;

  // Schedule metronome clicks: one click fires every beatsPerTick note-beats
  if (isMetronomeEnabled()) {
    const talamBeats = (TALAM_DEFS[currentTalamKey] || TALAM_DEFS.adi).beats;
    for (let b = 0; b < ev.beats; b++) {
      if (metronomeBeatAccum % beatsPerTick === 0) {
        scheduleMetronomeClick(ctx, t + b * baseBeatDur, metronomeBeat % talamBeats);
        metronomeBeat++;
      }
      metronomeBeatAccum++;
    }
  }

  if (!isOwnNotes) {

    const freq = resolveFrequency(
      ev.note,
      ragamNotes,
      srutiFactor,
      false
    );

    if (freq) {
      if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
      playPiano(freq, dur, t);
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
      playPiano(freq, dur, t);
    }
  }

  // 🔥 THIS WAS MISSING
  t += dur;
  await new Promise(r => setTimeout(r, dur * 1000));
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

        const beatDur = 60 / effectiveBpm;

        // Schedule one metronome click at the start of the group (counts as 1 beat)
        if (isMetronomeEnabled()) {
          const talamBeats = (TALAM_DEFS[currentTalamKey] || TALAM_DEFS.adi).beats;
          if (metronomeBeatAccum % beatsPerTick === 0) {
            scheduleMetronomeClick(ctx, t, metronomeBeat % talamBeats);
            metronomeBeat++;
          }
          metronomeBeatAccum++;
        }

        for (const sub of ev.subEvents) {
          const dur = beatDur * sub.beats;

          const freq = resolveFrequency(
            sub.note,
            ragamNotes,
            srutiFactor,
            isOwnNotes
          );

          if (freq) {
            if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
            playPiano(freq, dur, t);
          }

          t += dur;
          await new Promise(r => setTimeout(r, dur * 1000));
          playedNotes += sub.beats;
        }

      }
      // 🟢 OWN NOTES GAMAKA MODE
      else {

        const totalBeats = ev.subEvents
          .reduce((s, sub) => s + sub.beats, 0);

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

  freq = resolveFrequency(
    parts[0],
    ragamNotes,
    srutiFactor,
    true
  );

  glideToFreq = resolveFrequency(
    parts[1],
    ragamNotes,
    srutiFactor,
    true
  );

} else {

  freq = resolveFrequency(
    cleanNote,
    ragamNotes,
    srutiFactor,
    true
  );
}

if (freq) {
            if (typeof scoringOnNote === 'function') scoringOnNote(freq, dur * 1000);
            playPiano(freq, dur, t);
          }

          t += dur;
          await new Promise(r => setTimeout(r, dur * 1000));
          playedNotes += sub.beats;
        }  // <-- closes sub loop

      }  // <-- closes OWN NOTES else block

    }  // <-- closes GROUP else

    if (progressBar) progressBar.value = (playedNotes / totalNotes) * 100;
  }

  return "DONE";
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
async function fetchJanyaRecord(id) {
  const sb = window.__appUser?.supabase;
  if (!sb) return null;

  const { data, error } = await sb
    .from('ragams')
    .select('name, arohanam, avarohanam, melakarta')
    .eq('id', id)
    .single();

  if (error) { console.error('[Janya] Fetch error:', error.message); return null; }
  return data;
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
