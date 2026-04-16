  /***********************
 * DEFINITIONS SECTION *
 ***********************/

const base_freqs = {
  "s": 130.8128,
  "r1": 138.5913,
  "r2": 146.8324,
  "g1": 146.8324,
  "r3": 155.5635,
  "g2": 155.5635,
  "g3": 164.8138,
  "m1": 174.6141,
  "m2": 184.9972,
  "p": 195.9977,
  "d1": 207.6524,
  "d2": 220.0000,
  "n1": 220.0000,
  "d3": 233.0819,
  "n2": 233.0819,
  "n3": 246.9417
};

/***********************
 * CARNATIC SRUTI (KATTAI) RATIOS – JUST INTONATION
 ***********************/
const KATTAI_RATIOS = {
  "C":   1.0,        // 0 kattai
  "C#":  16/15,     // 1.5 kattai
  "D":   9/8,
  "D#":  6/5,
  "E":   5/4,
  "F":   4/3,
  "F#":  45/32,
  "G":   3/2,       // 3.5 kattai
  "G#":  8/5,       // 5.5 kattai
  "A":   5/3,
  "A#":  9/5,
  "B":   15/8,
  "C+":  2.0
};


/* ── Ragam dictionaries are loaded at runtime from Supabase ──────────────
   melakarta_dict, audava_ragam_dict, shadava_ragam_dict
   are all populated by ragamInit() in app.js after user auth.
   ─────────────────────────────────────────────────────────────────── */

// Runtime dicts — populated from Supabase by ragamInit()
let melakarta_dict = {};
let audava_ragam_dict = {};
let shadava_ragam_dict = {};

// Janya ragams will be loaded at runtime


// Pattern templates have been moved to the get-patterns Edge Function.
// app.js fetches the resolved play queue at runtime via sb.functions.invoke('get-patterns').

const VARISAI_ALL = [
  "Sarali Varisai",
  "Janta Varisai",
  "Dhatu Varisai",
  "Hechusthayi Varisai",
  "Mandrasthayi Varisai",
  "Alankaram"
];

// Audava and Shadava ragams have irregular note counts (5 and 6 notes),
// which makes Sarali/Janta/Dhatu patterns structurally ill-defined for them.
// Only Alankaram is offered — by design, not omission.
const VARISAI_AUDAVA = [
  "Alankaram",
];

// Same rationale as VARISAI_AUDAVA — 6-note scales only support Alankaram.
const VARISAI_SHADAVA = [
  "Alankaram"
];

function loadVarisais(list) {
  varisaiSelect.innerHTML = "";

  list.forEach(v => {
    const o = document.createElement("option");
    o.textContent = v;
    varisaiSelect.appendChild(o);
  });


}