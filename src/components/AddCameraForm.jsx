import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { getCameraPhotos } from '../lib/cameraPhotos';
import CloseButton from './ui/CloseButton';
import './AddCameraForm.css';

function getNameError(name) {
  if (!name.trim()) return 'Camera name is required.';
  return undefined;
}

function getModelError(model) {
  if (!model.trim()) return 'Model / type is required.';
  return undefined;
}

function getPhotoError(totalPhotoCount) {
  if (totalPhotoCount === 0) return 'At least one photo is required.';
  return undefined;
}

function getDescriptionError(description) {
  if (!description.trim()) return 'Description is required.';
  return undefined;
}

function getFeaturesError(features) {
  if (!features.trim()) return 'Product features are required.';
  return undefined;
}

function getStockError(stockQuantity) {
  if (!stockQuantity.trim()) return 'Stock quantity is required.';
  const stock = Number(stockQuantity);
  if (!Number.isInteger(stock) || stock < 0) {
    return 'Stock quantity must be a whole number of 0 or more.';
  }
  return undefined;
}

function getPriceError(price) {
  if (!price.trim()) return 'Price is required.';
  const value = Number(price);
  if (!Number.isFinite(value) || value < 0) {
    return 'Price must be a number of 0 or more.';
  }
  return undefined;
}

export default function AddCameraForm({ camera, restoring = false, onAdded, onCancel }) {
  const isEditing = Boolean(camera);
  const [name, setName] = useState(camera?.name ?? '');
  const [model, setModel] = useState(camera?.model ?? '');
  const [description, setDescription] = useState(camera?.description ?? '');
  const [features, setFeatures] = useState(camera?.features ?? '');
  const [stockQuantity, setStockQuantity] = useState(String(camera?.stock_quantity ?? '1'));
  const [price, setPrice] = useState(String(camera?.price ?? '0'));
  // Existing photo URLs kept from before (edit mode only — removable one at
  // a time) and newly-picked local files (uploaded on submit), plus their
  // object-URL previews, in parallel arrays.
  const [existingPhotos, setExistingPhotos] = useState(() => (isEditing ? getCameraPhotos(camera) : []));
  const [newPhotos, setNewPhotos] = useState([]);
  const [newPreviews, setNewPreviews] = useState([]);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const totalPhotoCount = existingPhotos.length + newPhotos.length;

  // Revokes whatever previews are still around when the form unmounts. Kept
  // in a ref so this cleanup — registered once — always sees the latest
  // array rather than the empty one from the first render (see the same
  // pattern for `rangeRef` in CameraList.jsx).
  const newPreviewsRef = useRef(newPreviews);
  useEffect(() => {
    newPreviewsRef.current = newPreviews;
  }, [newPreviews]);
  useEffect(() => {
    return () => newPreviewsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  function handlePhotosChange(e) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // lets the same file be picked again after being removed
    if (files.length === 0) return;
    setNewPhotos((prev) => [...prev, ...files]);
    setNewPreviews((prev) => [...prev, ...files.map((f) => URL.createObjectURL(f))]);
    if (fieldErrors.photo) {
      setFieldErrors((prev) => ({ ...prev, photo: getPhotoError(totalPhotoCount + files.length) }));
    }
  }

  function handleRemoveNewPhoto(index) {
    URL.revokeObjectURL(newPreviews[index]);
    setNewPhotos((prev) => prev.filter((_, i) => i !== index));
    setNewPreviews((prev) => prev.filter((_, i) => i !== index));
    setFieldErrors((prev) => ({ ...prev, photo: getPhotoError(totalPhotoCount - 1) }));
  }

  function handleRemoveExistingPhoto(url) {
    setExistingPhotos((prev) => prev.filter((u) => u !== url));
    setFieldErrors((prev) => ({ ...prev, photo: getPhotoError(totalPhotoCount - 1) }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const errors = {
      name: getNameError(name),
      model: getModelError(model),
      description: getDescriptionError(description),
      features: getFeaturesError(features),
      stockQuantity: getStockError(stockQuantity),
      price: getPriceError(price),
      photo: getPhotoError(totalPhotoCount),
    };
    setFieldErrors(errors);
    if (
      errors.name ||
      errors.model ||
      errors.description ||
      errors.features ||
      errors.stockQuantity ||
      errors.price ||
      errors.photo
    )
      return;

    const stock = Number(stockQuantity);
    const priceValue = Number(price);

    setSubmitting(true);

    // Upload every newly-picked file, then combine with the existing URLs
    // that weren't removed — cover photo (photos[1]) stays whichever one
    // currently sits first, so reordering isn't needed to change the cover.
    const uploadedUrls = [];
    for (const file of newPhotos) {
      const ext = file.name.split('.').pop();
      const path = `${crypto.randomUUID()}.${ext}`;

      const { error: uploadError } = await supabase.storage.from('camera-photos').upload(path, file);

      if (uploadError) {
        setError(uploadError.message);
        setSubmitting(false);
        return;
      }

      uploadedUrls.push(supabase.storage.from('camera-photos').getPublicUrl(path).data.publicUrl);
    }
    const photos = [...existingPhotos, ...uploadedUrls];

    const { error: rpcError } = isEditing
      ? await supabase.rpc('update_camera', {
          p_camera_id: camera.id,
          p_name: name.trim(),
          p_model: model.trim() || null,
          p_photos: photos,
          p_stock_quantity: stock,
          p_price: priceValue,
          p_description: description.trim(),
          p_features: features.trim(),
        })
      : await supabase.rpc('add_camera', {
          p_name: name.trim(),
          p_model: model.trim() || null,
          p_photos: photos,
          p_stock_quantity: stock,
          p_price: priceValue,
          p_description: description.trim(),
          p_features: features.trim(),
        });

    if (rpcError) {
      setSubmitting(false);
      setError(rpcError.message);
      return;
    }

    // Opened via the ↺ Restore button — the details are saved above, now
    // flip the camera back to active so the whole action reads as one step.
    if (restoring) {
      const { error: statusError } = await supabase.rpc('set_camera_status', {
        p_camera_id: camera.id,
        p_status: 'active',
      });
      if (statusError) {
        setSubmitting(false);
        setError(statusError.message);
        return;
      }
    }

    setSubmitting(false);

    if (!isEditing) {
      setName('');
      setModel('');
      setDescription('');
      setFeatures('');
      setStockQuantity('1');
      setPrice('0');
      setExistingPhotos([]);
      setNewPhotos([]);
      setNewPreviews([]);
      e.target.reset();
    }
    onAdded?.({ isEditing, name: name.trim() });
  }

  return (
    <form className="add-camera-form" onSubmit={handleSubmit} noValidate>
      <h3>{restoring ? 'Restore camera' : isEditing ? 'Edit camera' : 'Add a camera'}</h3>
      {restoring && (
        <p className="add-camera-form-hint">
          Review the details below, then save to bring this camera back as active.
        </p>
      )}

      <div className="add-camera-form-row">
        <label>
          Name
          <input
            type="text"
            className={fieldErrors.name ? 'has-error' : ''}
            value={name}
            onChange={(e) => {
              const value = e.target.value;
              setName(value);
              if (fieldErrors.name) {
                setFieldErrors((prev) => ({ ...prev, name: getNameError(value) }));
              }
            }}
            onBlur={() => setFieldErrors((prev) => ({ ...prev, name: getNameError(name) }))}
            placeholder="e.g. Canon EOS R5"
          />
          {fieldErrors.name && <span className="field-error">{fieldErrors.name}</span>}
        </label>

        <label>
          Model
          <input
            type="text"
            className={fieldErrors.model ? 'has-error' : ''}
            value={model}
            onChange={(e) => {
              const value = e.target.value;
              setModel(value);
              if (fieldErrors.model) {
                setFieldErrors((prev) => ({ ...prev, model: getModelError(value) }));
              }
            }}
            onBlur={() => setFieldErrors((prev) => ({ ...prev, model: getModelError(model) }))}
            placeholder="e.g. Mirrorless"
          />
          {fieldErrors.model && <span className="field-error">{fieldErrors.model}</span>}
        </label>
      </div>

      <label>
        Description / specifications
        <textarea
          rows={2}
          className={fieldErrors.description ? 'has-error' : ''}
          value={description}
          onChange={(e) => {
            const value = e.target.value;
            setDescription(value);
            if (fieldErrors.description) {
              setFieldErrors((prev) => ({ ...prev, description: getDescriptionError(value) }));
            }
          }}
          onBlur={() =>
            setFieldErrors((prev) => ({ ...prev, description: getDescriptionError(description) }))
          }
          placeholder="Sensor, lens mount, what's in the kit, condition notes… (shown on the camera details page)"
        />
        {fieldErrors.description && <span className="field-error">{fieldErrors.description}</span>}
      </label>

      <label>
        Product features
        <textarea
          rows={2}
          className={fieldErrors.features ? 'has-error' : ''}
          value={features}
          onChange={(e) => {
            const value = e.target.value;
            setFeatures(value);
            if (fieldErrors.features) {
              setFieldErrors((prev) => ({ ...prev, features: getFeaturesError(value) }));
            }
          }}
          onBlur={() =>
            setFieldErrors((prev) => ({ ...prev, features: getFeaturesError(features) }))
          }
        />
        {fieldErrors.features && <span className="field-error">{fieldErrors.features}</span>}
      </label>

      <div className="add-camera-form-row">
        <label>
          Stock quantity
          <input
            type="number"
            min="0"
            step="1"
            className={fieldErrors.stockQuantity ? 'has-error' : ''}
            value={stockQuantity}
            onChange={(e) => {
              const value = e.target.value;
              setStockQuantity(value);
              if (fieldErrors.stockQuantity) {
                setFieldErrors((prev) => ({ ...prev, stockQuantity: getStockError(value) }));
              }
            }}
            onBlur={() =>
              setFieldErrors((prev) => ({ ...prev, stockQuantity: getStockError(stockQuantity) }))
            }
          />
          {fieldErrors.stockQuantity && (
            <span className="field-error">{fieldErrors.stockQuantity}</span>
          )}
        </label>

        <label>
          Price per day (₹)
          <input
            type="number"
            min="0"
            step="0.01"
            className={fieldErrors.price ? 'has-error' : ''}
            value={price}
            onChange={(e) => {
              const value = e.target.value;
              setPrice(value);
              if (fieldErrors.price) {
                setFieldErrors((prev) => ({ ...prev, price: getPriceError(value) }));
              }
            }}
            onBlur={() => setFieldErrors((prev) => ({ ...prev, price: getPriceError(price) }))}
          />
          {fieldErrors.price && <span className="field-error">{fieldErrors.price}</span>}
        </label>
      </div>

      <label>
        Photos {totalPhotoCount > 0 && <span className="photo-count-hint">({totalPhotoCount})</span>}
        <div className="photo-grid">
          {existingPhotos.map((url) => (
            <span className="photo-preview" key={url}>
              <img src={url} alt={camera?.name ?? 'Camera'} />
              <CloseButton
                className="photo-preview-remove"
                label="Remove this photo"
                onClick={() => handleRemoveExistingPhoto(url)}
              />
            </span>
          ))}
          {newPreviews.map((url, i) => (
            <span className="photo-preview" key={url}>
              <img src={url} alt={newPhotos[i]?.name ?? 'Selected camera photo'} />
              <CloseButton
                className="photo-preview-remove"
                label="Remove this photo"
                onClick={() => handleRemoveNewPhoto(i)}
              />
            </span>
          ))}
          <span className={`photo-add-tile${fieldErrors.photo ? ' has-error' : ''}`}>
            <span aria-hidden="true">+</span>
            <input type="file" accept="image/*" multiple onChange={handlePhotosChange} />
          </span>
        </div>
        {/* The first photo is the cover shown everywhere else in the app —
            remove/reorder the others to change which one that is. */}
        {totalPhotoCount > 1 && <span className="photo-cover-hint">First photo is the cover image.</span>}
        {fieldErrors.photo && <span className="field-error">{fieldErrors.photo}</span>}
      </label>

      {error && <p className="error" role="alert">{error}</p>}

      <div className="add-camera-form-actions">
        <button type="submit" disabled={submitting}>
          {submitting
            ? restoring
              ? 'Restoring…'
              : 'Saving…'
            : restoring
              ? 'Save & Restore'
              : isEditing
                ? 'Save changes'
                : 'Submit'}
        </button>
        {onCancel && (
          <button type="button" className="add-camera-form-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
