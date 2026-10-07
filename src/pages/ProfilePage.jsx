import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../lib/useAuth';
import { useCart } from '../lib/useCart';
import { fetchMyProfile, updateMyProfile } from '../lib/profile';
import { getNameError, getPhoneError } from '../lib/contactValidation';
import { INDIAN_STATES } from '../lib/indianStates';
import { friendlyErrorMessage } from '../lib/common';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  validateDocumentFile,
  submitMyIdentityDocuments,
  fetchMyIdentityDocumentStatus,
  getSignedDocumentUrl,
} from '../lib/identityDocument';
import Loading from '../components/ui/Loading';
import CloseButton from '../components/ui/CloseButton';
import Modal from '../components/ui/Modal';
import './ProfilePage.css';

const EMPTY_DRAFT = { fullName: '', phone: '', pincode: '', state: '', addressLine: '', locality: '', city: '' };

function PhoneIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.2 3h2.4l1 3.6-1.8 1.4a10 10 0 0 0 4.6 4.6l1.4-1.8 3.6 1v2.4c0 .8-.7 1.4-1.5 1.3A13.6 13.6 0 0 1 3 5.5c0-.8.5-1.5 1.2-1.5Z" />
    </svg>
  );
}

function initials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join('');
}

function requiredError(value, label) {
  return value.trim() ? undefined : `${label} is required.`;
}

function ViewField({ label, value }) {
  return (
    <div className="profile-view-field">
      <span className="profile-view-field-label">{label}</span>
      <span className="profile-view-field-value">{value ? value : '—'}</span>
    </div>
  );
}

// Read-only "View profile" tab — header card (avatar/name/phone/Edit
// button), address grid, and the identity document's type/filenames/status.
function ProfileView({ profile, docStatus, onViewDocument, viewingPath }) {
  return (
    <div className="profile-view">
      <div className="profile-view-header">
        <div className="profile-avatar" aria-hidden="true">{initials(profile.fullName)}</div>
        <div className="profile-view-identity">
          <h3>{profile.fullName || 'Your name'}</h3>
          <p>{profile.phone || '—'}</p>
        </div>
      </div>

      <div className="profile-view-section">
        <h4 className="profile-view-section-title">Address</h4>
        <div className="profile-view-grid">
          <ViewField label="Address" value={profile.addressLine} />
          <ViewField label="Locality/Town" value={profile.locality} />
          <ViewField label="City/District" value={profile.city} />
          <ViewField label="State" value={profile.state} />
          <ViewField label="Pincode" value={profile.pincode} />
        </div>
      </div>

      <div className="profile-view-section">
        <h4 className="profile-view-section-title">Identity document</h4>
        {docStatus && (
          <div className="profile-doc-summary">
            <span className="profile-doc-summary-label">Document Type</span>
            <span className="profile-doc-type">
              {docStatus.status === 'submitted'
                ? DOCUMENT_TYPE_LABELS[docStatus.documentType] ?? docStatus.documentType
                : 'No document submitted yet.'}
            </span>
            {docStatus.paths.length > 0 && (
              <div className="profile-doc-summary-actions">
                {docStatus.paths.map((path, i) => (
                  <button
                    key={path}
                    type="button"
                    className="identity-doc-view-btn"
                    onClick={() => onViewDocument(path)}
                    disabled={viewingPath === path}
                  >
                    {viewingPath === path ? 'Opening…' : `View ${i + 1}`}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// One "bordered field with visible focus state" — the Edit Address form's
// own look, distinct from the boxed-but-plainer inputs BookingForm/CartPage
// use, so it stays page-local instead of changing the shared ContactFields
// component. Renders a <select> when `options` is given, otherwise a text
// input; `icon`/`helper` are optional extras a handful of fields use.
function AddressField({
  label, value, onChange, error, required, inputMode,
  placeholder, helper, icon, options,
}) {
  return (
    <label className={`address-field${error ? ' has-error' : ''}`}>
      <span className="address-field-label">
        {label}
        {required && <span className="address-field-required"> *</span>}
      </span>
      <div className={`address-field-control${icon ? ' has-icon' : ''}`}>
        {icon && <span className="address-field-icon">{icon}</span>}
        {options ? (
          <select
            className={value ? '' : 'is-placeholder'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="" disabled>{placeholder ?? 'Select'}</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            inputMode={inputMode}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
      {helper && !error && <span className="address-field-helper">{helper}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M7 3h7l4 4v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M14 3v4h4" />
    </svg>
  );
}

function isImagePath(path) {
  return /\.(jpe?g|png)$/i.test(path);
}

// The Edit Profile form's document field. Fully controlled — `keptDocs`
// (already-submitted files not removed this session) and `pendingFiles`
// (freshly picked, not yet uploaded) both live in ProfilePage's own state
// and are only actually uploaded/committed when the whole form is saved,
// alongside the address fields. Same photo-grid look as Manage Camera's own
// photo upload: real thumbnails, a red "×" to remove one, a dashed "+" tile
// to add more (multiple at once). Existing (already-submitted) files live in
// a private bucket, so their thumbnails need a signed URL fetched first —
// pending ones just picked this session already have local bytes, so those
// preview instantly via an object URL. A non-image file (PDF) falls back to
// a generic file icon either way. Type-then-size validation runs the moment
// files are picked, before they're ever attached to the draft.
function IdentityDocumentField({
  documentType, onDocumentTypeChange,
  keptDocs, pendingFiles, onFilesPicked, onRemoveKept, onRemovePending,
  error, disabled,
}) {
  const [keptPreviews, setKeptPreviews] = useState({});

  useEffect(() => {
    let cancelled = false;
    keptDocs.forEach((doc) => {
      if (isImagePath(doc.path) && !(doc.path in keptPreviews)) {
        getSignedDocumentUrl(doc.path)
          .then((url) => {
            if (!cancelled) setKeptPreviews((prev) => ({ ...prev, [doc.path]: url }));
          })
          .catch(() => {});
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keptDocs]);

  function handleFileSelected(e) {
    onFilesPicked(e.target.files);
    e.target.value = ''; // lets picking the same file(s) again re-fire onChange
  }

  return (
    <div className="identity-doc-section">
      <h4 className="identity-doc-title">Identity Document</h4>
      <p className="identity-doc-description">
        Checked by our team during camera handover — kept private and secure.
      </p>

      <div className="identity-doc-form">
        <label className="identity-doc-field">
          <span>Document type</span>
          <div className="address-field-control">
            <select
              value={documentType}
              onChange={(e) => onDocumentTypeChange(e.target.value)}
              disabled={disabled}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </label>

        <label className="identity-doc-field">
          <span>
            Documents <span className="identity-doc-field-hint">(JPG, PNG or PDF, up to 5MB each)</span>
          </span>
          <div className="identity-doc-photo-grid">
            {keptDocs.map((doc, i) => (
              <span className="identity-doc-photo-preview" key={doc.path}>
                {keptPreviews[doc.path] ? (
                  <img src={keptPreviews[doc.path]} alt={doc.filename || `Document ${i + 1}`} />
                ) : (
                  <span className="identity-doc-file-icon"><FileIcon /></span>
                )}
                <CloseButton
                  className="identity-doc-photo-remove"
                  label={`Remove document ${i + 1}`}
                  onClick={() => onRemoveKept(doc.path)}
                  disabled={disabled}
                />
              </span>
            ))}
            {pendingFiles.map((p, i) => (
              <span className="identity-doc-photo-preview" key={p.previewUrl ?? p.file.name + i}>
                {p.previewUrl ? (
                  <img src={p.previewUrl} alt={p.file.name} />
                ) : (
                  <span className="identity-doc-file-icon"><FileIcon /></span>
                )}
                <CloseButton
                  className="identity-doc-photo-remove"
                  label={`Remove ${p.file.name}`}
                  onClick={() => onRemovePending(i)}
                  disabled={disabled}
                />
              </span>
            ))}
            <span className={`identity-doc-add-tile${error ? ' has-error' : ''}`}>
              <span aria-hidden="true">+</span>
              <input
                type="file"
                accept="image/jpeg,image/png,application/pdf"
                multiple
                disabled={disabled}
                onChange={handleFileSelected}
              />
            </span>
          </div>
        </label>
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user } = useAuth();
  const { showToast } = useCart(); // same shared toast used app-wide (cart/wishlist/review/logout)

  // Client-side toggle only — both tabs share this one route/page.
  const [tab, setTab] = useState('view');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // The last-saved values — what "Cancel" resets the draft back to, and
  // what the View tab displays.
  const [savedProfile, setSavedProfile] = useState(EMPTY_DRAFT);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const [docStatus, setDocStatus] = useState(null);
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0].value);
  // Already-submitted files not removed this edit session — [{ path, filename }].
  const [keptDocs, setKeptDocs] = useState([]);
  // Freshly picked, not yet uploaded this session — [{ file, previewUrl }].
  const [pendingFiles, setPendingFiles] = useState([]);
  const [viewingPath, setViewingPath] = useState(null);
  // { url, isPdf } for the in-page lightbox, or null — same pattern
  // BookingDetailsModal's admin document viewer uses.
  const [viewing, setViewing] = useState(null);

  // Revoke any still-outstanding preview URLs on unmount, same as
  // BookingDetailsModal's own pendingFiles cleanup — a ref mirrors state so
  // this (bound once) always sees the latest list.
  const pendingFilesRef = useRef(pendingFiles);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  useEffect(() => {
    return () => pendingFilesRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
  }, []);

  function setDraftField(field) {
    return (value) => setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function loadDocStatus() {
    return fetchMyIdentityDocumentStatus(user.id).then((status) => {
      setDocStatus(status);
      setDocType(status.documentType ?? DOCUMENT_TYPES[0].value);
      setKeptDocs(status.paths.map((path, i) => ({ path, filename: status.filenames[i] ?? null })));
      return status;
    });
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchMyProfile(user.id).then((profile) => {
        if (cancelled) return;
        const loaded = {
          fullName: profile.full_name ?? '',
          phone: profile.phone ?? '',
          pincode: profile.pincode ?? '',
          state: profile.state ?? '',
          addressLine: profile.address_line ?? '',
          locality: profile.locality ?? '',
          city: profile.city ?? '',
        };
        setSavedProfile(loaded);
        setDraft(loaded);
      }),
      loadDocStatus(),
    ])
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  function resetDraft() {
    setDraft(savedProfile);
    setDocType(docStatus?.documentType ?? DOCUMENT_TYPES[0].value);
    pendingFiles.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
    setPendingFiles([]);
    setKeptDocs((docStatus?.paths ?? []).map((path, i) => ({ path, filename: (docStatus?.filenames ?? [])[i] ?? null })));
    setFieldErrors({});
    setError(null);
  }

  function handleCancel() {
    resetDraft();
    setTab('view');
  }

  // Validates each newly picked/dropped file immediately; valid ones join
  // pendingFiles right away (an invalid one shows its reason inline and is
  // otherwise just skipped, not silently dropped without saying why).
  function handleDocFilesPicked(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    let firstError;
    const accepted = [];
    for (const file of files) {
      const validationError = validateDocumentFile(file);
      if (validationError) {
        firstError = firstError ?? validationError;
      } else {
        accepted.push(file);
      }
    }
    if (accepted.length) {
      setPendingFiles((prev) => [
        ...prev,
        ...accepted.map((file) => ({
          file,
          previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
        })),
      ]);
    }
    setFieldErrors((prev) => ({ ...prev, document: firstError ?? (accepted.length ? undefined : prev.document) }));
  }

  function removeKeptDoc(path) {
    setKeptDocs((prev) => prev.filter((d) => d.path !== path));
  }

  function removePendingFile(index) {
    setPendingFiles((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  async function handleViewDocument(path) {
    setViewingPath(path);
    try {
      const url = await getSignedDocumentUrl(path);
      setViewing({ url, isPdf: path.toLowerCase().endsWith('.pdf') });
    } catch (err) {
      setError(err.message || 'Could not open the document.');
    } finally {
      setViewingPath(null);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const totalDocs = keptDocs.length + pendingFiles.length;
    // Both fields are required together: a document type is always
    // selected (the dropdown defaults to the first option), so the only
    // real gap to catch is "no files attached, kept or new". A file-type/
    // size error from picking itself takes priority over that generic message.
    let documentError;
    if (fieldErrors.document && totalDocs === 0) {
      documentError = fieldErrors.document;
    } else if (totalDocs === 0) {
      documentError = 'Please attach at least one identity document.';
    }

    const errors = {
      fullName: getNameError(draft.fullName),
      phone: getPhoneError(draft.phone),
      pincode: requiredError(draft.pincode, 'Pincode'),
      state: requiredError(draft.state, 'State'),
      addressLine: requiredError(draft.addressLine, 'Address'),
      locality: requiredError(draft.locality, 'Locality/Town'),
      city: requiredError(draft.city, 'City/District'),
      document: documentError,
    };
    setFieldErrors(errors);
    if (Object.values(errors).some(Boolean)) return;

    setSaving(true);
    setError(null);
    try {
      await updateMyProfile(draft);
      const docsChanged = pendingFiles.length > 0
        || docType !== docStatus?.documentType
        || keptDocs.length !== (docStatus?.paths.length ?? 0);
      if (docsChanged) {
        await submitMyIdentityDocuments({
          userId: user.id,
          documentType: docType,
          keepPaths: keptDocs.map((d) => d.path),
          keepFilenames: keptDocs.map((d) => d.filename),
          newFiles: pendingFiles.map((p) => p.file),
        });
        pendingFiles.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl));
        setPendingFiles([]);
      }
      await loadDocStatus();
      setSavedProfile(draft);
      showToast('success', 'Profile updated');
      setTab('view');
    } catch (err) {
      setError(friendlyErrorMessage(err, 'Could not save your details.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="profile-page">
      <div className="profile-page-header">
        <h2>My Profile</h2>
        <Link to="/" className="back-to-cameras">Back to cameras</Link>
      </div>

      {loading ? (
        <Loading />
      ) : (
        <>
          <div className="profile-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'view'}
              className={`profile-tab${tab === 'view' ? ' is-active' : ''}`}
              onClick={() => setTab('view')}
            >
              View profile
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'edit'}
              className={`profile-tab${tab === 'edit' ? ' is-active' : ''}`}
              onClick={() => setTab('edit')}
            >
              Edit profile
            </button>
          </div>

          {error && <p className="error" role="alert">{error}</p>}

          {tab === 'view' ? (
            <ProfileView
              profile={savedProfile}
              docStatus={docStatus}
              onViewDocument={handleViewDocument}
              viewingPath={viewingPath}
            />
          ) : (
            <form className="address-edit-card" onSubmit={handleSubmit}>
              <h3 className="address-edit-title">Edit Profile</h3>

              <div className="address-edit-section">
                <div className="address-edit-grid">
                  <AddressField
                    label="Name" required
                    value={draft.fullName} onChange={setDraftField('fullName')} error={fieldErrors.fullName}
                    placeholder="Your full name"
                  />
                  <AddressField
                    label="Mobile" required inputMode="tel"
                    value={draft.phone} onChange={setDraftField('phone')} error={fieldErrors.phone}
                    placeholder="10-digit mobile number"
                    icon={<PhoneIcon />}
                  />
                </div>
              </div>

              <div className="address-edit-divider" />

              <div className="address-edit-section">
                <AddressField
                  label="Address (House No, Building, Street, Area)" required
                  value={draft.addressLine} onChange={setDraftField('addressLine')} error={fieldErrors.addressLine}
                  placeholder="1/243, Building name, Street, Area"
                />
                <div className="address-edit-grid">
                  <AddressField
                    label="Locality/ Town" required
                    value={draft.locality} onChange={setDraftField('locality')} error={fieldErrors.locality}
                    placeholder="e.g. Sembatti"
                  />
                  <AddressField
                    label="City/ District" required
                    value={draft.city} onChange={setDraftField('city')} error={fieldErrors.city}
                    placeholder="e.g. Dindigul"
                  />
                </div>
                <div className="address-edit-grid">
                  <AddressField
                    label="Pincode" required inputMode="numeric"
                    value={draft.pincode} onChange={setDraftField('pincode')} error={fieldErrors.pincode}
                    placeholder="e.g. 624707"
                  />
                  <AddressField
                    label="State" required
                    value={draft.state} onChange={setDraftField('state')} error={fieldErrors.state}
                    placeholder="Select state" options={INDIAN_STATES}
                  />
                </div>
              </div>

              <div className="address-edit-divider" />

              <div className="address-edit-section">
                <IdentityDocumentField
                  documentType={docType}
                  onDocumentTypeChange={setDocType}
                  keptDocs={keptDocs}
                  pendingFiles={pendingFiles}
                  onFilesPicked={handleDocFilesPicked}
                  onRemoveKept={removeKeptDoc}
                  onRemovePending={removePendingFile}
                  error={fieldErrors.document}
                  disabled={saving}
                />
              </div>

              <div className="address-edit-footer">
                <button type="button" className="address-edit-cancel" onClick={handleCancel} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="address-edit-save" disabled={saving}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </form>
          )}
        </>
      )}

      {viewing && (
        <Modal overlayClassName="doc-viewer-overlay" modalClassName="doc-viewer-modal" onClose={() => setViewing(null)}>
          <CloseButton className="doc-viewer-close" onClick={() => setViewing(null)} />
          {viewing.isPdf ? (
            <iframe src={viewing.url} title="Identity document" className="doc-viewer-frame" />
          ) : (
            <img src={viewing.url} alt="Identity document" className="doc-viewer-image" />
          )}
        </Modal>
      )}
    </div>
  );
}
