/**
 * Number formatting for the screens.
 *
 * Numbers are grouped the Indian way (14,247 and 1,42,470), in every app
 * language: the digits stay the familiar 0-9 and only the comma placement
 * follows India. Distances read as one decimal under 10 km ("2.9") and as a
 * whole number from 10 km up ("14,247").
 */

/** A plain number grouped the Indian way, with a fixed number of decimals. */
export function formatCount(n, digits = 0) {
  const v = Number(n)
  if (!Number.isFinite(v)) return ''
  return v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** A distance in kilometres, without the unit. */
export function formatKm(km) {
  const v = Number(km)
  if (!Number.isFinite(v)) return ''
  const oneDecimal = Math.round(v * 10) / 10
  return oneDecimal < 10 ? formatCount(oneDecimal, 1) : formatCount(Math.round(v))
}
