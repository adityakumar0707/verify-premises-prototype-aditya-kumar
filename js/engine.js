// engine.js — the decision rules from the Verification Menu. Loan amount
// sets the tier, which decides whether a live capture is ever asked for at
// all. Everything else here is a single fact check (a government record, a
// landlord's confirmation, uploaded registration documents). Sequencing,
// meaning which checks run in what order and what a live capture on top of
// them means, is the app's job, not this module's: this file only answers
// "given this fact, does it pass."

export const LOAN_TIER_THRESHOLD = 500000;

export function loanTier(amount) {
  return amount >= LOAN_TIER_THRESHOLD ? 'large' : 'small';
}

export function checkHomeRecords({ ownership, selfOwnedMatch, landlordConfirmed }) {
  if (ownership === 'self') {
    return {
      ok: true,
      reason: selfOwnedMatch
        ? 'Ownership confirmed by a government property record'
        : 'No matching property record found, taken as self-declared',
    };
  }
  if (ownership === 'family') {
    return { ok: true, reason: 'Family-owned, taken as self-declared' };
  }
  return {
    ok: landlordConfirmed,
    reason: landlordConfirmed
      ? 'Your landlord confirmed the tenancy'
      : 'Your landlord did not confirm the tenancy',
  };
}

export function checkBusinessDocuments(gstinPanValid) {
  return {
    ok: gstinPanValid,
    reason: gstinPanValid
      ? 'Confirmed with your GSTIN and business PAN'
      : 'We could not confirm your business registration details',
  };
}
