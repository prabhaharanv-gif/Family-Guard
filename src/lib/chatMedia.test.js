import { describe, it, expect, vi } from 'vitest'

// chatMedia imports the Supabase client at module scope, which would try to
// build a real client from env vars that do not exist in a test run. Only the
// pure helpers are under test here; the upload paths are not.
vi.mock('./supabase', () => ({ supabase: {} }))

const {
  describeFile,
  mediaKindOf,
  familyMediaFolder,
  directMediaFolder,
  mediaLabel,
  formatBytes,
  MEDIA_MAX_BYTES,
} = await import('./chatMedia')

/** Minimal stand-in for a browser File. */
const file = (name, type = '') => ({ name, type })

describe('describeFile / mediaKindOf', () => {
  it('classifies by declared MIME type', () => {
    expect(mediaKindOf(file('a.jpg', 'image/jpeg'))).toBe('image')
    expect(mediaKindOf(file('a.mp4', 'video/mp4'))).toBe('video')
  })

  it('ignores codec parameters on the MIME type', () => {
    expect(mediaKindOf(file('a.mp4', 'video/mp4; codecs="avc1"'))).toBe('video')
  })

  /**
   * Android WebView hands over an empty or generic type for plenty of picks,
   * so the extension fallback is the difference between sending a photo and
   * silently refusing one.
   */
  it('falls back to the extension when no type is declared', () => {
    expect(mediaKindOf(file('holiday.jpg'))).toBe('image')
    expect(mediaKindOf(file('clip.mp4'))).toBe('video')
  })

  it('falls back to the extension when the type is generic', () => {
    expect(mediaKindOf(file('holiday.jpg', 'application/octet-stream'))).toBe('image')
  })

  it('matches extensions regardless of case', () => {
    expect(mediaKindOf(file('HOLIDAY.JPG'))).toBe('image')
  })

  it('normalises the MIME type to match the extension it resolved', () => {
    const described = describeFile(file('holiday.jpg'))
    expect(described.mime).toBeTruthy()
    expect(described.mime).not.toBe('application/octet-stream')
  })

  it('refuses a file it cannot identify', () => {
    expect(mediaKindOf(file('mystery.zzz'))).toBeNull()
    expect(mediaKindOf(file('noextension'))).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(describeFile(null)).toBeNull()
    expect(describeFile(undefined)).toBeNull()
    expect(mediaKindOf(null)).toBeNull()
  })

  it('returns a kind, a mime and an extension when it succeeds', () => {
    const described = describeFile(file('a.jpg', 'image/jpeg'))
    expect(described).toMatchObject({ kind: 'image' })
    expect(described.mime).toBeTruthy()
    expect(described.ext).toBeTruthy()
  })
})

describe('media folders', () => {
  it('scopes family media to the family and sender', () => {
    expect(familyMediaFolder('fam1', 'user1')).toBe('fam1/user1')
  })

  /**
   * The property that matters: both participants must derive the same folder,
   * or each would upload somewhere the other never reads and the thread would
   * show attachments to only one side.
   */
  it('gives both participants of a direct thread the same folder', () => {
    expect(directMediaFolder('fam1', 'alice', 'bob'))
      .toBe(directMediaFolder('fam1', 'bob', 'alice'))
  })

  it('keeps direct threads separate per family', () => {
    expect(directMediaFolder('fam1', 'alice', 'bob'))
      .not.toBe(directMediaFolder('fam2', 'alice', 'bob'))
  })

  it('keeps different pairs apart', () => {
    expect(directMediaFolder('fam1', 'alice', 'bob'))
      .not.toBe(directMediaFolder('fam1', 'alice', 'carol'))
  })

  it('puts direct media under its own prefix', () => {
    expect(directMediaFolder('fam1', 'alice', 'bob')).toMatch(/^dm\//)
  })
})

describe('formatBytes', () => {
  it('uses bytes below a kilobyte', () => {
    expect(formatBytes(512)).toBe('512 B')
  })

  it('uses kilobytes below a megabyte', () => {
    expect(formatBytes(2048)).toBe('2 KB')
  })

  it('uses megabytes above that', () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })

  it('renders nothing for a missing or nonsensical size', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(null)).toBe('')
    expect(formatBytes(undefined)).toBe('')
    expect(formatBytes(-1)).toBe('')
  })

  it('describes the largest allowed attachment sensibly', () => {
    expect(formatBytes(MEDIA_MAX_BYTES)).toMatch(/MB$/)
  })
})

describe('mediaLabel', () => {
  const t = key => key

  it('labels each media kind', () => {
    expect(mediaLabel(t, 'image')).toBe('messages.mediaPhoto')
    expect(mediaLabel(t, 'video')).toBe('messages.mediaVideo')
    expect(mediaLabel(t, 'audio')).toBe('messages.mediaAudio')
    expect(mediaLabel(t, 'document')).toBe('messages.mediaDocument')
  })

  it('returns nothing for an unknown kind rather than a broken key', () => {
    expect(mediaLabel(t, 'hologram')).toBe('')
    expect(mediaLabel(t, null)).toBe('')
    expect(mediaLabel(t, undefined)).toBe('')
  })
})
