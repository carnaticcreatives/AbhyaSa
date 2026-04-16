/* ==========================================================================
   CARNATIC PRACTICE -- CLIENT-SIDE PITCH CAPTURE
   --------------------------------------------------------------------------
   Handles mic access, YIN pitch detection, and raw frame collection.
   Scoring logic runs server-side in the score-session Edge Function.
   ========================================================================== */

'use strict';

/* -- Detection constants (no scoring thresholds here) --------------------- */
const SC_MIC_SENSITIVITY_ON  = 0.012;  // RMS must rise above this to enter voiced state
const SC_MIC_SENSITIVITY_OFF = 0.003;  // RMS must drop below this to exit voiced state
const SC_SILENCE_THRESHOLD   = 0.001;  // RMS below this = true silence (not tanpura bleed)
const SC_STABLE_MIN_FRAMES   = 3;
const SC_STABLE_CENTS_WINDOW = 80;
const SC_MAX_SESSIONS        = 10;
// -- Minimum note duration for reliable YIN pitch capture ------------------
// At 80 BPM base, 1st speed note = 750ms, 2nd speed = 375ms, 3rd = 187ms.
// YIN needs ~46ms (2048 samples at 44100 Hz) to converge, but also needs
// the buffer to represent a STABLE note -- not a transition. Below ~250ms
// the note duration is too short for reliable detection at 3rd speed.
// We track the current note's scheduled duration and skip scoring frames
// when the note is too short to be reliably captured.
const SC_MIN_SCOREABLE_NOTE_MS = 250;  // don't score frames from notes shorter than this

/* ==========================================================================
   STATE
   ========================================================================== */
const SC = {
  active:          false,
  sessionStart:    null,
  sessionEnd:      null,

  audioCtx:        null,
  analyser:        null,
  micStream:       null,
  pitchInterval:   null,

  pitchFrames:     [],   // [{t, f, e, s}] -- sent to server
  voicedFrames:    0,
  totalFrames:     0,

  ragamsSung:      new Set(),
  currentRagam:    null,
  currentExpFreq:  null,

  micIndicatorEl:  null,

  _freqBuf:           [],
  _stableCount:       0,
  _silenceStart:      null,
  _totalSilenceMs:    0,
  _srutiFactor:       1,
  _wasVoiced:         false,
  _lastKnownExpFreq:  null,
  _firstVoicedTime:   null,
  _lastVoicedTime:    null,
  _currentNoteDurMs:  null,
};


/* ==========================================================================
   PUBLIC API
   ========================================================================== */

function scoringInit() {
  injectScoringUI();
  SC.micIndicatorEl = document.getElementById('sc-mic-dot');
  updateScorePanelVisibility();
}

function scoringOnPlayStart(ragamName, srutiFactor) {
  SC.currentRagam   = ragamName;
  SC.currentExpFreq = null;
  if (ragamName) SC.ragamsSung.add(ragamName);
  if (!SC.active) startSession(srutiFactor);
}

function scoringOnPlayStop() {
  SC.currentRagam   = null;
  SC.currentExpFreq = null;
}

function scoringOnNote(freq, noteDurMs) {
  // Reset the stability buffer on every note change.
  // Without this, the buffer can hold readings from the previous note
  // during the first 3 frames of the new note — adjacent swaras can
  // be within 80¢ of each other (e.g. Ri1-Ga1 = 100¢), so the gate
  // passes a mixed-note median that is wrong for both notes.
  SC._freqBuf     = [];
  SC._stableCount = 0;
  SC.currentExpFreq = freq || null;
  SC._currentNoteDurMs = (noteDurMs && noteDurMs > 0) ? noteDurMs : null;
}

async function scoringEndSession() {
  if (!SC.active) return;
  stopSession();

  const endBtn = document.getElementById('sc-end-btn');
  if (endBtn) { endBtn.disabled = true; endBtn.textContent = 'Saving...'; }

  showScoreLoading();

  try {
    const result = await submitSessionToServer();
    showScoreModal(result);
  } catch(e) {
    document.getElementById('sc-score-modal').classList.remove('show');
    showToast('Could not save session: ' + e.message);
    console.error('[Scoring] submitSessionToServer failed:', e);
  } finally {
    if (endBtn) { endBtn.disabled = false; endBtn.textContent = 'End Session'; }
  }
}

function scoringTrackRagam(ragamName) {
  if (!ragamName || !SC.active) return;
  SC.ragamsSung.add(ragamName);
  updateRagamCountDisplay();
}

/* ==========================================================================
   SESSION LIFECYCLE
   ========================================================================== */
async function startSession(srutiFactor) {
  SC.active              = true;
  SC.sessionStart        = new Date();
  SC.pitchFrames         = [];
  SC.voicedFrames        = 0;
  SC.totalFrames         = 0;
  SC._freqBuf            = [];
  SC._stableCount        = 0;
  SC._silenceStart       = null;
  SC._totalSilenceMs     = 0;
  SC._wasVoiced          = false;
  SC._lastKnownExpFreq   = null;
  SC._firstVoicedTime    = null;
  SC._lastVoicedTime     = null;
  SC._currentNoteDurMs   = null;
  SC.ragamsSung          = SC.currentRagam ? new Set([SC.currentRagam]) : new Set();

  await startMic(srutiFactor);
  updateScorePanelVisibility();
  showToast('Session started -- mic is listening');
}

function stopSession() {
  SC.active     = false;
  SC.sessionEnd = new Date();
  stopMic();
  updateScorePanelVisibility();
}

/* ==========================================================================
   SERVER SUBMISSION
   Sends raw pitch frames + session metadata to the Edge Function.
   The server computes all scores and writes to the DB.
   ========================================================================== */
async function submitSessionToServer() {
  const u = window.__appUser;
  if (!u?.supabase || !u?.id) throw new Error('Not authenticated');

  const { data: { session } } = await u.supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No active session token');

  const payload = {
    sessionStart:   SC.sessionStart.toISOString(),
    sessionEnd:     SC.sessionEnd.toISOString(),
    totalSilenceMs: SC._totalSilenceMs || 0,
    firstVoicedMs:  SC._firstVoicedTime || null,
    lastVoicedMs:   SC._lastVoicedTime  || null,
    ragamsSung:     [...SC.ragamsSung],
    srutiFactor:    SC._srutiFactor || 1,
    frames: SC.pitchFrames.map(fr => ({
      t: fr.t,
      f: fr.f > 0 ? Math.round(fr.f * 10) / 10 : 0,
      e: fr.e > 0 ? Math.round(fr.e * 10) / 10 : 0,
      s: fr.s ?? 1,
    })),
  };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/score-session`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'apikey':        SUPABASE_ANON,
      'Authorization': 'Bearer ' + session.access_token,
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Server error ${res.status}`);
  return json;
}

/* ==========================================================================
   MIC / YIN PITCH DETECTION
   ========================================================================== */
async function startMic(srutiFactor) {
  try {
    if (window.audioCtx && window.audioCtx.state !== 'closed') {
      SC.audioCtx = window.audioCtx;
    } else {
      SC.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (SC.audioCtx.state === 'suspended') await SC.audioCtx.resume();

    SC.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const src    = SC.audioCtx.createMediaStreamSource(SC.micStream);

    const hp    = SC.audioCtx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 180; hp.Q.value = 0.7;

    const lp    = SC.audioCtx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1200; lp.Q.value = 0.5;

    SC.analyser = SC.audioCtx.createAnalyser();
    SC.analyser.fftSize = 2048;
    // Audio chain: src -> highpass (180 Hz) -> lowpass (1200 Hz) -> analyser
    // No notch filters: notch filters on Sa/Pa distort the time-domain signal
    // that YIN's difference function relies on, causing ~10-15c systematic bias.
    // Tanpura bleed is handled by the RMS hysteresis gate and harmonic rejection.
    src.connect(hp);
    hp.connect(lp);
    lp.connect(SC.analyser);

    SC._srutiFactor  = srutiFactor;
    SC.pitchInterval = setInterval(scDetectPitch, 20);

    if (SC.micIndicatorEl) SC.micIndicatorEl.classList.add('active');
  } catch(e) {
    console.warn('[Scoring] Mic access failed:', e.message);
    showToast('Mic access denied -- pitch scoring disabled');
  }
}

function stopMic() {
  if (SC.pitchInterval) { clearInterval(SC.pitchInterval); SC.pitchInterval = null; }
  if (SC.micStream)     { SC.micStream.getTracks().forEach(t => t.stop()); SC.micStream = null; }
  SC.analyser = null;
  if (SC.micIndicatorEl) SC.micIndicatorEl.classList.remove('active');
}

function scDetectPitch() {
  if (!SC.analyser || !SC.active) return;
  try {
    if (SC.audioCtx.state === 'suspended') SC.audioCtx.resume();

    const buf = new Float32Array(SC.analyser.fftSize);
    SC.analyser.getFloatTimeDomainData(buf);

    /* RMS energy gate with hysteresis */
    let rms = 0;
    for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / buf.length);

    SC.totalFrames++;

    const isVoiced = SC._wasVoiced
      ? rms >= SC_MIC_SENSITIVITY_OFF
      : rms >= SC_MIC_SENSITIVITY_ON;

    SC._wasVoiced = isVoiced;

    if (!isVoiced) {
      if (rms < SC_SILENCE_THRESHOLD) {
        if (!SC._silenceStart) SC._silenceStart = Date.now();
      } else {
        if (SC._silenceStart) {
          SC._totalSilenceMs = (SC._totalSilenceMs || 0) + (Date.now() - SC._silenceStart);
          SC._silenceStart   = null;
        }
      }
      SC._freqBuf     = [];
      SC._stableCount = 0;
      // Unvoiced — duration tracked via _firstVoicedTime/_lastVoicedTime span,
      // not by counting f=0 frames. No push needed — keeps payload small.
      return;
    }

    // Track first and last voiced frame times (for duration calculation)
    const nowMs = Date.now();
    if (!SC._firstVoicedTime) SC._firstVoicedTime = nowMs;
    SC._lastVoicedTime = nowMs;

    if (SC._silenceStart) {
      SC._totalSilenceMs = (SC._totalSilenceMs || 0) + (nowMs - SC._silenceStart);
      SC._silenceStart   = null;
    }

    SC.voicedFrames++;

    const sampleRate = SC.audioCtx.sampleRate;
    const rawFreq    = scAutoCorrelate(buf, sampleRate);

    const sa       = (window.base_freqs?.['s'] || 130.8128) * (SC._srutiFactor || 1);
    const voiceLo  = sa * 0.85;
    // FIX: tightened from 6.0 to 3.85 -- tara n3 is ~sa*3.77.
    // sa*6.0 admitted 4th/5th tanpura harmonics which arrived as beyond-zero-cents noise.
    const voiceHi  = sa * 3.85;
    const inRange  = rawFreq > 0 && rawFreq >= voiceLo && rawFreq <= voiceHi;
    const validFreq = inRange ? rawFreq : 0;

    /* Harmonic bleed rejection (½x sub-octave and 3x-6x instrument harmonics).
       YIN integer-tau can lock onto the half-period (double the true period),
       producing a frequency half of the actual pitch. This is the most common
       vocal failure mode and must be rejected alongside high harmonics. */
    const isBleed = (() => {
      if (!inRange || !SC.currentExpFreq || SC.currentExpFreq <= 0) return false;
      const ratio = validFreq / SC.currentExpFreq;
      // Sub-octave: YIN locks at half the true frequency
      if (Math.abs(1200 * Math.log2(ratio / 0.5)) < 110) return true;
      // High harmonics: instrument / tanpura overtones
      for (let n = 3; n <= 6; n++) {
        if (Math.abs(1200 * Math.log2(ratio / n)) < 110) return true;
      }
      return false;
    })();

    const usableFreq = (validFreq > 0 && !isBleed) ? validFreq : 0;

    if (SC.currentExpFreq) SC._lastKnownExpFreq = SC.currentExpFreq;
    // Only use currentExpFreq — NOT _lastKnownExpFreq — as e for scoring.
    // Stale expected freqs from the previous note cause spurious >150¢ errors
    // on the server when the student is between notes or on a rest.
    // Frames with e=0 are discarded server-side as 'no-expected' (not penalised).
    const expForFrame = SC.currentExpFreq || 0;

    // --- Stability gate --------------------------------------------------
    // Only push to pitchFrames when stable AND there's a live expected freq.
    // Duration is tracked via _firstVoicedTime/_lastVoicedTime, not by
    // f=0 frame counting — so discarding unstable/unusable frames here is safe.
    // (The old 16k-frame payload was 94% f=0 noise; now we send only signal.)
    if (usableFreq <= 0) {
      SC._freqBuf     = [];
      SC._stableCount = 0;
      return;
    }

    SC._freqBuf.push(usableFreq);
    if (SC._freqBuf.length > SC_STABLE_MIN_FRAMES) SC._freqBuf.shift();

    const isStable = (() => {
      if (SC._freqBuf.length < SC_STABLE_MIN_FRAMES) return false;
      const sorted  = [...SC._freqBuf].sort((a, b) => a - b);
      const spanCts = 1200 * Math.log2(sorted[sorted.length - 1] / sorted[0]);
      return spanCts < SC_STABLE_CENTS_WINDOW;
    })();

    if (!isStable) {
      SC._stableCount = 0;
      return;
    }

    // Stable run -- use median frequency for pitch accuracy
    SC._stableCount++;
    const sorted2    = [...SC._freqBuf].sort((a, b) => a - b);
    const stableFreq = sorted2[Math.floor(sorted2.length / 2)];

    // Only push if there is a LIVE expected frequency. Frames with no
    // expected note (rests, gaps) would land in server 'no-expected' bucket
    // and contribute nothing — skip them to keep the payload lean.
    if (!expForFrame || expForFrame <= 0) return;

    const noteIsLongEnough = !SC._currentNoteDurMs
      || SC._currentNoteDurMs >= SC_MIN_SCOREABLE_NOTE_MS;

    SC.pitchFrames.push({
      t: nowMs,
      f: stableFreq,
      e: expForFrame,
      s: noteIsLongEnough ? 1 : 0,
    });

  } catch(e) { /* silently ignore frame errors */ }
}

function scAutoCorrelate(buffer, sampleRate) {
  // YIN pitch detection — integer-tau version (no parabolic interpolation).
  //
  // Parabolic interpolation sounds better in theory but in practice causes
  // larger errors when YIN minima are shallow or asymmetric — which happens
  // regularly with LP-filtered microphone input. The simple integer-tau
  // approach gives ≤5c quantisation error at all Carnatic note frequencies,
  // which is well within the 50c Gaussian sigma used for scoring.
  //
  // Threshold 0.18: stricter than 0.15. Rejects weak pitch candidates that
  // would pass at 0.15 but lock onto the wrong harmonic — the main source
  // of the systematic ~30-40c errors seen with the lower threshold.
  //
  // Upper cap 1200 Hz: tara sthayi n3 at 7 kattai is ~930 Hz, so 1200 Hz
  // gives generous headroom while excluding 3x-5x harmonics that 1600 Hz
  // admitted. (The voice range gate at sa*3.85 is a further safety net.)
  const threshold = 0.18;
  const yin = new Float32Array(buffer.length / 2);

  for (let tau = 1; tau < yin.length; tau++) {
    let sum = 0;
    for (let i = 0; i < yin.length; i++) {
      const d = buffer[i] - buffer[i + tau]; sum += d * d;
    }
    yin[tau] = sum;
  }

  // Cumulative mean normalised difference
  yin[0] = 1;
  let rs = 0;
  for (let tau = 1; tau < yin.length; tau++) {
    rs += yin[tau]; yin[tau] *= tau / rs;
  }

  // Find first dip below threshold, taking local minimum
  let tau = -1;
  for (let t = 2; t < yin.length; t++) {
    if (yin[t] < threshold) {
      while (t + 1 < yin.length && yin[t + 1] < yin[t]) t++;
      tau = t; break;
    }
  }
  if (tau === -1) return -1;

  // Integer-tau frequency — no parabolic interpolation
  const f = sampleRate / tau;
  // 70 Hz lower: covers mandra Sa at lowest kattai
  // 1200 Hz upper: covers tara n3 at highest kattai with headroom
  return (f > 1200 || f < 70) ? -1 : f;
}

/* ==========================================================================
   SCORE MODAL -- displays result returned by Edge Function
   ========================================================================== */

function showScoreLoading() {
  document.getElementById('sc-score-content').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;padding:14px 0">
      <svg width="18" height="18" viewBox="0 0 18 18"
           style="animation:sc-spin 1.1s linear infinite;flex-shrink:0">
        <circle cx="9" cy="9" r="7" fill="none" stroke="#d4c9a8" stroke-width="2.5"/>
        <path d="M9 2 A7 7 0 0 1 16 9" fill="none" stroke="#8b2e0f"
              stroke-width="2.5" stroke-linecap="round"/>
      </svg>
      <span style="color:#7a6e58;font-size:12.5px">Calculating practice feedback…</span>
    </div>
  `;
  document.getElementById('sc-score-modal').classList.add('show');
}

function singingLabel(score){
  if(score == null) return '—';
  if(score >= 70) return 'Excellent';
  if(score >= 50) return 'Good';
  return 'Keep practising';
}

function singingBand(score){
  if(score == null) return {label:'—', color:'#ccc'};

  if(score >= 70){
    return {label:'Excellent', color:'#1e7d34'};   // dark green
  }
  if(score >= 50){
    return {label:'Good', color:'#5fbf63'};        // light green
  }
  return {label:'Keep practising', color:'#a6e3a1'}; // lighter green
}

function showScoreModal(scores) {
  const sing = singingBand(scores.singingScore);

  const ragamList = scores.ragamsSung || [...SC.ragamsSung].join(', ') || '';

  let singingHtml;
  if (!scores.isReliable) {
    singingHtml = `
      <div class="sc-stat-row">
        <span class="sc-stat-label">Singing</span>
        <span class="sc-stat-value" style="color:#888;font-style:italic">
          Needs 3+ min of practice to score
        </span>
      </div>`;
  } else {
    singingHtml = `
      <div class="sc-stat-row">
        <span class="sc-stat-label">Singing</span>
        <span class="sc-stat-value sc-stat-badge" style="background:${sing.color}">
          ${sing.label}
        </span>
      </div>`;
  }

  const durMin  = scores.sessionMinutes ?? '—';
  const ragCnt  = scores.ragamCount ?? 0;

  document.getElementById('sc-score-content').innerHTML = `
    ${singingHtml}
    <div class="sc-stat-row">
      <span class="sc-stat-label">Duration</span>
      <span class="sc-stat-value">
        <strong>${durMin} min</strong>
        <span class="sc-stat-ideal"> · ideal 30 min</span>
      </span>
    </div>
    <div class="sc-stat-row">
      <span class="sc-stat-label">Variety</span>
      <span class="sc-stat-value">
        <strong>${ragCnt} ragam${ragCnt === 1 ? '' : 's'}</strong>
        <span class="sc-stat-ideal"> · ideal 4 ragams</span>
      </span>
    </div>
    ${ragamList ? `<div class="sc-stat-ragams">${ragamList}</div>` : ''}
  `;

  document.getElementById('sc-score-modal').classList.add('show');
}

/* ==========================================================================
   SCORE HISTORY
   ========================================================================== */
async function loadSessionHistory() {
  const u = window.__appUser;
  if (!u?.supabase) return [];
  const { data } = await u.supabase
    .from('practice_sessions')
    .select('*')
    .eq('user_id', u.id)
    .order('session_start', { ascending: false })
    .limit(SC_MAX_SESSIONS);
  return data || [];
}

async function showSessionHistory() {
  const sessions = await loadSessionHistory();
  const modal    = document.getElementById('sc-history-modal');
  const tbody    = document.getElementById('sc-history-body');
  if (!modal || !tbody) return;

  if (!sessions.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#888;padding:16px">No sessions recorded yet</td></tr>';
  } else {
    tbody.innerHTML = sessions.map(s => {
      const d   = new Date(s.session_start);
      const fmt = d.toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
      const tm  = d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });

      // Singing — verbal label with colour
      let singHtml;
      if (s.singing_score === null || s.singing_score === undefined) {
        singHtml = `<span style="color:#aaa;font-size:12px">N/A</span>`;
      } else {
        const b = singingBand(s.singing_score);
        singHtml = `<span style="color:${b.color};font-weight:600;font-size:12.5px">${b.label}</span>`;
      }

      // Duration — plain text
      const durMin  = s.session_minutes ?? '—';
      const durHtml = `<span style="font-size:12.5px">${durMin} min</span>`;

      // Variety — count
      const ragCnt  = s.ragams_sung ? s.ragams_sung.split(',').filter(Boolean).length : (s.ragam_score != null ? Math.round(s.ragam_score / 25) : '—');
      const ragHtml = `<span style="font-size:12.5px">${ragCnt} ragam${ragCnt === 1 ? '' : 's'}</span>`;

      return `<tr>
        <td>${fmt} ${tm}</td>
        <td>${singHtml}</td>
        <td>${durHtml}</td>
        <td>${ragHtml}</td>
        <td style="font-size:11px;color:#888">${s.ragams_sung || '—'}</td>
      </tr>`;
    }).join('');
  }
  modal.classList.add('show');
}

function scoreBar(val) {
  if (val === null || val === undefined) {
    return `<span style="color:#aaa;font-size:12px">N/A</span>`;
  }
  const col = val >= 75 ? '#2a8a3a' : val >= 50 ? '#c47a00' : '#b03020';
  return `<span style="display:inline-flex;align-items:center;gap:6px">
    <span style="display:inline-block;width:48px;height:7px;background:#eee;border-radius:4px;overflow:hidden">
      <span style="display:block;width:${val}%;height:100%;background:${col};border-radius:4px"></span>
    </span>${val}</span>`;
}

/* ==========================================================================
   UI INJECTION
   ========================================================================== */
function injectScoringUI() {
  const style = document.createElement('style');
  style.textContent = `
    #sc-panel {
      margin: 10px 0 4px; padding: 8px 12px;
      background: #f5f0e8; border: 1px solid #d4c9a8; border-radius: 3px;
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap; font-size: 13px;
    }
    #sc-panel.hidden { display: none; }
    #sc-mic-dot {
      width: 10px; height: 10px; border-radius: 50%;
      background: #ccc; flex-shrink: 0; transition: background 0.3s;
    }
    #sc-mic-dot.active { background: #c0392b; animation: sc-pulse 1s infinite; }
    @keyframes sc-pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
    #sc-ragam-count { color: #555; font-size: 12px; }
    #sc-end-btn {
      margin-left: auto; padding: 4px 12px;
      background: #8b2e0f; color: #fff;
      border: none; border-radius: 2px; font-size: 12px; cursor: pointer;
    }
    #sc-end-btn:hover { background: #6e2409; }
    #sc-history-btn {
      padding: 4px 10px; background: none; color: #8b2e0f;
      border: 1px solid #8b2e0f; border-radius: 2px; font-size: 12px; cursor: pointer;
    }
    #sc-history-btn:hover { background: #f0e8df; }
    .sc-modal-overlay {
      display: none; position: fixed; inset: 0;
      background: rgba(0,0,0,0.45); z-index: 9000;
      align-items: center; justify-content: center;
    }
    .sc-modal-overlay.show { display: flex; }
    .sc-modal {
      background: #fff; border-radius: 4px; padding: 28px 32px;
      max-width: 520px; width: 92%;
      box-shadow: 0 8px 40px rgba(0,0,0,0.25); position: relative;
    }
    .sc-modal h3 { margin: 0 0 18px; font-size: 17px; color: #2c2416; }
    .sc-score-row { display: flex; align-items: center; margin-bottom: 12px; gap: 10px; }
    .sc-score-label { flex: 0 0 130px; font-size: 13px; color: #555; }
    .sc-score-bar-wrap { flex: 1; background: #eee; border-radius: 4px; height: 10px; overflow: hidden; }
    .sc-score-bar { height: 100%; border-radius: 4px; transition: width 0.6s; }
    .sc-score-val { flex: 0 0 36px; text-align: right; font-size: 13px; font-weight: 600; }
    .sc-total-row {
      border-top: 1px solid #e8dfc8; margin-top: 16px; padding-top: 14px;
      display: flex; align-items: center; gap: 10px;
    }
    .sc-total-label { font-size: 15px; font-weight: 700; flex: 0 0 130px; }
    .sc-total-val   { font-size: 22px; font-weight: 700; color: #8b2e0f; margin-left: auto; }
    .sc-modal-close {
      position: absolute; top: 12px; right: 14px;
      background: none; border: none; font-size: 20px; cursor: pointer; color: #888;
    }
    .sc-meta { font-size: 11.5px; color: #888; margin-bottom: 16px; line-height: 1.6; }
    #sc-history-modal .sc-modal { max-width: 780px; }
    #sc-history-modal table { width: 100%; border-collapse: collapse; font-size: 12.5px; margin-top: 8px; }
    #sc-history-modal th {
      text-align: left; padding: 6px 8px; background: #f5f0e8;
      border-bottom: 1px solid #d4c9a8; font-size: 11px;
      text-transform: uppercase; letter-spacing: 0.05em; color: #7a6e58;
      position: sticky; top: 0; z-index: 1;
    }
    #sc-history-modal td { padding: 7px 8px; border-bottom: 1px solid #f0ead8; vertical-align: middle; }
    #sc-history-modal tr:last-child td { border-bottom: none; }
    #sc-toast {
      position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      background: #2c2416; color: #fff; padding: 8px 18px;
      border-radius: 20px; font-size: 13px; z-index: 9999;
      opacity: 0; transition: opacity 0.3s; pointer-events: none;
    }
    #sc-toast.show { opacity: 1; }
    .sc-stat-row {
      display: flex; align-items: center; padding: 10px 0;
      border-bottom: 1px solid #f0ead8; gap: 12px;
    }
    .sc-stat-row:last-of-type { border-bottom: none; }
    .sc-stat-label {
      flex: 0 0 80px; font-size: 12px; font-weight: 600; color: #7a6e58;
      text-transform: uppercase; letter-spacing: 0.07em;
    }
    .sc-stat-value { font-size: 14px; color: #2c2416; }
    .sc-stat-ideal { font-size: 12px; color: #aaa; }
    .sc-stat-badge {
      display: inline-block; padding: 3px 12px; border-radius: 20px;
      color: #fff; font-weight: 700; font-size: 13px;
    }
    .sc-stat-ragams {
      margin-top: 12px; font-size: 11.5px; color: #888; line-height: 1.6;
    }
    @keyframes sc-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);

  const displayDiv = document.getElementById('display');
  if (displayDiv) {
    const panel = document.createElement('div');
    panel.id = 'sc-panel';
    panel.className = 'hidden';
    panel.innerHTML = `
      <span id="sc-mic-dot"></span>
      <span id="sc-ragam-count">0 ragams</span>
      <button id="sc-history-btn" onclick="showSessionHistory()">History</button>
      <button id="sc-end-btn" onclick="scoringEndSession()">End Session</button>
    `;
    displayDiv.before(panel);
  }

  document.body.insertAdjacentHTML('beforeend', `
    <div class="sc-modal-overlay" id="sc-score-modal">
      <div class="sc-modal">
        <button class="sc-modal-close" onclick="document.getElementById('sc-score-modal').classList.remove('show')">✕</button>
        <h3>Session Complete</h3>
        <div id="sc-score-content"></div>
      </div>
    </div>

    <div class="sc-modal-overlay" id="sc-history-modal">
      <div class="sc-modal" style="overflow-x:auto">
        <button class="sc-modal-close" onclick="document.getElementById('sc-history-modal').classList.remove('show')">✕</button>
        <h3>Practice History (last ${SC_MAX_SESSIONS} sessions)</h3>
        <div style="overflow-y:auto; max-height:60vh">
        <table>
          <thead><tr>
            <th>Date &amp; Time</th>
            <th>Singing</th><th>Duration</th>
            <th>Variety</th><th>Ragams practiced</th>
          </tr></thead>
          <tbody id="sc-history-body"></tbody>
        </table>
        </div>
      </div>
    </div>

    <div id="sc-toast"></div>
  `);

  ['sc-score-modal','sc-history-modal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target.id === id) e.target.classList.remove('show');
    });
  });
}

function updateScorePanelVisibility() {
  const panel = document.getElementById('sc-panel');
  if (!panel) return;
  panel.classList.toggle('hidden', !SC.active);
}

function updateRagamCountDisplay() {
  const el = document.getElementById('sc-ragam-count');
  if (el) el.textContent = `${SC.ragamsSung.size} ragam${SC.ragamsSung.size !== 1 ? 's' : ''}`;
}

function showToast(msg, ms = 3000) {
  const el = document.getElementById('sc-toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), ms);
}
