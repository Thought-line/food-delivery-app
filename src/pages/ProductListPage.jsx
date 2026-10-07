import { useNavigate } from 'react-router-dom';
import CameraList from '../components/CameraList';
export default function ProductListPage() {
  const navigate = useNavigate();
  return (
    <CameraList
      onViewDetails={(camera) =>
        // Rental dates live in the shared navbar picker (useRentalRange), so
        // the details page reads them from there — no need to carry them in
        // the URL.
        navigate(`/camera/${camera.id}`)
      }
    />
  );
}
