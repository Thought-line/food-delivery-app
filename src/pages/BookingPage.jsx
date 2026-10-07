import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useRentalRange } from '../lib/useRentalRange';
import BookingForm from '../components/BookingForm';
import Loading from '../components/ui/Loading';

export default function BookingPage() {
  const { cameraId } = useParams(); // camera id from the URL, e.g. /book/123
  const location = useLocation();
  const navigate = useNavigate();
  // Rental dates come from the shared navbar picker (useRentalRange) — the
  // same store the catalogue and the details page read — so changing the
  // dates up top flows straight through to this form.
  const { range } = useRentalRange();
  // If we already got the camera passed in from the previous page, use that.
  // Otherwise we don't have it yet, so start in a loading state.
  const [camera, setCamera] = useState(location.state?.camera ?? null);
  const [loading, setLoading] = useState(!location.state?.camera);
  const [error, setError] = useState(null);

  const initialQuantity = location.state?.quantity;
useEffect(() => {
    if (camera) return; // already have it — no need to fetch again

    // No camera was passed in (e.g. the user opened this URL directly),
    // so look it up by the id in the URL instead.
    supabase
      .from('cameras')
      .select('id, name, model, stock_quantity, price')
      .eq('id', cameraId)
      .single()
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message);
        else setCamera(data);
        setLoading(false);
      });},
  [cameraId, camera]);
  if (loading) return <Loading label="Loading camera…" />;
  if (error) return <p role="alert">Couldn't load camera: {error}</p>;
  if (!camera) return <p role="alert">Camera not found.</p>;
  // Once we have the camera, the actual form/logic lives in BookingForm.
  return (
    <BookingForm
      camera={camera}
      dates={range}
      initialQuantity={initialQuantity}
      // Book Now always comes from that camera's own details page (see
      // CameraDetailsPage.jsx's handleBookNow) — Cancel goes back there
      // instead of all the way home.
      onDone={() => navigate(`/camera/${cameraId}`)}
    />
  );
}
