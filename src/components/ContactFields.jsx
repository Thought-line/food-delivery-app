import { getNameError, getPhoneError, getLocationError } from '../lib/contactValidation';

// Name / phone / location — the same three "who's picking this up" fields,
// same validation, same markup, shared by BookingForm.jsx (single camera)
// and CartPage.jsx (checkout), which used to hand-roll their own identical
// copies of this. Renders as a fragment (no wrapper element) so it drops
// straight into the parent <form> and keeps inheriting that form's own CSS
// (.booking-form label / .cart-checkout-form label, etc.) unchanged.
//
// The parent still owns the actual name/phone/location + fieldErrors state
// (and does its own final validation in handleSubmit using the same
// getNameError/getPhoneError/getLocationError) — this component only wires
// up live validation as the user types/blurs: re-validates on change once a
// field has already errored (so the message clears the moment it's fixed),
// and validates on blur (so a field is caught the first time without
// waiting for submit).
export default function ContactFields({
  name, onNameChange,
  phone, onPhoneChange,
  location, onLocationChange,
  fieldErrors, setFieldErrors,
}) {
  return (
    <>
      <label>
        Name
        <input
          type="text"
          className={fieldErrors.name ? 'has-error' : ''}
          value={name}
          onChange={(e) => {
            const value = e.target.value;
            onNameChange(value);
            if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: getNameError(value) }));
          }}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, name: getNameError(name) }))}
          placeholder="Your full name"
        />
        {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
      </label>

      <label>
        Phone number
        <input
          type="tel"
          className={fieldErrors.phone ? 'has-error' : ''}
          value={phone}
          onChange={(e) => {
            const value = e.target.value;
            onPhoneChange(value);
            if (fieldErrors.phone) setFieldErrors((prev) => ({ ...prev, phone: getPhoneError(value) }));
          }}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, phone: getPhoneError(phone) }))}
          placeholder="Your phone number"
        />
        {fieldErrors.phone && <span className="field-error">{fieldErrors.phone}</span>}
      </label>

      <label>
        Address
        <input
          type="text"
          className={fieldErrors.location ? 'has-error' : ''}
          value={location}
          onChange={(e) => {
            const value = e.target.value;
            onLocationChange(value);
            if (fieldErrors.location) {
              setFieldErrors((prev) => ({ ...prev, location: getLocationError(value) }));
            }
          }}
          onBlur={() => setFieldErrors((prev) => ({ ...prev, location: getLocationError(location) }))}
          placeholder="Your address (for verification — we don't deliver)"
        />
        {fieldErrors.location && <span className="field-error">{fieldErrors.location}</span>}
      </label>
    </>
  );
}
