import { supabase } from './supabaseClient';

const BUCKET = 'identity-documents';

// DB stores a short slug (identity_document_type, both profiles and
// bookings) — this is the single place that maps it to display text, same
// pattern as PAYMENT_LABELS/STATUS_LABELS elsewhere in the app.
export const DOCUMENT_TYPES = [
  { value: 'aadhaar', label: 'Aadhaar Card' },
  { value: 'driving_licence', label: 'Driving Licence' },
  { value: 'pan', label: 'PAN Card' },
  { value: 'passport', label: 'Passport' },
  { value: 'other', label: 'Other' },
];

export const DOCUMENT_TYPE_LABELS = Object.fromEntries(DOCUMENT_TYPES.map((t) => [t.value, t.label]));

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// Shared by both upload paths (customer's own + admin's on a booking) — the
// <input accept> attribute is only a picker hint, not an enforced rule, so
// this is the actual gate. Exported so ProfilePage.jsx can validate a picked
// file inline, before it's attached to the draft.
export function validateDocumentFile(file) {
  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return 'Only JPG, PNG, or PDF files are allowed.';
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return 'File must be 5MB or smaller.';
  }
  return null;
}

// Uploads to '<userId>/<uuid>.<ext>' in the private 'identity-documents'
// bucket — the path (not a public URL, the bucket isn't public) is what
// gets stored in identity_document_url. Storage RLS (see
// 20260914030000_identity_document_verification.sql) restricts writes to
// the caller's own folder.
async function uploadDocumentFile(userId, file) {
  const ext = file.name.split('.').pop();
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

// Sets the customer's own document set to exactly `keepPaths`/`keepFilenames`
// (existing files not removed during this edit) plus whatever `newFiles`
// upload to — same "keepPaths + newFiles" shape as adminSetBookingDocument
// below, so multiple files (front/back of a card, several passport pages)
// can be attached, not just one. A plain first-time upload just passes
// keepPaths: []; nothing here appends across separate calls. Called from
// ProfilePage.jsx's Save handler once the rest of the profile form has
// already validated. If the RPC fails after uploads already succeeded, the
// just-uploaded files are removed again so a retry doesn't orphan them.
export async function submitMyIdentityDocuments({ userId, documentType, keepPaths = [], keepFilenames = [], newFiles = [] }) {
  for (const file of newFiles) {
    const validationError = validateDocumentFile(file);
    if (validationError) throw new Error(validationError);
  }

  // Sequential, not Promise.all — concurrent uploads to the same host are
  // where flaky networks/proxies tend to drop one of them with a bare
  // "Failed to fetch" (no HTTP error at all, just a broken connection).
  const uploaded = [];
  for (const file of newFiles) {
    const path = await uploadDocumentFile(userId, file);
    uploaded.push({ path, filename: file.name });
  }
  const allPaths = [...keepPaths, ...uploaded.map((u) => u.path)];
  const allFilenames = [...keepFilenames, ...uploaded.map((u) => u.filename)];
  const { error } = await supabase.rpc('update_my_identity_document', {
    p_document_type: documentType,
    p_document_paths: allPaths,
    p_document_filenames: allFilenames,
  });
  if (error) {
    if (uploaded.length) {
      try {
        await supabase.storage.from(BUCKET).remove(uploaded.map((u) => u.path));
      } catch {
        // best-effort cleanup — the RPC error below is what the caller needs to see
      }
    }
    throw error;
  }
  return { paths: allPaths, filenames: allFilenames };
}

// A short-lived signed URL for viewing a private document — works for the
// document's owner or an admin (both allowed by the SELECT storage policy).
// Called on demand (not eagerly) so a document that's never opened never
// gets a signed URL generated for it.
export async function getSignedDocumentUrl(path, expirySeconds = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expirySeconds);
  if (error) throw error;
  return data.signedUrl;
}

// Not Submitted / Submitted — shown on the Profile page. There's no
// in-app verification step: the document is only ever checked physically by
// an admin at handover, so "submitted" is the final customer-facing state.
export async function fetchMyIdentityDocumentStatus(userId) {
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('identity_document_urls, identity_document_type, identity_document_filenames, identity_document_submitted_at')
    .eq('id', userId)
    .single();
  if (profileError) throw profileError;

  const paths = profile.identity_document_urls ?? [];
  const filenames = profile.identity_document_filenames ?? [];

  if (!paths.length) {
    return { status: 'not_submitted', documentType: null, filenames: [], paths: [], submittedAt: null };
  }

  return {
    status: 'submitted',
    documentType: profile.identity_document_type,
    filenames,
    paths,
    submittedAt: profile.identity_document_submitted_at,
  };
}

// Admin attaches/edits one or more document images on a booking — stored
// under 'admin-uploads/<bookingId>/...', a distinct prefix from customers'
// own '<userId>/...' documents so it can have its own admin-only INSERT
// policy (see 20260914050000/20260914060000). Scoped to this booking only;
// never touches the customer's profile.
async function uploadAdminBookingDocumentFile(bookingId, file) {
  const ext = file.name.split('.').pop();
  const path = `admin-uploads/${bookingId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file);
  if (error) throw error;
  return path;
}

// Sets a booking's document set to exactly `keepPaths` (existing paths the
// admin chose to keep) plus whatever `newFiles` upload to. A plain first-
// time upload just passes keepPaths: [] — editing an existing set passes
// through whichever existing paths weren't removed. Either way this is the
// single source of truth for what the booking ends up with; nothing here
// appends across separate calls. If the RPC fails after the uploads already
// succeeded, the just-uploaded files are removed again so retrying doesn't
// re-upload duplicates and orphan the first attempt's files in storage.
export async function adminSetBookingDocument({ bookingId, documentType, keepPaths = [], newFiles = [] }) {
  for (const file of newFiles) {
    const validationError = validateDocumentFile(file);
    if (validationError) throw new Error(validationError);
  }

  const uploadedPaths = await Promise.all(newFiles.map((file) => uploadAdminBookingDocumentFile(bookingId, file)));
  const allPaths = [...keepPaths, ...uploadedPaths];
  const { error } = await supabase.rpc('admin_set_booking_document', {
    p_booking_id: bookingId,
    p_document_type: documentType,
    p_document_paths: allPaths,
  });
  if (error) {
    if (uploadedPaths.length) {
      try {
        await supabase.storage.from(BUCKET).remove(uploadedPaths);
      } catch {
        // best-effort cleanup — the RPC error below is what the caller needs to see
      }
    }
    throw error;
  }
  return allPaths;
}
