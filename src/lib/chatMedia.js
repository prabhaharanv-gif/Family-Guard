import { supabase } from './supabase'

/**
 * Chat attachments — upload, and read back through a signed URL.
 *
 * The `chat-media` bucket is private. A public bucket would be less code, but
 * a family conversation is exactly the material that must not be readable by
 * anyone holding the link, and a private one-to-one thread is readable by two
 * people rather than the whole family — which no public URL can express. So
 * the message row stores the storage PATH and the bubble signs a URL when it
 * is drawn.
 *
 * Paths encode who may read the file, and the storage policies parse them:
 *   family room     <family_id>/<sender_id>/<uuid>.<ext>
 *   private thread  dm/<family_id>/<uuid_a>__<uuid_b>/<uuid>.<ext>
 */

const BUCKET = 'chat-media'

// Matches the bucket's own file_size_limit. Checked here as well so an
// oversized file is refused before it is uploaded, not after.
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024

// Only what the bucket accepts. A phone can hand over an .amr or a .mkv that
// would be rejected server-side with a much less helpful message.
const MIME_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov',
  'video/3gpp': '3gp', 'video/webm': 'webm',
  'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac',
  'audio/ogg': 'ogg', 'audio/webm': 'weba', 'audio/wav': 'wav',
  'audio/3gpp': '3ga',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'application/zip': 'zip',
}

// Android's document picker frequently reports application/octet-stream — or
// nothing at all — for a file it has no handler for, and a .docx picked from a
// downloads folder is the common case. The extension is then the only thing
// that says what the file is, so it decides both the kind and the content type
// the object is stored with.
const EXT_MIME = Object.entries(MIME_EXT).reduce((acc, [mime, ext]) => {
  if (!acc[ext]) acc[ext] = mime
  return acc
}, {})

function baseMime(mime) {
  return (mime || '').toLowerCase().split(';')[0].trim()
}

function extensionOf(name) {
  const dot = (name || '').lastIndexOf('.')
  return dot > -1 ? name.slice(dot + 1).toLowerCase() : ''
}

function kindOfMime(mime) {
  if (!MIME_EXT[mime]) return null
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'document'
}

/**
 * What this file is, and what to store it as.
 * Returns null when we will not send it at all.
 *
 * @returns {{ kind, mime, ext } | null}
 */
export function describeFile(file) {
  if (!file) return null
  const declared = baseMime(file.type)
  const byMime = kindOfMime(declared)
  if (byMime) return { kind: byMime, mime: declared, ext: MIME_EXT[declared] }

  // Fall back to the extension, and normalise the content type to match it so
  // the bucket's allowed_mime_types list stays tight.
  const ext = extensionOf(file.name)
  const mime = EXT_MIME[ext]
  if (!mime) return null
  return { kind: kindOfMime(mime), mime, ext }
}

/** 'image' | 'video' | 'audio' | 'document' | null */
export function mediaKindOf(file) {
  return describeFile(file)?.kind || null
}

function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID()
  } catch (e) { /* older WebView */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function familyMediaFolder(familyId, userId) {
  return `${familyId}/${userId}`
}

/** Sorted, so both participants derive the same folder for their thread. */
export function directMediaFolder(familyId, userA, userB) {
  const pair = [userA, userB].sort().join('__')
  return `dm/${familyId}/${pair}`
}

/**
 * Upload one file and return what the send RPC needs.
 * Throws with a human-readable message; callers surface it in a dialog.
 */
export async function uploadChatMedia(folder, file) {
  const described = describeFile(file)
  if (!described) throw new Error('unsupported')
  if (file.size > MEDIA_MAX_BYTES) throw new Error('too-big')

  const { kind, mime, ext } = described
  const path = `${folder}/${randomId()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: mime,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) throw error

  // The original name is kept only for documents, which are shown by name —
  // a photo is shown by being a photo, and IMG_20260831_141233.jpg under it
  // would be noise.
  return {
    path, type: kind, mime, size: file.size,
    name: kind === 'document' ? String(file.name || '').slice(0, 200) : null,
  }
}

// ── Signed URLs ─────────────────────────────────────────────────────────────
// Cached per path: a chat re-renders constantly (every keystroke in the
// composer), and signing on each render would be a request per bubble per
// keypress. Six hours outlives any single sitting; the margin re-signs before
// a URL that is still on screen goes stale.
const SIGN_SECONDS = 6 * 60 * 60
const SIGN_MARGIN_MS = 5 * 60 * 1000
const signedCache = new Map()

export async function signedMediaUrl(path) {
  if (!path) return null
  const hit = signedCache.get(path)
  if (hit && hit.expiresAt - SIGN_MARGIN_MS > Date.now()) return hit.url

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGN_SECONDS)
  if (error || !data?.signedUrl) return null

  signedCache.set(path, {
    url: data.signedUrl,
    expiresAt: Date.now() + SIGN_SECONDS * 1000,
  })
  return data.signedUrl
}

/** Short label for a message whose content is empty because it is an attachment. */
export function mediaLabel(t, type) {
  if (type === 'image') return t('messages.mediaPhoto')
  if (type === 'video') return t('messages.mediaVideo')
  if (type === 'audio') return t('messages.mediaAudio')
  if (type === 'document') return t('messages.mediaDocument')
  return ''
}

/** Human-readable size for the one attachment that is shown as a file. */
export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
