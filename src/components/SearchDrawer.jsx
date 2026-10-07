import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSearchUI } from '../lib/useSearchUI';
import { useRentalRange } from '../lib/useRentalRange';
import { fetchActiveCameras } from '../lib/cameras';
import { getBookedQuantitiesByCamera } from '../lib/availability';
import { getCameraPhotoUrl } from '../lib/cameraPhotos';
import { formatPrice } from '../lib/common';
import { SearchIcon } from './ui/icons';
import CloseButton from './ui/CloseButton';
import './SearchDrawer.css';

// Slide-in catalogue search, opened from the navbar's search icon. Mirrors
// CartDrawer's drawer chrome (backdrop, slide-in aside, Escape-to-close) —
// only the header/body content differs.
export default function SearchDrawer() {
  const { isOpen, setIsOpen } = useSearchUI();
  const { range, hasPicked } = useRentalRange();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [query, setQuery] = useState('');
  const [cameras, setCameras] = useState(null); // null = not loaded yet
  const [bookedQuantities, setBookedQuantities] = useState({});
  const [error, setError] = useState(null);

  function close() {
    setIsOpen(false);
    setQuery('');
  }

  // Load the catalogue lazily, the first time the drawer is opened.
  useEffect(() => {
    if (!isOpen || cameras !== null) return;
    let cancelled = false;
    fetchActiveCameras()
      .then((data) => {
        if (!cancelled) setCameras(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, cameras]);

  // How many units are actually free for the currently selected rental
  // dates — same source as the main catalogue (CameraList.jsx) — so "in
  // stock" here can't say more units are free than really are. Only
  // meaningful once the customer has actually picked dates (hasPicked) —
  // `range` alone is seeded with a today/tomorrow default before that, which
  // isn't a real query the customer asked for, so we skip the fetch and hide
  // the stock line entirely until then (see the hasPicked check in render).
  useEffect(() => {
    if (!isOpen || !range || !hasPicked) return;
    let cancelled = false;
    getBookedQuantitiesByCamera(range.start, range.end)
      .then((data) => {
        if (!cancelled) setBookedQuantities(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, range, hasPicked]);

  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const trimmedQuery = query.trim();
  // Short terms (1-2 letters) match almost every camera, so we hold off
  // filtering until there's enough to actually narrow things down.
  const isTooShort = trimmedQuery.length > 0 && trimmedQuery.length < 3;
  const searchActive = trimmedQuery.length >= 3;

  const camerasWithAvailability = useMemo(() => {
    if (!cameras) return [];
    return cameras.map((c) => ({
      ...c,
      unitsAvailable: Math.max(0, (c.stock_quantity ?? 0) - (bookedQuantities[c.id] ?? 0)),
    }));
  }, [cameras, bookedQuantities]);

  const results = useMemo(() => {
    if (!searchActive) return camerasWithAvailability; // nothing typed yet — this is the "Popular Items" list
    const q = trimmedQuery.toLowerCase();
    return camerasWithAvailability.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.model ?? '').toLowerCase().includes(q)
    );
  }, [camerasWithAvailability, trimmedQuery, searchActive]);

  const noResults = searchActive && cameras !== null && results.length === 0;

  function openCamera(camera) {
    close();
    navigate(`/camera/${camera.id}?start=${range.start}&end=${range.end}`);
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="search-drawer-backdrop" onClick={close} />
      <aside className="search-drawer" role="dialog" aria-modal="true" aria-label="Search cameras">
        <div className="search-drawer-header">
          <CloseButton className="search-drawer-close" label="Close search" onClick={close} />
          <h2>Search Products</h2>
        </div>

        <div className={`search-drawer-searchbox${isTooShort || noResults ? ' flagged' : ''}`}>
          <div className="search-drawer-form">
            <span className="search-drawer-form-icon">
              <SearchIcon size={14} />
            </span>
            <input
              ref={inputRef}
              type="search"
              placeholder="Search for cameras"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <CloseButton
                className="search-drawer-input-clear"
                label="Clear search text"
                onClick={() => setQuery('')}
              />
            )}
          </div>

          {isTooShort && (
            <p className="search-drawer-hint">Type at least 3 letters to search</p>
          )}
          {noResults && (
            <p className="search-drawer-hint">No products match "{trimmedQuery}"</p>
          )}
        </div>

        {!isTooShort && !noResults && (
          <p className="search-drawer-section-label">
            {searchActive ? 'Results' : 'Popular Items'}
          </p>
        )}

        <div className="search-drawer-list">
          {error ? (
            <p role="alert" className="search-drawer-empty">
              Couldn't load cameras: {error}
            </p>
          ) : cameras === null ? (
            <p className="search-drawer-empty">Loading…</p>
          ) : isTooShort ? (
            <div className="search-drawer-status">
              <span className="search-drawer-status-icon">
                <SearchIcon size={20} />
              </span>
              <h3>Keep typing — 3 letters or more</h3>
              <p>Short terms match almost everything, so we wait for a few more characters.</p>
            </div>
          ) : noResults ? (
            <div className="search-drawer-status">
              <span className="search-drawer-status-icon">
                <SearchIcon size={20} />
              </span>
              <h3>No results for "{trimmedQuery}"</h3>
              <p>Try a shorter term or a different spelling — or browse the popular items below.</p>
              <button
                type="button"
                className="search-drawer-clear-btn"
                onClick={() => setQuery('')}
              >
                Clear search
              </button>
            </div>
          ) : (
            results.map((camera) => {
              const photo = getCameraPhotoUrl(camera);
              return (
                <button
                  key={camera.id}
                  type="button"
                  className="search-drawer-row"
                  onClick={() => openCamera(camera)}
                >
                  {photo ? (
                    <img src={photo} alt={camera.name} />
                  ) : (
                    <div className="search-drawer-thumb-empty" />
                  )}
                  <div className="search-drawer-row-main">
                    <span className="search-drawer-row-name">{camera.name}</span>
                    <span className="search-drawer-row-model">{camera.model}</span>
                    {hasPicked && (
                      <span className={`search-drawer-row-stock${camera.unitsAvailable > 0 ? '' : ' is-off'}`}>
                        {camera.unitsAvailable > 0
                          ? `${camera.unitsAvailable} in stock`
                          : 'Unavailable for these dates'}
                      </span>
                    )}
                  </div>
                  <span className="search-drawer-row-price">
                    {formatPrice(camera.price)}
                    <span className="search-drawer-row-price-unit">/day</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
