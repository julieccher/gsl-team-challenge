// Screenshot-Auslese für Lauf-Apps (COROS, Garmin, Strava, Apple Fitness, …).
//
// Ziel: lieber KEINE Kilometer liefern als falsche. Deshalb
//  1. Bild aufbereiten (hochskalieren, Graustufen, dunkle Designs invertieren),
//  2. alle Zahlen + Zeilenhöhen auslesen,
//  3. Distanz per Gegenprobe Zeit ÷ Pace bestätigen und typische
//     OCR-Verwechslungen (1↔7, 0↔8, …) damit korrigieren.
// Ergebnis "verified" = Gegenprobe passt, "unsure" = plausibel aber unbestätigt,
// "missing" = keine Distanz gefunden (Trainer trägt km bei der Freigabe ein).

export type KmCheck = "verified" | "unsure" | "missing" | "manual";

export type OcrLine = { text: string; height: number };

export type OcrResult = {
  km: number | null;
  kmCheck: KmCheck;
  date: string | null; // yyyy-mm-dd
  info: string;
};

const MIN_KM = 0.3;
const MAX_KM = 100;

// ---------- Text-Auswertung (rein, ohne Tesseract testbar) ----------

type DistCandidate = { raw: string; value: number; score: number; miles: boolean };

const CONFUSABLE: Record<string, string[]> = {
  "1": ["7", "4"],
  "7": ["1"],
  "0": ["8", "6", "9"],
  "8": ["0", "3", "6", "9"],
  "3": ["8"],
  "5": ["6", "3"],
  "6": ["5", "8", "0"],
  "9": ["8", "0"],
  "4": ["1"],
};

function variants(raw: string): string[] {
  const out = new Set<string>([raw]);
  const digits = [...raw].map((c, i) => ({ c, i })).filter(d => /\d/.test(d.c));
  for (const a of digits) {
    for (const ra of CONFUSABLE[a.c] ?? []) {
      const one = raw.slice(0, a.i) + ra + raw.slice(a.i + 1);
      out.add(one);
      for (const b of digits) {
        if (b.i <= a.i) continue;
        for (const rb of CONFUSABLE[b.c] ?? []) out.add(one.slice(0, b.i) + rb + one.slice(b.i + 1));
      }
    }
  }
  return [...out];
}

function toNumber(s: string): number {
  return Number(s.replace(",", "."));
}

/** Gesamtdauer in Sekunden aus "40:41", "1:02:33", "40:41,85". */
function durationCandidates(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/(?<![\d:'’′])(\d{1,2}):(\d{2})(?::(\d{2}))?(?![\d'"’″])/g)) {
    const [a, b, c] = [m[1], m[2], m[3]].map(v => (v === undefined ? undefined : Number(v)));
    const secs = c === undefined ? a! * 60 + b! : a! * 3600 + b! * 60 + c;
    if (b! < 60 && (c === undefined || c < 60) && secs >= 120 && secs <= 6 * 3600) out.push(secs);
  }
  return out;
}

/** Pace in Sekunden pro km aus 5'27", 527" /km, 5:27 /km, 5:27/km. */
function paceCandidates(text: string): number[] {
  const out: number[] = [];
  const push = (min: number, sec: number) => {
    const s = min * 60 + sec;
    if (sec < 60 && s >= 150 && s <= 15 * 60) out.push(s);
  };
  for (const m of text.matchAll(/(\d{1,2})\s?['’′`]?\s?(\d{2})\s?["”″]/g)) push(Number(m[1]), Number(m[2]));
  for (const m of text.matchAll(/(\d{1,2}):(\d{2})\s*\/\s*(?:km|kn|krn)/gi)) push(Number(m[1]), Number(m[2]));
  return out;
}

function distanceCandidates(lines: OcrLine[]): DistCandidate[] {
  const maxH = Math.max(1, ...lines.map(l => l.height));
  const out: DistCandidate[] = [];
  lines.forEach((line, idx) => {
    const t = line.text;
    const near = [lines[idx - 1]?.text ?? "", t, lines[idx + 1]?.text ?? ""].join(" ");
    const labelled = /distan|strecke|entfernung/i.test(near);
    for (const m of t.matchAll(/(?<![\d:'’′.,])(\d{1,3}[.,]\d{1,2})(?![\d:'’′"″])\s*([a-z/]{0,4})/gi)) {
      const unit = m[2].toLowerCase();
      if (unit.startsWith("/") || unit.includes("/")) continue; // Pace oder km/h
      const after = t.slice((m.index ?? 0) + m[0].length);
      if (/^\s*\/\s*h/i.test(after) || /^\s*(bpm|kcal|cal|m\b|%)/i.test(after)) continue;
      const value = toNumber(m[1]);
      const isMiles = /^mi/.test(unit);
      let score = 1;
      if (/^(km|kn|krn|k)$/.test(unit)) score += 3;
      if (isMiles) score += 2;
      if (labelled) score += 3;
      score += 3 * (line.height / maxH); // große Zahl = meist die Hauptkennzahl
      const km = isMiles ? value * 1.609344 : value;
      if (km >= MIN_KM && km <= MAX_KM) out.push({ raw: m[1], value: Math.round(km * 100) / 100, score, miles: isMiles });
    }
  });
  return out.sort((a, b) => b.score - a.score);
}

const MONTHS: [RegExp, number][] = [
  [/^j[aä]e?n|^jan/i, 1], [/^feb/i, 2], [/^m[aä]e?r/i, 3], [/^apr/i, 4], [/^ma[iy]/i, 5],
  [/^jun/i, 6], [/^jul/i, 7], [/^aug/i, 8], [/^sep/i, 9], [/^o[ck]t/i, 10], [/^nov/i, 11], [/^de[cz]/i, 12],
];

function monthFromName(name: string): number | null {
  for (const [re, n] of MONTHS) if (re.test(name)) return n;
  return null;
}

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2020 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function parseDate(text: string, today = new Date()): string | null {
  const found: string[] = [];
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](20\d{2})(?!\d)/g)) {
    const v = iso(Number(m[3]), Number(m[2]), Number(m[1])); if (v) found.push(v);
  }
  for (const m of text.matchAll(/(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g)) {
    const v = iso(Number(m[1]), Number(m[2]), Number(m[3])); if (v) found.push(v);
  }
  // 3. Jän. 2026 / 3 Jan 2026
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\.?\s+([A-Za-zÄÖÜäöü]{3,9})\.?,?\s+(20\d{2})/g)) {
    const mo = monthFromName(m[2]); if (mo) { const v = iso(Number(m[3]), mo, Number(m[1])); if (v) found.push(v); }
  }
  // Jan 3, 2026
  for (const m of text.matchAll(/([A-Za-zÄÖÜäöü]{3,9})\.?\s+(\d{1,2}),?\s+(20\d{2})/g)) {
    const mo = monthFromName(m[1]); if (mo) { const v = iso(Number(m[3]), mo, Number(m[2])); if (v) found.push(v); }
  }
  const todayKey = today.toISOString().slice(0, 10);
  return found.find(d => d <= todayKey) ?? null;
}

export function parseRunText(lines: OcrLine[], today = new Date()): OcrResult {
  const text = lines.map(l => l.text).join("\n");
  const date = parseDate(text, today);
  const candidates = distanceCandidates(lines);
  const durations = durationCandidates(text);
  const paces = paceCandidates(text);

  // Gegenprobe: Zeit ÷ Pace ≈ Distanz (±1,5 %). Auch OCR-Verwechslungen prüfen.
  // Verglichen wird in der Einheit des Screenshots (km oder Meilen), danach umgerechnet.
  let best: { value: number; diff: number; score: number } | null = null;
  for (const c of candidates.slice(0, 6)) {
    for (const v of variants(c.raw)) {
      const unitValue = toNumber(v);
      const value = c.miles ? unitValue * 1.609344 : unitValue;
      if (!(value >= MIN_KM && value <= MAX_KM)) continue;
      for (const t of durations) for (const p of paces) {
        const diff = Math.abs(t / p - unitValue) / unitValue;
        const penalty = v === c.raw ? 0 : 0.002; // Originalwert bevorzugen
        if (diff <= 0.015 && (!best || diff + penalty < best.diff || (diff + penalty === best.diff && c.score > best.score))) {
          best = { value, diff: diff + penalty, score: c.score };
        }
      }
    }
  }
  if (best) {
    return { km: Math.round(best.value * 100) / 100, kmCheck: "verified", date, info: "Distanz erkannt und mit Zeit und Pace gegengeprüft." };
  }

  const top = candidates[0];
  const second = candidates[1];
  const clearWinner = top && top.score >= 5 && (!second || top.score - second.score >= 1.5 || second.value === top.value);
  if (top && clearWinner) {
    return { km: top.value, kmCheck: "unsure", date, info: "Distanz erkannt, konnte aber nicht gegengeprüft werden. Der Trainer kontrolliert den Wert bei der Freigabe." };
  }
  return { km: null, kmCheck: "missing", date, info: "Keine eindeutige Distanz erkannt. Du kannst trotzdem einreichen – der Trainer trägt die Kilometer bei der Freigabe ein." };
}

// ---------- Bildaufbereitung + Tesseract ----------

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file); } catch { /* Fallback unten */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Ausschnitt in Graustufen, hochskaliert, helle Schrift auf dunklem Grund wird invertiert. */
function prepare(img: ImageBitmap | HTMLImageElement, y0: number, y1: number, targetWidth = 1600): { canvas: HTMLCanvasElement; scale: number } {
  const sw = img.width, sh = Math.round((y1 - y0) * img.height), sy = Math.round(y0 * img.height);
  const scale = Math.min(3, Math.max(1, targetWidth / sw));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, sy, sw, sh, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const p = data.data;
  const n = w * h;
  const gray = new Uint8ClampedArray(n);
  let sum = 0;
  for (let i = 0; i < n; i++) { const v = 0.299 * p[i * 4] + 0.587 * p[i * 4 + 1] + 0.114 * p[i * 4 + 2]; gray[i] = v; sum += v; }
  const dark = sum / n < 128;
  // Kontrast strecken (2.–98. Perzentil)
  const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[dark ? 255 - gray[i] : gray[i]]++;
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.02) { lo = v; break; } }
  acc = 0;
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= n * 0.02) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < n; i++) {
    const g = dark ? 255 - gray[i] : gray[i];
    const v = Math.max(0, Math.min(255, ((g - lo) * 255) / range));
    p[i * 4] = p[i * 4 + 1] = p[i * 4 + 2] = v;
  }
  ctx.putImageData(data, 0, 0);
  return { canvas, scale };
}

type Worker = Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>;

async function linesOf(worker: Worker, canvas: HTMLCanvasElement, scale: number): Promise<OcrLine[]> {
  const r = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const blocks = r.data.blocks ?? [];
  const lines = blocks.flatMap(b => b.paragraphs.flatMap(p => p.lines));
  if (!lines.length) return r.data.text.split("\n").map(text => ({ text, height: 1 }));
  return lines.map(l => ({ text: l.text.trim(), height: (l.bbox.y1 - l.bbox.y0) / scale })).filter(l => l.text);
}

export async function readRunScreenshot(file: Blob, onProgress?: (msg: string) => void): Promise<OcrResult> {
  const { createWorker, PSM } = await import("tesseract.js");
  const img = await loadBitmap(file);
  const worker = await createWorker("eng", 1, {
    logger: m => { if (m.status === "recognizing text") onProgress?.(`Texterkennung: ${Math.round((m.progress ?? 0) * 100)}%`); },
  });
  try {
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    // Durchgang 1: ganzes Bild. Durchgang 2/3: untere bzw. obere Hälfte (Karten/Fotos stören oft).
    const passes: [number, number][] = [[0, 1], [0.45, 1], [0, 0.55]];
    const all: OcrLine[] = [];
    let result: OcrResult | null = null;
    for (const [i, [y0, y1]] of passes.entries()) {
      onProgress?.(`Screenshot wird gelesen (Durchgang ${i + 1} von ${passes.length}) …`);
      const { canvas, scale } = prepare(img, y0, y1);
      all.push(...await linesOf(worker, canvas, scale));
      result = parseRunText(all);
      if (result.kmCheck === "verified" && result.date) break;
    }
    return result ?? parseRunText(all);
  } finally {
    await worker.terminate();
    if ("close" in img) img.close();
  }
}
