// "No photo yet" placeholder shown wherever a camera's image is missing —
// the grid card thumb, the details page's main image, and the wishlist
// grid all used to duplicate this same icon + copy inline.
export default function PhotoPlaceholder({ size = 36, className }) {
  return (
    <div className={className}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path
          fill="currentColor"
          d="M9.4 2 7.8 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-3.8L14.6 2H9.4zM12 8a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"
        />
      </svg>
      <span>Photo coming soon</span>
    </div>
  );
}
