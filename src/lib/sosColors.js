// SOS signal red — the JS mirror of the --sos tokens in styles/global.css.
//
// Inline styles on the SOS page build colours like `${SOS.base}40` (hex +
// alpha), which a CSS var() cannot do, so the values live here as well. Keep
// the two in step. The reasoning for the colour itself is on the tokens.
export const SOS = {
  base:  '#C8102E',
  deep:  '#A30E2B',
  dark:  '#6E0A1E',
  light: '#FCEEF1',
  glow:  '#D81B3C',
}
