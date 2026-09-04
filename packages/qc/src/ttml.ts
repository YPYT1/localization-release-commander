import { parseSrt } from "./subtitle.js";

export interface TtmlOptions {
  language: string;
}

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function timestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const millis = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function srtToTtml(input: string, options: TtmlOptions): string {
  if (!options.language.trim()) throw new TypeError("TTML language is required");
  const cues = parseSrt(input);
  const paragraphs = cues.map((cue, offset) => {
    const text = cue.text.split("\n").map(xml).join("<br/>");
    return `      <p xml:id="cue-${offset + 1}" begin="${timestamp(cue.startMs)}" end="${timestamp(cue.endMs)}">${text}</p>`;
  });

  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:timeBase="media" xml:lang="${xml(options.language)}">`,
    "  <body>",
    "    <div>",
    ...paragraphs,
    "    </div>",
    "  </body>",
    "</tt>",
    "",
  ].join("\n");
}
