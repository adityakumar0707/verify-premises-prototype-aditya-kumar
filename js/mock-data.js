// mock-data.js — fixtures standing in for real bureau/Aadhaar/telecom calls.
// Swap the DEMO_SCENARIOS lookups for real API clients (bureau pull already
// exists; Aadhaar-via-DigiLocker and Telecom-KYC are the two new Build
// List integrations) when this moves past prototype.

export const DEMO_SCENARIOS = {
  thick_file: {
    label: 'Salaried · thick file',
    expect: 'Clear — no capture needed',
    profile: {
      name: 'Ramesh Kumar', dob: '14/08/1992', pan: 'ABCDE1234F',
      declaredAddress: 'Flat 302, Green Valley Apartments, Sector 70, Gurugram',
    },
    sources: [
      { name: 'Aadhaar (DigiLocker)', address: 'H.No 302, Green Valley Apts, Sec-70, Gurugram', tenureMonths: 26 },
      { name: 'Telecom KYC', address: 'Flat-302 Green Valley Apartment Sector 70 Gurugram', tenureMonths: 14 },
    ],
  },
  thin_file: {
    label: 'New-to-credit · thin file',
    expect: 'Step-up, then Clear',
    profile: {
      name: 'Priya Sharma', dob: '02/11/1998', pan: 'PQRSX5678K',
      declaredAddress: '14 Lake View Colony, Kothrud, Pune',
    },
    sources: [
      { name: 'Aadhaar (DigiLocker)', address: '14 Lake View Colony, Kothrud, Pune', tenureMonths: 1 },
    ],
    capture: { geofenceOk: true, ocrLivenessOk: true, mockLocationFlag: false },
  },
  conflict: {
    label: 'Conflicting records',
    expect: 'Decline — before any capture',
    profile: {
      name: 'Sanjay Verma', dob: '20/03/1990', pan: 'LMNOP4321Q',
      declaredAddress: '9 New Colony, Andheri West, Mumbai',
    },
    sources: [
      { name: 'Aadhaar (DigiLocker)', address: '212 Old Mill Road, Thane', tenureMonths: 40 },
      { name: 'Telecom KYC', address: '212 Old Mill Road, Thane, 400601', tenureMonths: 22 },
    ],
  },
  stepup_fail: {
    label: 'Thin file · spoofed capture',
    expect: 'Step-up, then Decline',
    profile: {
      name: 'Arjun Nair', dob: '05/07/1995', pan: 'WXYZC8765R',
      declaredAddress: '77 Palm Grove, Kochi',
    },
    sources: [],
    capture: { geofenceOk: true, ocrLivenessOk: true, mockLocationFlag: true },
  },
};

export const BUREAU_LATENCY_MS = 900;
export const SOURCE_CHECK_LATENCY_MS = 700;
