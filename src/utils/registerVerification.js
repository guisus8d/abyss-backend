const pendingCodes   = new Map(); // email -> { code, expiresAt, attempts }
const verifiedEmails = new Map(); // email -> expiresAt

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pendingCodes.entries())   if (v.expiresAt < now) pendingCodes.delete(k);
  for (const [k, v] of verifiedEmails.entries()) if (v < now)           verifiedEmails.delete(k);
}, 5 * 60 * 1000);

module.exports = { pendingCodes, verifiedEmails };
