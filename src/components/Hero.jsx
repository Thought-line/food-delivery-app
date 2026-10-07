import { useEffect, useState } from 'react';
import { Clock, ShieldCheck, Zap } from 'lucide-react';
import heroImg from '../assets/cameras/hero-image.webp';
import { fetchActiveCameras } from '../lib/cameras';
import { formatPrice } from '../lib/common';
import './Hero.css';

const FEATURES = [
  { icon: Clock, label: 'Flexible', sublabel: 'Rental Periods' },
  { icon: ShieldCheck, label: 'Verified', sublabel: 'Equipment' },
  { icon: Zap, label: 'Instant', sublabel: 'Booking' },
];


// Cinematic landing hero for the public Home page. The two floating cards
// show 2 real, in-stock cameras from the actual catalogue — not a fixed
// model/price baked into this component — so editing or retiring a camera
// in Manage Camera is reflected here too, same as everywhere else in the
// app. Simply the first 2 active cameras (alphabetical, matching
// fetchActiveCameras' own order) that still have stock and a real price;
// if the catalogue has fewer than 2 such cameras, fewer cards show.
export default function Hero() {
  const [featured, setFeatured] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchActiveCameras()
      .then((cams) => {
        if (cancelled) return;
        setFeatured(cams.filter((c) => (c.stock_quantity ?? 0) > 0 && c.price > 0).slice(0, 2));
      })
      .catch(() => {
        if (!cancelled) setFeatured([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="hero">
      <div className="hero-inner">
        <div className="hero-left">
          <p className="hero-eyebrow">DreamCapture Camera Rental</p>
          <h1 className="hero-title">
            Rent pro cameras.
            <br />
            Create <span className="hero-title-accent">without limits.</span>
          </h1>
          <p className="hero-subtitle">
            Top DSLR, Mirrorless &amp; Cinema cameras.
            <br />
            Flexible rentals. Great prices.
            <br />
            Book online in minutes.
          </p>

          <ul className="hero-features">
            {FEATURES.map(({ icon: Icon, label, sublabel }) => (
              <li key={label} className="hero-feature">
                <span className="hero-feature-icon">
                  <Icon size={20} strokeWidth={1.75} />
                </span>
                <span className="hero-feature-text">
                  {label}
                  <br />
                  {sublabel}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="hero-right">
          <div className="hero-camera-glow" aria-hidden="true" />
          <img
            src={heroImg}
            alt="Canon and Sony mirrorless cameras with lenses, bag and tripod available for rent"
            className="hero-camera-img"
          />

          {featured[0] && (
            <div className="hero-float-card hero-float-card--top">
              <span className="hero-float-dot" aria-hidden="true" />
              <div className="hero-float-body">
                <strong>{featured[0].name}</strong>
                <span className="hero-float-price">{formatPrice(featured[0].price)} / day</span>
                <span className="hero-float-status">Available for Rent</span>
              </div>
            </div>
          )}

          {featured[1] && (
            <div className="hero-float-card hero-float-card--bottom">
              <span className="hero-float-dot" aria-hidden="true" />
              <div className="hero-float-body">
                <strong>{featured[1].name}</strong>
                <span className="hero-float-price">{formatPrice(featured[1].price)} / day</span>
                <span className="hero-float-status">Available for Rent</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
