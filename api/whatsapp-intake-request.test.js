// Tests buildRequestFromBody() from whatsapp-intake-request.js - pure
// function, no mocking needed since it does no I/O.
// Run with: node api/whatsapp-intake-request.test.js

const assert = require('assert');
const { buildRequestFromBody } = require('./whatsapp-intake-request');

let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok -', name);
  } catch (e) {
    console.error('  FAIL -', name);
    console.error('    ' + e.message);
    process.exitCode = 1;
  }
}

const validBody = {
  clientFullName: 'Jane Doe',
  clientPhone: '08012345678',
  clientEmail: 'jane@example.com',
  clientType: 'Private household',
  consent: 'on',
  staffCategory: 'Nanny',
  numberRequired: '1',
  state: 'Lagos',
  confirmTrueComplete: 'on',
  consentVerification: 'on',
  consentTerms: 'on',
  signature: 'Jane Doe',
};

check('a fully valid submission produces a record with no errors', () => {
  const { record, errors } = buildRequestFromBody(validBody);
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.clientPhone, '+2348012345678');
  assert.strictEqual(record.sourceChannel, 'Website');
  assert.strictEqual(record.status, 'New');
  assert.strictEqual(record.consent, true);
  assert(record.consentTimestamp, 'consentTimestamp should be set when consent is true');
});

check('missing consent is rejected', () => {
  const { errors } = buildRequestFromBody({ ...validBody, consent: undefined });
  assert(errors.includes('consent'));
});

check('missing name is rejected', () => {
  const { errors } = buildRequestFromBody({ ...validBody, clientFullName: '' });
  assert(errors.includes('clientFullName'));
});

check('an invalid phone number is rejected', () => {
  const { errors } = buildRequestFromBody({ ...validBody, clientPhone: '123' });
  assert(errors.includes('clientPhone'));
});

check('an unrecognized staffCategory is rejected rather than silently accepted', () => {
  const { errors } = buildRequestFromBody({ ...validBody, staffCategory: 'Astronaut' });
  assert(errors.includes('staffCategory'));
});

check('a malformed email is rejected even though email itself is optional', () => {
  const { errors } = buildRequestFromBody({ ...validBody, clientEmail: 'not-an-email' });
  assert(errors.includes('clientEmail'));
});

check('no email at all is fine (email is optional)', () => {
  const { errors } = buildRequestFromBody({ ...validBody, clientEmail: '' });
  assert.deepStrictEqual(errors, []);
});

check('salaryMin greater than salaryMax is rejected', () => {
  const { errors } = buildRequestFromBody({ ...validBody, salaryMin: '500000', salaryMax: '200000' });
  assert(errors.includes('salaryRange'));
});

check('numberRequired defaults to 1 and never goes below 1', () => {
  const { record } = buildRequestFromBody({ ...validBody, numberRequired: '0' });
  assert.strictEqual(record.numberRequired, 1);
});

check('an unrecognized employmentType is dropped, not rejected (it is not a required field)', () => {
  const { record, errors } = buildRequestFromBody({ ...validBody, employmentType: 'Weekends only' });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.employmentType, '');
});

// Fields added to match the "Amana Domestic Staff Order Request" Google
// Form (https://forms.gle/uAE2rMPf6FAiQwZk9) - see whatsapp-intake/README.md.
check('missing signature is rejected', () => {
  const { errors } = buildRequestFromBody({ ...validBody, signature: '' });
  assert(errors.includes('signature'));
});

check('missing any of the three required consent checks is rejected', () => {
  ['confirmTrueComplete', 'consentVerification', 'consentTerms'].forEach((field) => {
    const { errors } = buildRequestFromBody({ ...validBody, [field]: undefined });
    assert(errors.includes(field), `expected ${field} to be reported missing`);
  });
});

check('multi-select fields pass through as the comma-joined string the client already built', () => {
  const { record, errors } = buildRequestFromBody({
    ...validBody,
    mainDuties: 'Cleaning, Cooking, Driving',
    liveArrangement: 'Live-in, Either',
    idTypes: "NIN slip, Driver's license",
  });
  assert.deepStrictEqual(errors, []);
  assert.strictEqual(record.mainDuties, 'Cleaning, Cooking, Driving');
  assert.strictEqual(record.liveArrangement, 'Live-in, Either');
  assert.strictEqual(record.idTypes, "NIN slip, Driver's license");
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
