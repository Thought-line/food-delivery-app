import { StarIcon } from './icons';
import './StarRating.css';

// Renders 5 stars. Read-only display (review cards, the review-prompt
// card's decorative row, "Your review" in My Bookings) when no `onChange`
// is given; an interactive picker (the review form) when it is.
export default function StarRating({ value = 0, onChange, size = 18, className }) {
  const interactive = typeof onChange === 'function';
  const stars = [1, 2, 3, 4, 5];

  return (
    <div
      className={['star-rating', interactive ? 'is-interactive' : '', className].filter(Boolean).join(' ')}
      role={interactive ? 'radiogroup' : 'img'}
      aria-label={interactive ? 'Rating' : `Rated ${value} out of 5`}
    >
      {stars.map((n) =>
        interactive ? (
          <button
            key={n}
            type="button"
            className="star-rating-btn"
            onClick={() => onChange(n)}
            aria-label={`${n} star${n !== 1 ? 's' : ''}`}
            aria-pressed={n === value}
          >
            <StarIcon filled={n <= value} size={size} />
          </button>
        ) : (
          <span key={n} className="star-rating-star">
            <StarIcon filled={n <= Math.round(value)} size={size} />
          </span>
        )
      )}
    </div>
  );
}
