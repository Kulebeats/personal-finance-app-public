/**
 * NRC at rest (AH-07): the only code that turns a submitted NRC into the
 * users.nrc value and back. Every reader (own-profile DTO, personal-data
 * export) and the profile writer go through these two functions.
 *
 * Interim storage (OI-04 proposal): the value is kept as entered. It is
 * returned only to its owner (own profile, own export) and erased with the
 * account. If the owner chooses encryption at rest, it changes here only.
 */

/** The users.nrc value for a validated NRC; null clears it. */
export function nrcForStorage(nrc: string | null): string | null {
  return nrc;
}

/** The NRC held in a users.nrc value, for its owner only. */
export function nrcFromStorage(stored: string | null): string | null {
  return stored;
}
