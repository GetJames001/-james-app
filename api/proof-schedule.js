const { privateNoStore } = require('../lib/auth.js');

// Build compatibility probe only. No schedule is registered and every call
// fails closed, including calls carrying scheduler-like metadata or owner auth.
// Do not connect the task engine until its bounded transport is reviewed.
module.exports = function disabledScheduleProbe(req, res) {
  privateNoStore(res);
  return res.status(503).json({ error: 'HOSTED_PROOF_DISABLED' });
};
