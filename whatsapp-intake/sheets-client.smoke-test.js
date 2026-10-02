// Tests sheets-client.js against a mocked fetch, since no Apps Script is
// deployed yet (Stage A0 blocker: Google Workspace account, then
// whatsapp-intake/apps-script/Code.gs needs deploying). This checks the
// request-building and error-handling logic is correct now, so wiring up
// a real deployment later is just setting two env vars, not debugging
// this file too.
// Run with: node whatsapp-intake/sheets-client.smoke-test.js

const assert = require('assert');

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

async function checkAsync(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ok -', name);
  } catch (e) {
    console.error('  FAIL -', name);
    console.error('    ' + e.message);
    process.exitCode = 1;
  }
}

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; process.env[k] = vars[k]; }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

function mockFetch(responder) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return responder(url, opts);
  };
  return { calls, restore: () => { global.fetch = original; } };
}

(async () => {
  console.log('sheets-client.js (env var guard)');
  await checkAsync('appendRequestRow() throws a clear error when WHATSAPP_INTAKE_URL is unset', async () => {
    delete process.env.WHATSAPP_INTAKE_URL;
    delete process.env.WHATSAPP_INTAKE_SECRET;
    delete require.cache[require.resolve('./sheets-client')];
    const client = require('./sheets-client');
    await assert.rejects(() => client.appendRequestRow({}), /WHATSAPP_INTAKE_URL/);
  });

  console.log('sheets-client.js (mocked fetch)');

  await checkAsync('appendRequestRow() POSTs action+secret+record and returns duplicate info', async () => {
    const mock = mockFetch(async () => ({
      ok: true,
      json: async () => ({ ok: true, requestId: 'AMN-REQ-000001', duplicateFlag: true, duplicateOf: 'AMN-REQ-000000' }),
    }));
    try {
      await withEnv({ WHATSAPP_INTAKE_URL: 'https://example.com/exec', WHATSAPP_INTAKE_SECRET: 's3cret' }, async () => {
        delete require.cache[require.resolve('./sheets-client')];
        const client = require('./sheets-client');
        const result = await client.appendRequestRow({ requestId: 'AMN-REQ-000001', clientPhone: '+2348012345678' });
        assert.strictEqual(mock.calls.length, 1);
        const body = JSON.parse(mock.calls[0].opts.body);
        assert.strictEqual(body.action, 'appendRequest');
        assert.strictEqual(body.secret, 's3cret');
        assert.strictEqual(body.record.clientPhone, '+2348012345678');
        assert.strictEqual(result.requestId, 'AMN-REQ-000001');
        assert.strictEqual(result.duplicateFlag, true);
        assert.strictEqual(result.duplicateOf, 'AMN-REQ-000000');
      });
    } finally {
      mock.restore();
    }
  });

  await checkAsync('throws when the backend responds ok:false', async () => {
    const mock = mockFetch(async () => ({ ok: true, json: async () => ({ ok: false, error: 'unauthorized' }) }));
    try {
      await withEnv({ WHATSAPP_INTAKE_URL: 'https://example.com/exec', WHATSAPP_INTAKE_SECRET: 's3cret' }, async () => {
        delete require.cache[require.resolve('./sheets-client')];
        const client = require('./sheets-client');
        await assert.rejects(() => client.updateRequestRow('AMN-REQ-000001', { status: 'New' }), /unauthorized/);
      });
    } finally {
      mock.restore();
    }
  });

  await checkAsync('throws when the HTTP response itself is not ok', async () => {
    const mock = mockFetch(async () => ({ ok: false, status: 500 }));
    try {
      await withEnv({ WHATSAPP_INTAKE_URL: 'https://example.com/exec', WHATSAPP_INTAKE_SECRET: 's3cret' }, async () => {
        delete require.cache[require.resolve('./sheets-client')];
        const client = require('./sheets-client');
        await assert.rejects(() => client.findRequestBySessionId('sess-1'), /HTTP 500/);
      });
    } finally {
      mock.restore();
    }
  });

  await checkAsync('findRequestBySessionId() returns null, not a throw, when nothing is found', async () => {
    const mock = mockFetch(async () => ({ ok: true, json: async () => ({ ok: true, record: null }) }));
    try {
      await withEnv({ WHATSAPP_INTAKE_URL: 'https://example.com/exec', WHATSAPP_INTAKE_SECRET: 's3cret' }, async () => {
        delete require.cache[require.resolve('./sheets-client')];
        const client = require('./sheets-client');
        const result = await client.findRequestBySessionId('no-such-session');
        assert.strictEqual(result, null);
      });
    } finally {
      mock.restore();
    }
  });

  console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
})();
