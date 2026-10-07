import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import { formatPrice } from '../lib/common';
import { useActionToast } from '../lib/useActionToast';
import AddCameraForm from './AddCameraForm';
import CameraAvailabilityModal from './CameraAvailabilityModal';
import Modal from './ui/Modal';
import ConfirmDialog from './ui/ConfirmDialog';
import StatusBadge from './ui/StatusBadge';
import Loading from './ui/Loading';
import ActionToast from './ui/ActionToast';
import TabGroup from './ui/TabGroup';
import { SearchIcon, CalendarIcon } from './ui/icons';
import Pagination from './ui/Pagination';
import './CameraManager.css';

const CAMERAS_PER_PAGE = 10;
const STATUS_FILTERS = ['all', 'active', 'retired'];

export default function CameraManager({ onBack, initialFilter }) {
  const [cameras, setCameras] = useState([]);
  const [search, setSearch] = useState('');
  // Deep-linked from an Overview stat card (?tab=cameras&status=...) — falls
  // back to 'all' (today's only behavior) when absent or unrecognized.
  const [filter, setFilter] = useState(STATUS_FILTERS.includes(initialFilter) ? initialFilter : 'all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatingId, setUpdatingId] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingCamera, setEditingCamera] = useState(null);
  // True when the edit modal was opened via the ↺ Restore button rather than
  // the pencil — saving then also flips the camera back to active, so a
  // retired camera's stale details (e.g. a leftover ₹0 price) can be fixed
  // as part of bringing it back instead of silently reactivating as-is.
  const [restoreMode, setRestoreMode] = useState(false);
  const [confirmCamera, setConfirmCamera] = useState(null);
  // Confirmation gate shown before the restore (↺) button opens the edit
  // form — mirrors Remove's "ask first" step instead of jumping straight
  // into editing details.
  const [restoreConfirmCamera, setRestoreConfirmCamera] = useState(null);
  // The camera whose "View availability" calendar + block-dates modal is
  // open, or null. Retired cameras don't get this action — admin_block_camera
  // refuses a non-active camera the same way request_booking/create_booking_hold do.
  const [availabilityCamera, setAvailabilityCamera] = useState(null);
  const { toast, notify, close: closeToast } = useActionToast();

  function closeEditModal() {
    setEditingCamera(null);
    setRestoreMode(false);
  }

  async function loadCameras() {
    setLoading(true);
    const { data, error: fetchError } = await supabase
      .from('cameras')
      .select('id, name, model, description, features, status, image_url, photos, stock_quantity, price')
      .order('name');
    if (fetchError) {
      setError(fetchError.message);
    } else {
      // Removed ("retired") cameras sort to the very end, active ones
      // first — .sort() is stable, so within each group the alphabetical
      // order from .order('name') above is preserved, not re-shuffled.
      const sorted = [...data].sort(
        (a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1)
      );
      setCameras(sorted);
    }
    setLoading(false);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCameras();
  }, []);

  const filteredCameras = (() => {
    const q = search.trim().toLowerCase();
    return cameras.filter((c) => {
      if (filter !== 'all' && c.status !== filter) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.model?.toLowerCase().includes(q))) return false;
      return true;
    });
  })();

  const totalPages = Math.max(1, Math.ceil(filteredCameras.length / CAMERAS_PER_PAGE));
  const pageCameras = filteredCameras.slice((page - 1) * CAMERAS_PER_PAGE, page * CAMERAS_PER_PAGE);

  // Keeps the current page valid if the list shrinks (e.g. a reload while
  // on the last page removes its only row) — doesn't otherwise move the
  // admin off whatever page they're on.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // A new search or filter always starts back at page 1 — staying on, say,
  // page 3 of the old results would usually just show an empty page for the
  // (typically shorter) new set.
  useEffect(() => {
    setPage(1);
  }, [search, filter]);

  // Rendered both above and below the table — computed once so the two
  // spots can't drift apart.
  const paginationControl = totalPages > 1 && (
    <Pagination
      page={page}
      totalPages={totalPages}
      onPrev={() => setPage((p) => Math.max(1, p - 1))}
      onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
      onSelect={setPage}
    />
  );

  async function handleConfirmRemove() {
    const camera = confirmCamera;
    setError(null);
    setUpdatingId(camera.id);

    // Cancels any live booking on this camera, attempts a refund for any of
    // them with a captured payment, and emails the affected customers either
    // way — see supabase/functions/retire-camera.
    const { data, error: fnError } = await supabase.functions.invoke('retire-camera', {
      body: { cameraId: camera.id },
    });

    setUpdatingId(null);
    setConfirmCamera(null);

    if (fnError || data?.error) {
      setError(data?.error ?? fnError.message);
      return;
    }

    loadCameras();
    const parts = [`${camera.name} removed`];
    if (data.refunded) parts.push(`${data.refunded} refund${data.refunded > 1 ? 's' : ''} issued`);
    if (data.refund_pending) parts.push(`${data.refund_pending} refund${data.refund_pending > 1 ? 's' : ''} pending`);
    if (data.cancelled_no_payment) parts.push(`${data.cancelled_no_payment} booking${data.cancelled_no_payment > 1 ? 's' : ''} cancelled`);
    notify(parts.join(' — '), 'warning');
  }

  function handleConfirmRestore() {
    setEditingCamera(restoreConfirmCamera);
    setRestoreMode(true);
    setRestoreConfirmCamera(null);
  }

  return (
    <div className="camera-manager">
      <ActionToast toast={toast} onClose={closeToast} />

      {onBack && (
        <button type="button" className="admin-back-link" onClick={onBack}>
          ← Back to Overview
        </button>
      )}

      <div className="camera-manager-header">
        <h2>Manage Camera</h2>
        <div className="camera-manager-header-actions">
          <div className="camera-manager-search">
            <SearchIcon size={16} />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cameras…"
              aria-label="Search cameras"
            />
          </div>
          {!showAddForm && (
            <button type="button" onClick={() => setShowAddForm(true)}>
              + Add camera
            </button>
          )}
        </div>
      </div>

      <TabGroup className="filter-tabs" items={STATUS_FILTERS} activeId={filter} onSelect={setFilter} />

      {showAddForm && (
        <Modal
          overlayClassName="camera-add-overlay"
          modalClassName="camera-add-modal"
          onClose={() => setShowAddForm(false)}
        >
          <AddCameraForm
            onAdded={({ name }) => {
              notify(`${name} added`, 'success');
              loadCameras();
              setShowAddForm(false);
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </Modal>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {loading && <Loading />}

      {!loading && (
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Camera</th>
              <th>Status</th>
              <th>Stock</th>
              <th>Price</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageCameras.map((c) => {
              const photo = getCameraPhotoUrl(c);
              const isActive = c.status === 'active';
              return (
                <tr key={c.id}>
                  <td>
                    <div className="camera-manager-cell">
                      {photo ? (
                        <img src={photo} alt={c.name} />
                      ) : (
                        <div className="camera-manager-thumb-empty" />
                      )}
                      <div>
                        <span className="camera-manager-name">{c.name}</span>
                        <span className="camera-manager-model">{c.model}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={c.status} />
                  </td>
                  <td>
                    <span>{c.stock_quantity}</span>
                  </td>
                  <td>
                    <span>{formatPrice(c.price ?? 0)}</span>
                  </td>
                  <td className="row-actions">
                    <div className="row-actions-inner">
                      {isActive && (
                        <button
                          type="button"
                          className="camera-availability-btn"
                          onClick={() => setAvailabilityCamera(c)}
                          aria-label="View availability"
                          title="View availability"
                        >
                          <CalendarIcon />
                        </button>
                      )}
                      <button
                        type="button"
                        className="camera-stock-edit-btn"
                        onClick={() => {
                          setEditingCamera(c);
                          setRestoreMode(false);
                        }}
                        aria-label="Edit camera"
                        title="Edit camera"
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                          <path
                            d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <button
                        type="button"
                        className={isActive ? 'camera-remove-btn' : 'camera-restore-btn'}
                        onClick={() => {
                          if (isActive) {
                            setConfirmCamera(c);
                          } else {
                            setRestoreConfirmCamera(c);
                          }
                        }}
                        aria-label={isActive ? 'Remove' : 'Restore'}
                        title={isActive ? 'Remove' : 'Restore'}
                      >
                        {isActive ? (
                          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path
                              d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2m-8 0 1 12a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2l1-12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                            <path
                              d="M3 12a9 9 0 1 0 3-6.7M3 3v5h5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        )}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {filteredCameras.length === 0 && (
              <tr>
                <td colSpan={5}>
                  {search.trim()
                    ? 'No cameras match your search.'
                    : filter !== 'all'
                      ? `No ${filter} cameras.`
                      : 'No cameras yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      )}

      {!loading && paginationControl}

      {editingCamera && (
        <Modal
          overlayClassName="camera-add-overlay"
          modalClassName="camera-add-modal"
          onClose={closeEditModal}
        >
          <AddCameraForm
            camera={editingCamera}
            restoring={restoreMode}
            onAdded={({ name }) => {
              notify(restoreMode ? `${name} restored` : 'Changes saved', 'success');
              loadCameras();
              closeEditModal();
            }}
            onCancel={closeEditModal}
          />
        </Modal>
      )}

      {confirmCamera && (
        <ConfirmDialog
          overlayClassName="camera-stock-overlay"
          modalClassName="camera-stock-modal"
          actionsClassName="camera-stock-modal-actions"
          confirmClassName="camera-stock-modal-danger"
          cancelClassName="camera-stock-modal-cancel"
          title={`Remove ${confirmCamera.name}?`}
          description="This camera will no longer be available to customers. You can restore it later."
          confirmLabel="Remove"
          confirmBusyLabel="Removing…"
          busy={updatingId === confirmCamera.id}
          onConfirm={handleConfirmRemove}
          onCancel={() => setConfirmCamera(null)}
        />
      )}

      {restoreConfirmCamera && (
        <ConfirmDialog
          overlayClassName="camera-stock-overlay"
          modalClassName="camera-stock-modal"
          actionsClassName="camera-stock-modal-actions"
          confirmClassName=""
          cancelClassName="camera-stock-modal-cancel"
          title={`Restore ${restoreConfirmCamera.name}?`}
          description="Customers will be able to book it again. You'll get a chance to review its details first."
          confirmLabel="Continue"
          onConfirm={handleConfirmRestore}
          onCancel={() => setRestoreConfirmCamera(null)}
        />
      )}

      {availabilityCamera && (
        <CameraAvailabilityModal
          camera={availabilityCamera}
          onClose={() => setAvailabilityCamera(null)}
        />
      )}
    </div>
  );
}
