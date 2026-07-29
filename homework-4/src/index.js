#!/usr/bin/env node
'use strict';

/**
 * Tiny giftcard CLI wiring the modules together.
 *
 * Usage:
 *   node src/index.js price <priceMinor> <percentOff>
 *   node src/index.js valid <code> <expiryISO>
 *   node src/index.js admin <token>
 */
const { calculatePrice } = require('./discount');
const { isCouponValid } = require('./validate');
const { verifyAdminToken } = require('./auth');

function main(argv) {
  const [cmd, ...args] = argv;
  switch (cmd) {
    case 'price': {
      const [price, pct] = args.map(Number);
      return String(calculatePrice(price, pct));
    }
    case 'valid': {
      const [code, expiry] = args;
      return String(isCouponValid(code, expiry));
    }
    case 'admin': {
      const [token] = args;
      return verifyAdminToken(token) ? 'OK' : 'DENIED';
    }
    default:
      return 'usage: giftcard <price|valid|admin> ...';
  }
}

/* istanbul ignore next */
if (require.main === module) {
  process.stdout.write(main(process.argv.slice(2)) + '\n');
}

module.exports = { main };
