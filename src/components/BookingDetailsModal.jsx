import { useEffect, useRef, useState } from 'react';
import {
  User, Mail, Phone, Camera, Package, CalendarDays,
  CheckCircle2, CreditCard, IndianRupee, FileText, Wrench,
} from 'lucide-react';
import Modal from './ui/Modal';
import CloseButton from './ui/CloseButton';
import { formatDate } from '../lib/dateUtils';
import { formatPrice } from '../lib/common';
import { ADMIN_PAYMENT_LABELS } from '../lib/adminPaymentLabels';
import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  getSignedDocumentUrl,
  adminSetBookingDocument,
} from '../lib/identityDocument';
import './BookingDetailsModal.css';

// One icon + label + value row — every plain field in this modal uses this,
// so the icon/bold-value treatment stays identical across all of them.
function DetailItem({ icon: Icon, label, value, full }) {
  return (
    <div className={full ? 'booking-details-item booking-details-item-doc' : 'booking-details-item'}>
      <span className="booking-details-icon"><Icon size={16} /></span>
      <div className="booking-details-item-text">
        <span className="booking-details-label">{label}</span>
        <span className="booking-details-value">{value}</span>
      </div>
    </div>
  );
}

// Full booking + customer + identity-document view, opened from a "View
// Details" link in AdminPanel.jsx's booking table. The admin can add,
// replace, or remove a booking's document images here at any time — not
// just when none exist yet — scoped to this booking only (never touches
// the customer's profile). Newly picked files stay local (just object-URL
// previews) until "Save changes" actually uploads and commits them.
export default function BookingDetailsModal({ booking, onClose, onDocumentUploaded }) {
  const [loadingDoc, setLoadingDoc] = useState(null); // the path currently being opened, or null
  const [docError, setDocError] = useState(null);
  const [viewing, setViewing] = useState(null); // { url, isPdf } for the in-page lightbox, or null

  const [editingDocs, setEditingDocs] = useState(false);
  const [docType, setDocType] = useState(DOCUMENT_TYPES[0].value);
  const [keptPaths, setKeptPaths] = useState([]); // existing paths not removed during this edit
  const [pendingFiles, setPendingFiles] = useState([]); // newly picked, not-yet-uploaded [{ file, previewUrl }]
  const [savingDocs, setSavingDocs] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const fileInputRef = useRef(null);

  const documentUrls = booking.identity_document_urls ?? [];
  const hasDocs = documentUrls.length > 0;

  // Revoke any still-outstanding preview URLs on unmount — covers closing the
  // modal (Close button or backdrop) mid-edit, not just Cancel/Save, which
  // otherwise never revoke and leak. Ref mirrors state so the cleanup (bound
  // once) always sees the latest pendingFiles, same pattern as AddCameraForm.
  const pendingFilesRef = useRef(pendingFiles);
  useEffect(() => {
    pendingFilesRef.current = pendingFiles;
  }, [pendingFiles]);
  useEffect(() => {
    return () => pendingFilesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl));
  }, []);

  async function handleViewDocument(path) {
    setLoadingDoc(path);
    setDocError(null);
    try {
      const url = await getSignedDocumentUrl(path);
      setViewing({ url, isPdf: path.toLowerCase().endsWith('.pdf') });
    } catch (err) {
      setDocError(err.message || 'Could not open the document.');
    } finally {
      setLoadingDoc(null);
    }
  }

  function startEditingDocs() {
    setKeptPaths(documentUrls);
    setPendingFiles([]);
    setDocType(booking.identity_document_type || DOCUMENT_TYPES[0].value);
    setSaveError(null);
    setDocError(null);
    setEditingDocs(true);
  }

  function cancelEditingDocs() {
    pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    setPendingFiles([]);
    setKeptPaths([]);
    setEditingDocs(false);
  }

  function handleFilesPicked(e) {
    const selected = Array.from(e.target.files || []);
    e.target.value = ''; // lets picking the same file again re-fire onChange
    if (!selected.length) return;
    setPendingFiles((prev) => [
      ...prev,
      ...selected.map((file) => ({ file, previewUrl: URL.createObjectURL(file) })),
    ]);
  }

  function removeKeptPath(path) {
    setKeptPaths((prev) => prev.filter((p) => p !== path));
  }

  function removePendingFile(index) {
    setPendingFiles((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }

  async function handleSaveDocuments() {
    if (keptPaths.length + pendingFiles.length === 0) {
      setSaveError('Add at least one document.');
      return;
    }
    setSavingDocs(true);
    setSaveError(null);
    try {
      const allPaths = await adminSetBookingDocument({
        bookingId: booking.id,
        documentType: docType,
        keepPaths: keptPaths,
        newFiles: pendingFiles.map((p) => p.file),
      });
      pendingFiles.forEach((p) => URL.revokeObjectURL(p.previewUrl));
      setPendingFiles([]);
      setEditingDocs(false);
      onDocumentUploaded(booking.id, docType, allPaths);
    } catch (err) {
      setSaveError(err.message || 'Could not save the document changes.');
    } finally {
      setSavingDocs(false);
    }
  }

  return (
    <Modal overlayClassName="booking-details-overlay" modalClassName="booking-details-modal" onClose={onClose}>
      <h3>Booking Details</h3>

      <div className="booking-details-grid">
        {booking.hold_type === 'maintenance' ? (
          <DetailItem full icon={Wrench} label="Maintenance Reason" value={booking.maintenance_note || '—'} />
        ) : (
          <>
            <DetailItem icon={User} label="Customer Name" value={booking.customer_name || '—'} />
            <DetailItem icon={Mail} label="Email" value={booking.profiles?.email || '—'} />
            <DetailItem icon={Phone} label="Phone" value={booking.customer_phone || '—'} />
          </>
        )}
        <DetailItem icon={Camera} label="Camera Name" value={booking.cameras?.name ?? 'Unknown camera'} />
        <DetailItem icon={Package} label="Quantity" value={booking.quantity ?? 1} />
        <DetailItem icon={CalendarDays} label="Rental Start Date" value={formatDate(booking.start_date)} />
        <DetailItem icon={CalendarDays} label="Rental End Date" value={formatDate(booking.end_date)} />
        <DetailItem icon={CheckCircle2} label="Booking Status" value={<span className="booking-details-status">{booking.status}</span>} />
        {booking.hold_type !== 'maintenance' && (
          <>
            <DetailItem
              icon={CreditCard}
              label="Payment Status"
              value={
                booking.payment_status && booking.payment_status !== 'unpaid'
                  ? ADMIN_PAYMENT_LABELS[booking.payment_status] ?? booking.payment_status
                  : '—'
              }
            />
            <DetailItem
              icon={IndianRupee}
              label="Amount Paid / Total"
              value={`${formatPrice(booking.amount_paid ?? 0)} / ${formatPrice(booking.amount_total ?? 0)}`}
            />
          </>
        )}

        {booking.hold_type !== 'maintenance' && (
        <div className="booking-details-item booking-details-item-doc">
          <span className="booking-details-icon"><FileText size={16} /></span>
          <div className="booking-details-item-text">
          <span className="booking-details-label">Document Type</span>
          <span className="booking-details-value">
            {booking.identity_document_type
              ? DOCUMENT_TYPE_LABELS[booking.identity_document_type] ?? booking.identity_document_type
              : 'Not submitted'}
          </span>

          {!editingDocs ? (
            <div className="admin-doc-view-list">
              {documentUrls.map((path, i) => (
                <button
                  key={path}
                  type="button"
                  className="view-document-btn"
                  onClick={() => handleViewDocument(path)}
                  disabled={loadingDoc === path}
                >
                  {loadingDoc === path ? 'Opening…' : `View ${i + 1}`}
                </button>
              ))}
              <button type="button" className="view-document-btn" onClick={startEditingDocs}>
                {hasDocs ? 'Edit' : 'Upload document'}
              </button>
            </div>
          ) : (
            <div className="admin-doc-upload">
              <div className="admin-doc-upload-row">
                <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={savingDocs}>
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="view-document-btn"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={savingDocs}
                >
                  Choose files
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="admin-doc-upload-input"
                  disabled={savingDocs}
                  onChange={handleFilesPicked}
                />
              </div>

              {(keptPaths.length > 0 || pendingFiles.length > 0) && (
                <div className="admin-doc-preview-row">
                  {keptPaths.map((path, i) => (
                    <div className="admin-doc-preview" key={path}>
                      <button
                        type="button"
                        className="admin-doc-preview-remove"
                        aria-label={`Remove document ${i + 1}`}
                        onClick={() => removeKeptPath(path)}
                        disabled={savingDocs}
                      >
                        ×
                      </button>
                      <span className="admin-doc-preview-file">Doc {i + 1}</span>
                    </div>
                  ))}
                  {pendingFiles.map((p, i) => (
                    <div className="admin-doc-preview" key={p.previewUrl}>
                      <button
                        type="button"
                        className="admin-doc-preview-remove"
                        aria-label={`Remove ${p.file.name}`}
                        onClick={() => removePendingFile(i)}
                        disabled={savingDocs}
                      >
                        ×
                      </button>
                      {p.file.type.startsWith('image/') ? (
                        <img src={p.previewUrl} alt={p.file.name} />
                      ) : (
                        <span className="admin-doc-preview-file">PDF</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="admin-doc-edit-actions">
                <button type="button" className="admin-doc-cancel-btn" onClick={cancelEditingDocs} disabled={savingDocs}>
                  Cancel
                </button>
                <button type="button" className="admin-doc-submit-btn" onClick={handleSaveDocuments} disabled={savingDocs}>
                  {savingDocs ? 'Saving…' : 'Save changes'}
                </button>
              </div>
              {saveError && <p className="error" role="alert">{saveError}</p>}
            </div>
          )}
          {docError && <p className="error" role="alert">{docError}</p>}
          </div>
        </div>
        )}
      </div>

      <div className="booking-details-footer">
        <button type="button" onClick={onClose}>Close</button>
      </div>

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
    </Modal>
  );
}
