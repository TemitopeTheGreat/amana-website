// Quick self-check for Stage A1 (schema + constants + utils). No test
// framework - this repo has none and Stage A1 doesn't need one. Run with:
//   node intake/smoke-test.js
// Exits non-zero on any failure so it's safe to use in a CI step later.

const assert = require('assert');
const schema = require('./schema');
const constants = require('./constants');
const utils = require('./utils');

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

console.log('schema.js');
check('createEmptyRequest() has every field from FIELD_ORDER', () => {
  const r = schema.createEmptyRequest();
  for (const field of schema.FIELD_ORDER) {
    assert(field in r, `missing field: ${field}`);
    assert.notStrictEqual(r[field], undefined, `field is undefined: ${field}`);
  }
});
check('validateForConfirmation() flags a blank request as invalid', () => {
  const { valid, missing } = schema.validateForConfirmation(schema.createEmptyRequest());
  assert.strictEqual(valid, false);
  assert(missing.length > 0);
});
check('validateForConfirmation() passes once required fields are filled', () => {
  const r = {
    ...schema.createEmptyRequest(),
    clientFullName: 'Jane Doe',
    clientPhone: '+2348012345678',
    clientType: 'Private household',
    consent: true,
    staffCategory: 'Nanny',
    numberRequired: 1,
    state: 'Lagos',
    confirmTrueComplete: true,
    consentVerification: true,
    consentTerms: true,
    signature: 'Jane Doe',
  };
  const { valid, missing } = schema.validateForConfirmation(r);
  assert.strictEqual(valid, true, 'unexpected missing: ' + missing.join(', '));
});

console.log('constants.js');
check('ALL_STATUSES has no duplicates and matches the 4 phases', () => {
  const total = constants.STATUS.intake.length + constants.STATUS.recruitment.length
    + constants.STATUS.commercial.length + constants.STATUS.fulfilment.length;
  assert.strictEqual(constants.ALL_STATUSES.length, total);
  assert.strictEqual(new Set(constants.ALL_STATUSES).size, total, 'duplicate status value found');
});
check('STAFF_CATEGORIES matches the bot script step 2 options', () => {
  assert.deepStrictEqual(constants.STAFF_CATEGORIES, ['Nanny', 'Housekeeper', 'Cook', 'Cleaner', 'Driver', 'Other']);
});

console.log('utils.js');
check('generateRequestReference() with no args returns AMN-REQ-###### shape', () => {
  const ref = utils.generateRequestReference();
  assert(/^AMN-REQ-\d{6}$/.test(ref), `bad shape: ${ref}`);
});
check('generateRequestReference() with existingIds returns the next number', () => {
  const ref = utils.generateRequestReference(['AMN-REQ-000001', 'AMN-REQ-000042', 'AMN-REQ-000007']);
  assert.strictEqual(ref, 'AMN-REQ-000043');
});
check('generateRequestReference() with empty existingIds starts at 1', () => {
  assert.strictEqual(utils.generateRequestReference([]), 'AMN-REQ-000001');
});
check('normalizeNigerianPhone() handles local 0-prefixed format', () => {
  const { normalized, valid } = utils.normalizeNigerianPhone('08012345678');
  assert.strictEqual(normalized, '+2348012345678');
  assert.strictEqual(valid, true);
});
check('normalizeNigerianPhone() handles spaced/dashed input', () => {
  const { normalized, valid } = utils.normalizeNigerianPhone('0801-234 5678');
  assert.strictEqual(normalized, '+2348012345678');
  assert.strictEqual(valid, true);
});
check('normalizeNigerianPhone() handles already-international format', () => {
  const { normalized, valid } = utils.normalizeNigerianPhone('+234 801 234 5678');
  assert.strictEqual(normalized, '+2348012345678');
  assert.strictEqual(valid, true);
});
check('normalizeNigerianPhone() handles 234-without-plus format', () => {
  const { normalized, valid } = utils.normalizeNigerianPhone('2348012345678');
  assert.strictEqual(normalized, '+2348012345678');
  assert.strictEqual(valid, true);
});
check('normalizeNigerianPhone() rejects a too-short number', () => {
  const { valid } = utils.normalizeNigerianPhone('12345');
  assert.strictEqual(valid, false);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
