// Shared field-level validators for the "who's picking this up" contact
// details (name/phone/location) collected by both BookingForm.jsx (single
// camera) and CartPage.jsx (checkout) — same three fields, same rules, kept
// in one place (via ContactFields.jsx) so both forms agree on what "valid"
// means and show identical wording instead of drifting apart.
//
// Each returns an error string when the value is bad, or undefined when
// it's fine, so a fieldErrors object can be built straight from them:
// { name: getNameError(name), phone: getPhoneError(phone), ... }.
export function getNameError(name) {
  if (!name.trim()) return 'Name is required.';
  return undefined;
}

export function getPhoneError(phone) {
  if (!phone.trim()) return 'Phone number is required.';
  return undefined;
}

export function getLocationError(location) {
  if (!location.trim()) return 'Location is required.';
  return undefined;
}
