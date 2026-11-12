/**
 * Indian mobile numbers are ten digits and start with 6, 7, 8 or 9.
 *
 * Checking only the length let numbers such as 3698527418 through to the SMS
 * provider, which paid for an attempt that could never be delivered. Pass the
 * digits only (non-digits already stripped).
 */
export const isIndianMobile = (digits) => /^[6-9]\d{9}$/.test(String(digits ?? ''))
