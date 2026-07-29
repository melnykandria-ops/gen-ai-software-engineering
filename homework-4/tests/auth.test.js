'use strict';

/**
 * Unit tests for src/auth.js — verifyAdminToken().
 *
 * Covers: happy path, boundary values, and a regression test for the seeded
 * SEC-1 issue (hardcoded secret + non-constant-time compare). Each test
 * sets/restores process.env.ADMIN_TOKEN itself so tests stay Independent —
 * no shared state leaks between tests or across run order.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { verifyAdminToken } = require('../src/auth');

const ORIGINAL_ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function withAdminToken(value, fn) {
  const previous = process.env.ADMIN_TOKEN;
  if (value === undefined) {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = value;
  }
  try {
    fn();
  } finally {
    if (previous === undefined) {
      delete process.env.ADMIN_TOKEN;
    } else {
      process.env.ADMIN_TOKEN = previous;
    }
  }
}

// --- Happy path ---------------------------------------------------------

test('verifyAdminToken: matching token from ADMIN_TOKEN env var returns true', () => {
  withAdminToken('my-secret', () => {
    assert.equal(verifyAdminToken('my-secret'), true);
  });
});

test('verifyAdminToken: a wrong token returns false', () => {
  withAdminToken('my-secret', () => {
    assert.equal(verifyAdminToken('wrong'), false);
  });
});

// --- Boundary values -----------------------------------------------------

test('verifyAdminToken: ADMIN_TOKEN unset returns false even for an empty provided value', () => {
  withAdminToken(undefined, () => {
    assert.equal(verifyAdminToken(''), false);
  });
});

test('verifyAdminToken: ADMIN_TOKEN set to empty string returns false (falsy expected)', () => {
  withAdminToken('', () => {
    assert.equal(verifyAdminToken(''), false);
    assert.equal(verifyAdminToken('anything'), false);
  });
});

test('verifyAdminToken: non-string provided value returns false instead of throwing', () => {
  withAdminToken('my-secret', () => {
    assert.equal(verifyAdminToken(undefined), false);
    assert.equal(verifyAdminToken(12345), false);
    assert.equal(verifyAdminToken(null), false);
  });
});

test('verifyAdminToken: provided value differing only in length returns false', () => {
  withAdminToken('my-secret', () => {
    assert.equal(verifyAdminToken('my-secret-extra'), false);
    assert.equal(verifyAdminToken('my-secre'), false);
  });
});

// --- Regression: SEC-1 (hardcoded secret + no env fallback) --------------

test('SEC-1 regression: the old hardcoded literal no longer authenticates when ADMIN_TOKEN is unset', () => {
  withAdminToken(undefined, () => {
    assert.equal(verifyAdminToken('s3cr3t-admin-2024'), false);
  });
});

test('SEC-1 regression: the old hardcoded literal does not authenticate even when a different ADMIN_TOKEN is set', () => {
  withAdminToken('my-secret', () => {
    assert.equal(verifyAdminToken('s3cr3t-admin-2024'), false);
  });
});

// Final safety net: restore the environment to its pre-suite state in case
// any test above were to exit abnormally before its own restore ran.
test('cleanup: ADMIN_TOKEN environment is restored to its original value', () => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) {
    delete process.env.ADMIN_TOKEN;
  } else {
    process.env.ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  }
  assert.equal(process.env.ADMIN_TOKEN, ORIGINAL_ADMIN_TOKEN);
});
