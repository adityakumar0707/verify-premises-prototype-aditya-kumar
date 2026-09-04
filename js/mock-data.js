// mock-data.js — fixtures standing in for real Aadhaar/telecom/bureau calls.
// Aadhaar is the authoritative source for permanent address (fetched once,
// directly, not "compared" against something else). Telecom KYC is the
// one independent corroboration source. The declared address being
// checked is either the permanent address itself, or a fresh current
// address the applicant entered, depending on the same-as-permanent
// checkbox on the profile screen.

export const DEMO_SCENARIOS = {
  thick_file: {
    label: 'Employed, has not moved',
    expect: 'Clear, no capture needed',
    profile: {
      name: 'Ramesh Kumar', dob: '14/08/1992', pan: 'ABCDE1234F',
      aadhaarNumber: '4321 9876 5012',
      permanentAddress: 'Flat 302, Green Valley Apartments, Sector 70, Gurugram',
    },
    currentSameAsPermanentDefault: true,
    currentAddressSuggestion: '',
    telecomAddress: { address: 'Flat-302 Green Valley Apartment Sector 70 Gurugram', tenureMonths: 14 },
  },
  thin_file: {
    label: 'New to credit, just moved',
    expect: 'Step-up, then Clear',
    profile: {
      name: 'Priya Sharma', dob: '02/11/1998', pan: 'PQRSX5678K',
      aadhaarNumber: '5566 7788 9900',
      permanentAddress: 'C-14 Nehru Nagar, Bhopal',
    },
    currentSameAsPermanentDefault: false,
    currentAddressSuggestion: '14 Lake View Colony, Kothrud, Pune',
    telecomAddress: { address: '14 Lake View Colony, Kothrud, Pune', tenureMonths: 1 },
    capture: { ok: true },
  },
  conflict: {
    label: 'Conflicting records',
    expect: 'Decline, before any capture',
    profile: {
      name: 'Sanjay Verma', dob: '20/03/1990', pan: 'LMNOP4321Q',
      aadhaarNumber: '1122 3344 5566',
      permanentAddress: '212 Old Mill Road, Thane',
    },
    currentSameAsPermanentDefault: false,
    currentAddressSuggestion: '9 New Colony, Andheri West, Mumbai',
    telecomAddress: { address: '212 Old Mill Road, Thane, 400601', tenureMonths: 22 },
  },
  stepup_fail: {
    label: 'New to credit, capture not confirmed',
    expect: 'Step-up, then Decline',
    profile: {
      name: 'Arjun Nair', dob: '05/07/1995', pan: 'WXYZC8765R',
      aadhaarNumber: '9988 7766 5544',
      permanentAddress: '31 Marine Drive, Kochi',
    },
    currentSameAsPermanentDefault: false,
    currentAddressSuggestion: '77 Palm Grove, Kochi',
    telecomAddress: { address: '77 Palm Grove, Kochi', tenureMonths: 1 },
    capture: { ok: false },
  },
};

export const AADHAAR_TENURE_MONTHS = 999;
export const BUREAU_LATENCY_MS = 900;
export const SOURCE_CHECK_LATENCY_MS = 700;
