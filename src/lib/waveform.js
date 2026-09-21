/**
 * Bar heights for a voice note.
 *
 * ── These are not the recording ────────────────────────────────────────────
 * They are not the real amplitude envelope, and nothing here has listened to
 * the audio. Getting the true peaks means fetching every note in the room and
 * decoding each one through the Web Audio API — in a family chat with fifty
 * voice messages that is fifty downloads and fifty decodes on a phone that is
 * already fighting to keep the WebView alive.
 *
 * So the bars are derived from the message id instead. That buys the two
 * properties that actually matter on screen:
 *
 *   · stable — the same note draws the same shape every time the chat opens,
 *     on every device, for every member. A shape that reshuffled on each
 *     render would read as a bug.
 *   · distinct — two notes side by side do not look stamped from one mould.
 *
 * It is decoration standing in for data. Worth knowing before anyone reads
 * meaning into a tall bar.
 *
 * Pure: no DOM, no clock, no randomness. waveform.test.js replays it.
 */

/** Bars in one waveform. 28 fills the row at 3px wide with a 2px gap. */
export const BAR_COUNT = 28

/** Shortest bar, as a fraction of the row height. Below this it reads as a gap. */
const FLOOR = 0.25

/**
 * @param seed  anything stable per message; the message id in practice.
 * @returns heights in (0, 1], one per bar.
 */
export function waveformBars(seed, count = BAR_COUNT) {
  const s = String(seed ?? '')

  // FNV-1a over the id, then xorshift per bar. Not cryptography — it only has
  // to scatter ids that differ in one character, which sequential uuids do.
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  // A seed of 0 would leave xorshift stuck there for every bar.
  h = (h >>> 0) || 0x9e3779b9

  const out = []
  for (let i = 0; i < count; i++) {
    h ^= h << 13; h >>>= 0
    h ^= h >>> 17
    h ^= h << 5;  h >>>= 0

    const unit = h / 4294967295

    // Speech starts and ends quieter than it runs. Tapering the first and last
    // few bars is the difference between a waveform and a picket fence.
    const edge = Math.min(i + 1, count - i) / 4
    const taper = 0.55 + 0.45 * Math.min(1, edge)

    out.push((FLOOR + unit * (1 - FLOOR)) * taper)
  }
  return out
}
