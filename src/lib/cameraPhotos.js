// All photos for a camera, cover photo first. Falls back to the single
// image_url column for rows fetched before `photos` existed on the query
// (or before the multi-photo migration backfilled old rows).
export function getCameraPhotos(camera) {
  if (Array.isArray(camera.photos) && camera.photos.length > 0) return camera.photos;
  return camera.image_url ? [camera.image_url] : [];
}

// The cover photo — what every single-image spot (cards, cart, admin table)
// shows. Reuses getCameraPhotos so both stay in sync with one source of truth.
export function getCameraPhotoUrl(camera) {
  return getCameraPhotos(camera)[0] ?? null;
}
