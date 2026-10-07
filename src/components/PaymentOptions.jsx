import { formatPrice } from '../lib/common';
import { advanceEstimate } from '../lib/payments';
import { WalletIcon, ClockIcon } from './ui/icons';
import './PaymentOptions.css';

// Pay-full vs pay-25%-advance picker — shared by BookingForm.jsx (single
// camera) and CartPage.jsx (checkout), which used to each hand-roll their
// own copy of this exact same choice (one styled with icons + a highlighted
// selected state, one a bare radio list — see the screenshots that prompted
// this) even though it's the same two options over the same kind of amount.
// Takes the total due and works out the advance itself via advanceEstimate,
// so callers just pass a number and don't duplicate that math either.
export default function PaymentOptions({ total, value, onChange }) {
  if (!(total > 0)) return null;
  const advance = advanceEstimate(total);

  return (
    <fieldset className="payment-options">
      <legend>
        <WalletIcon size={15} />
        Payment <span className="payment-required-mark">*</span>
      </legend>

      <label className={`payment-option${value === 'full' ? ' payment-option-selected' : ''}`}>
        <input
          type="radio"
          className="payment-option-input"
          name="paymentOption"
          value="full"
          checked={value === 'full'}
          onChange={() => onChange('full')}
        />
        <span className="payment-option-radio" aria-hidden="true" />
        <span className="payment-option-icon">
          <WalletIcon size={18} />
        </span>
        <span className="payment-option-label">Pay full — {formatPrice(total)}</span>
      </label>

      <label className={`payment-option${value === 'advance' ? ' payment-option-selected' : ''}`}>
        <input
          type="radio"
          className="payment-option-input"
          name="paymentOption"
          value="advance"
          checked={value === 'advance'}
          onChange={() => onChange('advance')}
        />
        <span className="payment-option-radio" aria-hidden="true" />
        <span className="payment-option-icon">
          <ClockIcon size={18} />
        </span>
        <span className="payment-option-label">
          Pay 25% advance — {formatPrice(advance)} now, {formatPrice(total - advance)} balance later
        </span>
      </label>
    </fieldset>
  );
}
