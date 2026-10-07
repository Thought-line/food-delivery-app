import { Link } from 'react-router-dom';
import Logo from '../Logo';
import './BrandLogo.css';
// App wordmark + icon, linking home — shared by the customer navbar and
// the admin topbar so both always show the exact same brand treatment.
export default function BrandLogo({ to }) {
  return (
    <Link to={to} className="brand-logo-link">
      <Logo size={42} />
      <span className="brand-logo-text">
        <span className="brand-logo-text-accent">Dream</span>Capture
      </span>
    </Link>
  );
}
