#!/usr/bin/env node
'use strict';

// Quick diagnostic: dumps all fields from system_info.cgi and values.cgi
// Usage: node dump-api.js <controller-ip>

const KohlerApi = require('./lib/KohlerApi');

const address = process.argv[2];
if (!address) {
  console.error('Usage: node dump-api.js <controller-ip>');
  process.exit(1);
}

(async () => {
  const api = new KohlerApi({ address });

  console.log('=== system_info.cgi ===');
  try {
    const info = await api.getSystemInfo();
    for (const [key, value] of Object.entries(info).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  } catch (err) {
    console.error('  ERROR:', err.message);
  }

  console.log('\n=== values.cgi ===');
  try {
    const values = await api.getValues();
    for (const [key, value] of Object.entries(values).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`  ${key}: ${JSON.stringify(value)}`);
    }
  } catch (err) {
    console.error('  ERROR:', err.message);
  }
})();
