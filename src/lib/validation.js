
export function getFullNameError(fullName) {
  const trimmed = fullName.trim();
  if (!trimmed) return 'Full name is required.';
  if (!/^[A-Za-z]+(?: [A-Za-z]+)*$/.test(trimmed)) {
    return 'Enter only letters, no numbers or symbols.';
  }
  return undefined;
}
export function getPhoneError(phone) {
  const trimmed = phone.trim();
  if (!trimmed) return 'Phone number is required.';
  const digits = trimmed.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(trimmed) || digits.length < 7 || digits.length > 15) {
    return 'Enter a valid phone number.';
  }
  return undefined;
}
