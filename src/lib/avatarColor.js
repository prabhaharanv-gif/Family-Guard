// Single source for the colour behind an initial-letter avatar.
//
// `family_members.avatar_color` still defaults to the old blue (#4F8EF7) in
// the database, so every member created before the Famora rebrand — and every
// member created since, unless someone picked a colour by hand — carries that
// blue. The Family list already treated it as "unset" and painted maroon;
// this makes the rest of the app agree instead of each screen re-deciding.
export const MAROON = '#8B0D3D'

const LEGACY_DEFAULT = '#4f8ef7'

export function avatarColor(color) {
  if (!color) return MAROON
  return color.toLowerCase() === LEGACY_DEFAULT ? MAROON : color
}
