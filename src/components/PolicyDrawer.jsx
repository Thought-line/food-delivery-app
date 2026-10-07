import { useEffect } from 'react';
import { POLICY_CONTENT } from '../lib/policyContent';
import CloseButton from './ui/CloseButton';
import './PolicyDrawer.css';

// Right-side slide-in drawer showing the full text of one policy — Terms
// and Conditions, Exchange Policy, or Damage Policy (see policyContent.js).
// Same chrome as CartDrawer/SearchDrawer/the zoom drawer. Shared by
// CameraDetailsPage.jsx's/TermsPage.jsx's own policy links and by
// TermsGateModal.jsx's three inline links, instead of each keeping its own
// copy of this drawer.
export default function PolicyDrawer({ policyKey, onClose }) {
  useEffect(() => {
    if (!policyKey) return undefined;
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [policyKey, onClose]);

  if (!policyKey) return null;

  const content = POLICY_CONTENT[policyKey];

  return (
    <>
      <div className="policy-drawer-backdrop" onClick={onClose} />
      <aside className="policy-drawer" role="dialog" aria-modal="true" aria-label={content.title}>
        <div className="policy-drawer-header">
          <CloseButton className="policy-drawer-close" label="Close" onClick={onClose} />
          <h2>{content.title}</h2>
        </div>

        <div className="policy-drawer-body">
          <p className="policy-drawer-intro">{content.intro}</p>
          {content.sections.map((section, i) => (
            <div key={section.heading} className="policy-drawer-section">
              <h3>
                {i + 1}. {section.heading}
              </h3>
              {section.body && <p>{section.body}</p>}
              {section.list && (
                <ul>
                  {section.list.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
