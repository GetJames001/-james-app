const { hashPassword } = require("../lib/auth.js");

const password = process.env.JAMES_PASSWORD_TO_HASH;

if (!password) {
  console.error("Set JAMES_PASSWORD_TO_HASH only for this command, then remove it from the shell.");
  process.exit(1);
}

process.stdout.write(`${hashPassword(password)}\n`);
