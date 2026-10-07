import { useEffect, useState } from 'react';
import { fetchActiveCameras } from '../lib/cameras';
import Modal from './ui/Modal';
import CloseButton from './ui/CloseButton';
import Button from './ui/Button';
import Loading from './ui/Loading';
import './HoldBookingCameraPicker.css';

// First step of the "Hold Booking" flow launched from Booking Management —
// picks which camera to block dates on, then hands off to the existing
// CameraAvailabilityModal (calendar + block-dates form) for that camera.
// Previously this whole flow only opened from a per-camera row in Camera
// Management; this is just the new camera-selection step that lets it start
// from Booking Management instead, without changing CameraAvailabilityModal
// itself at all.
export default function HoldBookingCameraPicker({ onSelect, onClose }) {
  const [cameras, setCameras] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cameraId, setCameraId] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetchActiveCameras()
      .then((data) => {
        if (cancelled) return;
        setCameras(data);
        if (data.length > 0) setCameraId(data[0].id);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load cameras.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleContinue() {
    const camera = cameras.find((c) => c.id === cameraId);
    if (camera) onSelect(camera);
  }

  return (
    <Modal overlayClassName="hold-booking-picker-overlay" modalClassName="hold-booking-picker-modal" onClose={onClose}>
      <CloseButton className="hold-booking-picker-close" onClick={onClose} />
      <h3>Hold Booking</h3>
      <p className="hint">Select a camera to block dates for maintenance or a walk-in booking.</p>

      {loading ? (
        <Loading />
      ) : error ? (
        <p className="error" role="alert">{error}</p>
      ) : cameras.length === 0 ? (
        <p className="hint">No active cameras to hold.</p>
      ) : (
        <>
          <label>
            Camera
            <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.model ? ` — ${c.model}` : ''}
                </option>
              ))}
            </select>
          </label>
          <div className="hold-booking-picker-actions">
            <Button type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" className="hold-booking-picker-continue" onClick={handleContinue}>
              Continue
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
