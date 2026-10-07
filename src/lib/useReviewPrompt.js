import { useContext } from 'react';
import { ReviewPromptContext } from './reviewPromptState';

// `const { current, dismiss, markReviewed } = useReviewPrompt();`
// - current: the next completed-but-unreviewed booking due for a prompt, or null
// - dismiss(): "Maybe Later" / the × — records it and moves on to the next one
// - markReviewed(bookingId): call after a successful review submission
export function useReviewPrompt() {
  return useContext(ReviewPromptContext);
}
