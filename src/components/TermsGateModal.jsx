import { useState } from 'react';
import Modal from './ui/Modal';
import PolicyDrawer from './PolicyDrawer';
import './TermsGateModal.css';
// Wide bottom-bar consent gate — "I agree to the Terms and Conditions and
// Rental Policy" — shown before a booking actually goes through. Reused by
// both CameraDetailsPage.jsx (single-camera Book Now) and CartPage.jsx
// (cart checkout) instead of each keeping its own copy of this modal.
// Self-contained: owns the checkbox state and the Exchange/Damage Policy
// drawer, so the caller only needs to render this when `open` and handle
// onAgree/onClose.
export default function TermsGateModal({ title, continueLabel = 'Continue', onAgree, onClose }) {
  const [agreed, setAgreed] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(null); // 'exchange' | 'damage' | null

  return (
    <>
      <Modal overlayClassName="terms-gate-overlay" modalClassName="terms-gate-modal" onClose={onClose}>
        <div className="terms-gate-header">
          <h3>{title}</h3>
          <p className="terms-gate-text">Please review our policies before continuing.</p>
        </div>

        <div className="terms-gate-footer">
          <label className="terms-gate-checkbox">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              I agree to the{' '}
              {/* Its own real content (POLICY_CONTENT.terms — a full page also
                  lives at /terms), shown here as the same slide-in popup as
                  Exchange/Damage Policy rather than navigating away and
                  losing the in-progress booking/checkout form. */}
              <button
                type="button"
                className="terms-gate-inline-link"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPolicyOpen('terms');
                }}
              >
                Terms and Conditions
              </button>{' '}
              and{' '}
              <button
                type="button"
                className="terms-gate-inline-link"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setPolicyOpen('damage');
                }}
              >
                Rental Policy
              </button>
            </span>
          </label>

          <div className="terms-gate-actions">
            <button type="button" className="terms-gate-continue" disabled={!agreed} onClick={onAgree}>
              {continueLabel}
            </button>
            <button type="button" className="terms-gate-cancel" onClick={onClose}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <PolicyDrawer policyKey={policyOpen} onClose={() => setPolicyOpen(null)} />
    </>
  );
}
