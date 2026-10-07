import { useState } from 'react';
import { useReviewPrompt } from '../lib/useReviewPrompt';
import StarRating from './ui/StarRating';
import CloseButton from './ui/CloseButton';
import ReviewFormModal from './ReviewFormModal';
import './ReviewPromptCard.css';

// Friendly, compact nudge to review a just-completed rental — NOT a
// full-screen modal. Pops up bottom-right (BookingStatusToast already owns
// top-right for "your booking status changed" notifications, see App.jsx —
// keeping this at the opposite corner means the two can never overlap).
export default function ReviewPromptCard() {
  const { current, dismiss, markReviewed } = useReviewPrompt() ?? {};
  const [formOpen, setFormOpen] = useState(false);

  if (!current) return null;

  return (
    <>
      <div className="review-prompt-card" role="status">
        <CloseButton className="review-prompt-close" label="Dismiss" onClick={dismiss} />
        <h3 className="review-prompt-title">How was your rental?</h3>
        <p className="review-prompt-text">
          You recently rented <strong>{current.cameraName}</strong>
        </p>
        <StarRating value={5} size={16} className="review-prompt-stars" />
        <p className="review-prompt-subtext">Share your experience with us</p>
        <div className="review-prompt-actions">
          <button type="button" className="review-prompt-write" onClick={() => setFormOpen(true)}>
            Write a Review
          </button>
          <button type="button" className="review-prompt-later" onClick={dismiss}>
            Maybe Later
          </button>
        </div>
      </div>

      {formOpen && (
        <ReviewFormModal
          booking={current}
          onClose={() => setFormOpen(false)}
          onSubmitted={() => markReviewed(current.id)}
        />
      )}
    </>
  );
}
