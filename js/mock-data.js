// mock-data.js — stand-ins for backend calls. The toggles are the only
// scripted part of this demo: loan amount, persona, ownership, and the
// shop-photo-vs-documents choice all come from real interaction with the
// UI, not a pre-baked scenario. The toggles decide how the background
// checks a real server would run happen to come back, and default to a
// full happy path.

export const PROFILE = {
  name: 'Ramesh Kumar',
  dob: '14 Mar 1990',
  linkedMobileLast4: '8980',
  aadhaarAddress: 'Flat 4B, Green Meadows Apartments, Sector 12, Dwarka, New Delhi, 110078',
};

export const BANK_ACCOUNTS = [
  { id: 'hdfc', label: 'HDFC Bank •••• 4521' },
  { id: 'icici', label: 'ICICI Bank •••• 7789' },
  { id: 'sbi', label: 'SBI •••• 1132' },
];

export const BUSINESS_INFO = {
  legalName: 'Kumar Retail Enterprises',
};

// A business's GSTIN is derived from its PAN (positions 3-12 are the PAN
// itself), so once we already have the applicant's PAN from the credit
// check, their GSTIN can be looked up rather than asked for again.
export function buildGstin(pan) {
  return `07${pan}1Z5`;
}

export const PINCODES = {
  '110078': { city: 'New Delhi', state: 'Delhi' },
  '400001': { city: 'Mumbai', state: 'Maharashtra' },
  '560001': { city: 'Bengaluru', state: 'Karnataka' },
  '700001': { city: 'Kolkata', state: 'West Bengal' },
  '600001': { city: 'Chennai', state: 'Tamil Nadu' },
};
export function lookupPincode(pin) {
  return PINCODES[pin] || { city: 'Pune', state: 'Maharashtra' };
}

// Background-check toggles, reviewer-controlled from the demo panel.
// Default to true so the default click-through is a full happy path;
// flip one to see how that path declines.
export const TOGGLES = {
  selfOwnedMatch: true,
  landlordConfirmed: true,
  captureOk: true,
  gstinPanValid: true,
  epfoAvailable: true,
};
