import { TERMS_CONTENT } from './termsContent';

// Shared by CameraDetailsPage.jsx (the "Exchange Policy"/"Damage Policy"
// pills), TermsGateModal.jsx (the same links + "Terms and Conditions"
// inside the Book Now / cart-checkout terms gate), and TermsPage.jsx (the
// full standalone /terms page) — one copy of each policy's text instead of
// duplicating it per call site.
export const POLICY_CONTENT = {
  terms: {
    title: 'Terms and Conditions',
    intro: TERMS_CONTENT.intro,
    sections: TERMS_CONTENT.sections,
  },
  exchange: {
    title: 'Exchange Policy',
    intro:
      'At DreamCapture, we are committed to providing a seamless rental experience. Our replacement policy ensures that you receive the right products in a timely manner.',
    sections: [
      {
        heading: 'Same-Day Replacement',
        body: 'We offer same-day replacement to minimize any inconvenience and ensure a smooth rental experience.',
      },
      {
        heading: 'Replacement Timeframe',
        body: 'Replacements are typically processed within 3-4 hours, subject to availability and location.',
      },
      {
        heading: 'Free Replacement for Faulty Items',
        body: 'If the camera received is defective or incorrect due to an error on our part, we will provide a replacement at no additional cost.',
      },
      {
        heading: 'Customer-Initiated Replacements',
        body: 'If a replacement is requested due to a change in preference, a shipping fee will be applicable. The fee will be communicated at the time of the request.',
      },
    ],
  },
  damage: {
    title: 'Damage Policy',
    intro: "We understand, sometimes things go wrong! Here's what to expect if a rented camera is lost or damaged.",
    sections: [
      {
        heading: 'General Policy',
        body: 'In case of any damage or missing product(s), the company will inform you upon receiving the product back. The customer agrees to pay for any damage to, loss of, or theft (disappearance) of items, regardless of cause or fault.',
      },
      {
        heading: 'What Is Considered Damage?',
        body: 'Any permanent change in the physical appearance of the product or any change or loss of functionality is considered damage. Minor wear & tear due to general usage is not considered damage.',
      },
      {
        heading: 'Package Security Requirement',
        body: 'Since we rely on third-party delivery services, you are required to ensure that the package is securely locked before returning the product. The customer will be held liable for any loss or damage if the package is not properly secured during transit.',
      },
      {
        heading: 'Return of Missing Products',
        body: 'If the customer is willing to return the missing product, DreamCapture will arrange for a pickup. The customer will be responsible for the pickup charges, equivalent to the cost of the first pickup incurred by DreamCapture. The product should be returned as soon as possible, as rental charges will apply for each additional day the item is not returned.',
      },
      {
        heading: 'Payment for Missing Products',
        body: 'If the customer misplaces or loses the product(s), they must pay for the missing item(s) within 24 hours after the payment link is shared.',
      },
      {
        // No such opt-in exists anywhere in the booking flow yet (no
        // checkbox, no line-item pricing) — this describes a
        // not-yet-built feature. Flag this to the site owner before
        // treating it as a live offering.
        heading: 'Damage Waiver Coverage',
        body: 'If you have opted in for our DreamCapture Damage Waiver, your rental is protected against accidental damage up to 50% of the product value (capped at ₹25,000) as per the Damage Waiver terms & conditions. If the repair cost exceeds your coverage limit, you are responsible only for the amount exceeding the cap.',
      },
      {
        heading: "What's Not Covered",
        list: ['Damages due to improper usage', 'Theft', 'Burglary', 'Lost items'],
      },
      {
        heading: 'Repairable Damage (Without Damage Waiver, or Exceeding Coverage)',
        list: ['Actual repair cost + ₹300 (to cover logistics expenses)'],
      },
      {
        heading: 'Irreparable Damage (Without Damage Waiver, or Exceeding Coverage)',
        body: 'The customer must pay the current replacement cost of the product in full.',
      },
      {
        heading: 'Loss or Theft',
        list: [
          'The Damage Waiver does not cover loss or theft.',
          'The customer must pay the current replacement cost of the product in full.',
        ],
        body: 'A separate invoice will be issued for all such charges to ensure full transparency.',
      },
      {
        heading: 'Non-Compliance',
        body: 'Failure to comply with the terms of this policy may result in legal action by DreamCapture.',
      },
    ],
  },
};
