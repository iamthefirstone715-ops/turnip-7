// node docs/demo-video/build.mjs
// Replays the captured run as stills under the narration in audio/vo-N.wav. Each beat's stills are spread across its
// clip, so picture and voice stay locked. Stills with computed durations, not a real-time screen recording: no drift.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SHOTS = process.env.SHOTS; // folder with the captured screenshots (screenshot-<ts>-<n>.jpg)
const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const FFPROBE = process.env.FFPROBE ?? FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");
const LEAD = 0.4;
const TAIL = 0.4;
const OUT = join(HERE, "..", "klink-demo.mp4");
const WORK = join(HERE, "work");
mkdirSync(WORK, { recursive: true });

// [narration clip, [[still, share of the clip]]]
// numbers are the screenshot index; "card1"/"card2" are the rendered proof cards
const BEATS = [
  [0, [[0, 1]]], // landing
  [1, [[1, 1]]], // dashboard
  [2, [[2, 1], [3, 1]]], // send: filled, sent
  [3, [["card1", 1]]], // real on-chain receipt
  [4, [[5, 1]]], // bill form, mum remembered
  [5, [[7, 1], [9, 1.3]]], // escrow, then paid with reference
  [6, [["card2", 1]]], // refund path from the local chain test
  [7, [[10, 1], [12, 1.3]]], // sentence, then parsed form using saved details
  [8, [[13, 1], [14, 1.3]]], // cap and start, then active schedule
  [9, [[15, 1]]], // activity
];

const run = (bin, args) => execFileSync(bin, args, { stdio: ["ignore", "pipe", "pipe"] }).toString();
const dur = (f) => parseFloat(run(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).trim());
const still = (s) => {
  if (typeof s === "string") return join(HERE, `${s}.png`);
  const hit = run("bash", ["-c", `ls "${SHOTS}"/screenshot-*-${s}.jpg`]).trim();
  return hit;
};

// Browser shots carry a scrollbar on the right and bottom: crop it, then fit on a 1920x1080 canvas.
const FIT = (card) =>
  card
    ? "scale=1920:1080"
    : "crop=iw-16:ih-16:0:0,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xe9ddff";

const parts = [];
BEATS.forEach(([vo, frames], i) => {
  const audio = join(HERE, "audio", `vo-${vo}.wav`);
  const total = LEAD + dur(audio) + TAIL;
  const weight = frames.reduce((a, [, w]) => a + w, 0);
  frames.forEach(([s, w], j) => {
    const t = (total * w) / weight;
    const out = join(WORK, `b${i}-${j}.mp4`);
    run(FFMPEG, ["-y", "-loglevel", "error", "-loop", "1", "-t", t.toFixed(3), "-i", still(s), "-vf", `${FIT(typeof s === "string")},fps=30,format=yuv420p`, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", out]);
    parts.push(out);
  });
  // this beat's audio: lead silence, the clip, tail silence
  const a = join(WORK, `a${i}.wav`);
  run(FFMPEG, ["-y", "-loglevel", "error", "-i", audio, "-af", `adelay=${Math.round(LEAD * 1000)}|${Math.round(LEAD * 1000)},apad=whole_dur=${total.toFixed(3)}`, "-ar", "44100", "-ac", "2", a]);
});

writeFileSync(join(WORK, "video.txt"), parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));
writeFileSync(join(WORK, "audio.txt"), BEATS.map((_, i) => `file '${join(WORK, `a${i}.wav`).replace(/\\/g, "/")}'`).join("\n"));
run(FFMPEG, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(WORK, "video.txt"), "-f", "concat", "-safe", "0", "-i", join(WORK, "audio.txt"), "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-shortest", "-movflags", "+faststart", OUT]);
console.log(`${OUT}: ${dur(OUT).toFixed(1)}s`);
