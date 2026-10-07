import Button from './Button';
import Modal from './Modal';
import './ConfirmDialog.css';

// "Are you sure?" dialog: title + description + confirm/cancel actions,
// with a busy state that disables both buttons and swaps the confirm label.
// className props default to this component's own styling but can be
// overridden so existing call sites keep their exact current look.
export default function ConfirmDialog({
  title,
  description,
  icon,
  children,
  confirmLabel = 'Confirm',
  confirmBusyLabel = 'Working…',
  cancelLabel = 'Cancel',
  confirmDisabled = false,
  busy = false,
  onConfirm,
  onCancel,
  overlayClassName = 'confirm-overlay',
  modalClassName = 'confirm-modal',
  actionsClassName = 'confirm-modal-actions',
  confirmClassName = 'confirm-modal-danger',
  cancelClassName = 'confirm-modal-cancel',
}) {
  return (
    <Modal
      overlayClassName={overlayClassName}
      modalClassName={modalClassName}
      onClose={() => !busy && onCancel()}
    >
      {icon && <div className="confirm-modal-icon">{icon}</div>}
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {/* Extra content between the description and the action buttons — e.g.
          the pickup-code input on the "Mark handed over" confirmation. Most
          callers don't pass this. */}
      {children}
      <div className={actionsClassName}>
        <Button type="button" className={confirmClassName} onClick={onConfirm} disabled={busy || confirmDisabled}>
          {busy ? confirmBusyLabel : confirmLabel}
        </Button>
        <Button type="button" className={cancelClassName} onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
      </div>
    </Modal>
  );
}
