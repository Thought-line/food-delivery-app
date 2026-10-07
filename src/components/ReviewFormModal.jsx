import { useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import StarRating from './ui/StarRating';
import { formatDate } from '../lib/dateUtils';
import { submitReview } from '../lib/reviews';
import { useCart } from '../lib/useCart';
import './ReviewFormModal.css';

// Shared by both review entry points — the ReviewPromptCard's "Write a
// Review" button and My Bookings' "Leave a Review" button — so there's one
// form, not two. `booking` = { id, cameraName, startDate, endDate }.
export default function ReviewFormModal({ booking, onClose, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // Reuses the app's existing global toast (already shown via CartFeedback,
  // mounted once in AppLayout) instead of building a second toast system
  // just for this one confirmation.
  const { showToast } = useCart();

  async function handleSubmit(e) {
    e.preventDefault();
    if (rating < 1) {
      setError('Please pick a star rating.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitReview(booking.id, rating, comment);
      showToast('success', 'Review submitted successfully!');
      onSubmitted?.();
      onClose();
    } catch (err) {
      if (err.message?.includes('already been reviewed')) {
        onSubmitted?.();
        onClose();
        return;
      }
      setError(err.message || 'Could not submit your review. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal overlayClassName="review-form-overlay" modalClassName="review-form-modal" onClose={() => !busy && onClose()}>
      <h3>Rate your rental</h3>
      <p className="review-form-camera">{booking.cameraName}</p>
      <p className="review-form-dates">
        {formatDate(booking.startDate)} → {formatDate(booking.endDate)}
      </p>

      <form onSubmit={handleSubmit}>
        <StarRating value={rating} onChange={setRating} size={26} className="review-form-stars" />

        <textarea
          className="review-form-textarea"
          placeholder="Share your experience with this camera (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          maxLength={1000}
        />
        {error && (
          <p className="review-form-error" role="alert">
            {error}
          </p>
        )}
        <div className="review-form-actions">
          <Button type="submit" className="review-form-submit" disabled={busy}>
            {busy ? 'Submitting…' : 'Submit Review'}
          </Button>
          <Button type="button" className="review-form-cancel" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
