// mock-data.js — fixtures standing in for real Aadhaar/bureau calls.
// Aadhaar is the single identity anchor: its OTP goes to the mobile number
// UIDAI already has on file, so verifying it confirms both who the
// applicant is and that they control the linked phone, in one step. There
// is no separate corroboration source to compare against; live capture is
// mandatory for everyone and is the only thing that can confirm current
// physical premises.

export const DEMO_SCENARIOS = {
  verified: {
    label: 'Has not moved, capture succeeds',
    expect: 'Clear',
    profile: {
      name: 'Ramesh Kumar', dob: '14/08/1992', pan: 'ABCDE1234F',
      aadhaarNumber: '4321 9876 5012', linkedMobileLast4: '5980',
      permanentAddress: 'Flat 302, Green Valley Apartments, Sector 70, Gurugram',
    },
    currentSameAsPermanentDefault: true,
    currentAddressSuggestion: '',
    capture: { ok: true },
  },
  moved: {
    label: 'Just moved, capture succeeds',
    expect: 'Clear',
    profile: {
      name: 'Priya Sharma', dob: '02/11/1998', pan: 'PQRSX5678K',
      aadhaarNumber: '5566 7788 9900', linkedMobileLast4: '4412',
      permanentAddress: 'C-14 Nehru Nagar, Bhopal',
    },
    currentSameAsPermanentDefault: false,
    currentAddressSuggestion: '14 Lake View Colony, Kothrud, Pune',
    capture: { ok: true },
  },
  capture_fail: {
    label: 'Capture not confirmed',
    expect: 'Decline, retry available',
    profile: {
      name: 'Arjun Nair', dob: '05/07/1995', pan: 'WXYZC8765R',
      aadhaarNumber: '9988 7766 5544', linkedMobileLast4: '3307',
      permanentAddress: '31 Marine Drive, Kochi',
    },
    currentSameAsPermanentDefault: false,
    currentAddressSuggestion: '77 Palm Grove, Kochi',
    capture: { ok: false },
  },
};

export const BUREAU_LATENCY_MS = 900;
