import { useEffect, useState } from 'react';
import { FileText, Download } from 'lucide-react';
import Modal from './Modal';
import CloseButton from './CloseButton';
import Button from './Button';
import { CheckIcon } from './icons';
import { getInvoiceFileSize, downloadInvoiceFile } from '../../lib/invoices';
import './BookingConfirmedPopup.css';

function formatFileSize(bytes) {
  if (!bytes) return null;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

// The downloadable-invoice file card — only rendered when the caller passes
// `invoice`. Size is fetched on mount since the caller only knows the storage
// path, not the byte count; shows a plain "PDF" fallback while that's pending
// (e.g. right after a full payment, before Storage has fully indexed it).
function InvoiceCard({ invoice }) {
  const [sizeLabel, setSizeLabel] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getInvoiceFileSize(invoice.path).then((bytes) => {
      if (!cancelled) setSizeLabel(formatFileSize(bytes));
    });
    return () => {
      cancelled = true;
    };
  }, [invoice.path]);

  async function handleDownload() {
    setDownloading(true);
    setError(null);
    try {
      await downloadInvoiceFile(invoice.path, invoice.filename);
    } catch (err) {
      setError(err.message || 'Could not download the invoice.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="booking-confirmed-invoice">
      <span className="booking-confirmed-invoice-icon">
        <FileText size={20} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div className="booking-confirmed-invoice-body">
        <span className="booking-confirmed-invoice-name">{invoice.filename}</span>
        <span className="booking-confirmed-invoice-meta">PDF{sizeLabel ? ` · ${sizeLabel}` : ''}</span>
      </div>
      <button
        type="button"
        className="booking-confirmed-invoice-download"
        onClick={handleDownload}
        disabled={downloading}
        aria-label="Download invoice"
      >
        <Download size={16} strokeWidth={2} aria-hidden="true" />
        {downloading ? 'Downloading…' : 'Download'}
      </button>
      {error && <p className="booking-confirmed-invoice-error" role="alert">{error}</p>}
    </div>
  );
}

// Booking-confirmation modal: icon → heading → a compact summary block →
// an optional downloadable-invoice card → a separate notice block → one
// primary action. Generic enough to reuse anywhere a booking gets confirmed
// (currently just BookingForm's success state) — pass whatever summary rows
// apply, plus `invoice` once one's been generated for this booking.
export default function BookingConfirmedPopup({
  heading = 'Booking Confirmed',
  rows, // [{ label, value }]
  invoice, // { path, filename } | undefined — omit while none exists yet
  notice,
  primaryLabel = 'View my bookings',
  onPrimaryAction,
  onClose,
}) {
  return (
    <Modal
      overlayClassName="booking-confirmed-overlay"
      modalClassName="booking-confirmed-card"
      onClose={onClose}
    >
      <CloseButton className="booking-confirmed-close" onClick={onClose} />

      <div className="booking-confirmed-icon">
        <CheckIcon size={26} />
      </div>

      <h3 className="booking-confirmed-heading">{heading}</h3>

      <div className="booking-confirmed-summary">
        {rows.map((row) => (
          <div className="booking-confirmed-summary-row" key={row.label}>
            <span className="booking-confirmed-summary-label">{row.label}</span>
            <span className="booking-confirmed-summary-value">{row.value}</span>
          </div>
        ))}
      </div>

      {invoice && <InvoiceCard invoice={invoice} />}

      {notice && <div className="booking-confirmed-notice">{notice}</div>}

      <Button type="button" className="booking-confirmed-cta" onClick={onPrimaryAction}>
        {primaryLabel}
      </Button>
    </Modal>
  );
}
