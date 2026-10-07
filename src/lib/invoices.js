import { supabase } from './supabaseClient';

const BUCKET = 'invoices';

// A short-lived signed URL for a booking's invoice PDF — same on-demand
// pattern as identityDocument.js's getSignedDocumentUrl. Works for the
// invoice's owner or an admin (both allowed by the storage SELECT policy).
export async function getSignedInvoiceUrl(path, expirySeconds = 300) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expirySeconds);
  if (error) throw error;
  return data.signedUrl;
}

// The invoice file's size in bytes, or null if it isn't listed yet (e.g.
// queried before the settlement Edge Function has finished uploading it).
export async function getInvoiceFileSize(path) {
  const slash = path.lastIndexOf('/');
  const folder = path.slice(0, slash);
  const filename = path.slice(slash + 1);
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { search: filename });
  if (error || !data?.length) return null;
  return data[0].metadata?.size ?? null;
}

// Downloads the invoice as a real saved file rather than just opening a tab —
// the HTML <a download> attribute doesn't force a save for a cross-origin
// (Supabase Storage) URL, so this fetches the bytes and triggers the
// browser's native download via a throwaway object URL instead.
export async function downloadInvoiceFile(path, filename) {
  const url = await getSignedInvoiceUrl(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not download the invoice.');
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
