import './QuantityStepper.css';

// Presentational [ − ] N [ + ] control. The calling component owns the
// increment/decrement logic (availability checks, toasts) — this just
// renders the current state and disables buttons at the bounds.
// `min` defaults to 1 (can't go below a single unit — e.g. a fresh booking
// request). Cart-style usages that remove the item once it hits 0 should
// pass `min={0}` so the − button stays enabled all the way down to 1.
export default function QuantityStepper({ quantity, available, onIncrement, onDecrement, min = 1 }) {
  const atMax = quantity >= available;
  const atMin = quantity <= min;

  return (
    <div className="quantity-stepper">
      <button
        type="button"
        className="quantity-stepper-btn"
        onClick={onDecrement}
        disabled={atMin}
        aria-label="Decrease quantity"
      >
        −
      </button>
      <span className="quantity-stepper-value">{quantity}</span>
      <button
        type="button"
        className={atMax ? 'quantity-stepper-btn is-at-max' : 'quantity-stepper-btn'}
        onClick={onIncrement}
        // NOT `disabled` — a disabled button never fires onClick at all, which
        // would make the caller's "already maxed out, show alternatives"
        // handling (see CameraList.jsx's handleIncrement) unreachable. Still
        // looks and reads as disabled (aria-disabled + the same faded style
        // below), it just still lets the click through.
        aria-disabled={atMax}
        aria-label="Increase quantity"
        title={atMax ? 'Maximum available quantity reached' : undefined}
      >
        +
      </button>
    </div>
  );
}
