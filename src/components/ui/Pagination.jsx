import { ChevronLeft, ChevronRight } from 'lucide-react';
import './Pagination.css';

// Builds the list of page numbers/ellipses to show: every page when there
// are few, otherwise first, last, and a window around the current page —
// e.g. [1, '…', 4, 5, 6, '…', 12] — so the control doesn't grow unbounded
// on a long list.
function getPageItems(page, totalPages) {
  const maxButtons = 7;
  if (totalPages <= maxButtons) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const items = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);

  if (start > 2) items.push('…');
  for (let p = start; p <= end; p++) items.push(p);
  if (end < totalPages - 1) items.push('…');
  items.push(totalPages);

  return items;
}

// Numbered pager — a row of page buttons (current one filled) bracketed by
// chevron prev/next buttons. `onSelect` jumps straight to a given page;
// `onPrev`/`onNext` (still separate props, not derived from onSelect) let
// each caller keep its own clamping logic exactly as before.
export default function Pagination({ page, totalPages, onPrev, onNext, onSelect }) {
  const items = getPageItems(page, totalPages);

  return (
    <div className="pagination">
      <button type="button" className="pagination-nav" aria-label="Previous page" onClick={onPrev} disabled={page <= 1}>
        <ChevronLeft size={16} />
      </button>

      {items.map((item, i) =>
        item === '…' ? (
          <span key={`ellipsis-${i}`} className="pagination-ellipsis">…</span>
        ) : (
          <button
            key={item}
            type="button"
            className={`pagination-page${item === page ? ' is-active' : ''}`}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => onSelect(item)}
          >
            {item}
          </button>
        )
      )}

      <button type="button" className="pagination-nav" aria-label="Next page" onClick={onNext} disabled={page >= totalPages}>
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
