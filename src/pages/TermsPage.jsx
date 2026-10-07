import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { TERMS_CONTENT } from '../lib/termsContent';
import './TermsPage.css';

// Public, standalone page (route: /terms) — separate from the Exchange
// Policy/Damage Policy drawers (see PolicyDrawer.jsx).
export default function TermsPage() {
  return (
    <div className="terms-page">
      {/* A real SVG chevron, not the "←" glyph — that character renders
          hairline-thin in this font regardless of font-weight, so it never
          actually looked bold no matter how the text was styled. */}
      <Link to="/" className="terms-page-back" aria-label="Back">
        <ChevronLeft size={30} strokeWidth={3} />
      </Link>

      <h1>Terms and Conditions</h1>
      <p className="terms-page-intro">{TERMS_CONTENT.intro}</p>

      {TERMS_CONTENT.sections.map((section, i) => (
        <section key={section.heading} className="terms-page-section">
          <h2>
            {i + 1}. {section.heading}
          </h2>
          <p>{section.body}</p>
        </section>
      ))}
    </div>
  );
}
