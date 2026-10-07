import Modal from './Modal';
import CloseButton from './CloseButton';
import Button from './Button';
import { WarningIcon } from './icons';
import './MessagePopup.css';

// A small centered popup for a single interruption message — payment
// cancelled, a failed charge, etc. — with a dismiss × top-right and one
// full-width OK button. Rendered via Modal's portal so it always centers
// over the whole page regardless of where it's mounted (see Modal.jsx).
export default function MessagePopup({
  message,
  title = 'Something Went Wrong',
  tone = 'error',
  onClose,
}) {
  if (!message) return null;
  return (
    <Modal
      overlayClassName="message-popup-overlay"
      modalClassName={`message-popup message-popup-${tone}`}
      onClose={onClose}
    >
      <CloseButton className="message-popup-close" onClick={onClose} />
      <div className="message-popup-icon">
        <WarningIcon />
      </div>
      <h3 className="message-popup-title">{title}</h3>
      <p className="message-popup-text" role="alert">
        {message}
      </p>
      <Button type="button" className="message-popup-ok" onClick={onClose}>
        OK
      </Button>
    </Modal>
  );
}
