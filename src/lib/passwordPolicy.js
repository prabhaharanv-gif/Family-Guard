// Minimum length for any password the app sets: registration, change, and
// both SMS resets. reset_password_verified() enforces the same number on the
// server, so change both together.
//
// 6, so a 6-digit PIN is allowed — family members need something they can
// remember. That was a deliberate choice over breach protection: every 6-digit
// number is in the Have I Been Pwned list, so an 8-character minimum plus a
// leaked-password check (tried 2026-09-15) refused nearly every password
// people actually pick.
export const PASSWORD_MIN_LENGTH = 6
