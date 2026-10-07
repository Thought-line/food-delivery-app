import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { fetchMyProfile, composeAddress } from './profile';

// Pre-fills the shared "who's picking this up" contact fields (see
// ContactFields.jsx) from the customer's saved profile, so a returning
// customer doesn't retype their name/phone/address on every booking.
// Prefill only — never writes back to the profile, and functional setter
// updates mean a slow fetch can't clobber anything the customer has
// already started typing (editing the saved profile itself only happens on
// ProfilePage.jsx). Shared by BookingForm.jsx and CartPage.jsx.
export function useProfileContactDefaults({ setName, setPhone, setLocation }) {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchMyProfile(user.id)
      .then((profile) => {
        if (cancelled) return;
        if (profile?.full_name) setName((prev) => (prev.trim() ? prev : profile.full_name));
        if (profile?.phone) setPhone((prev) => (prev.trim() ? prev : profile.phone));
        const address = composeAddress({
          addressLine: profile?.address_line,
          locality: profile?.locality,
          city: profile?.city,
          state: profile?.state,
          pincode: profile?.pincode,
        });
        if (address) setLocation((prev) => (prev.trim() ? prev : address));
      })
      .catch(() => {}); // best-effort — a failed fetch just leaves the fields blank as before
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}
