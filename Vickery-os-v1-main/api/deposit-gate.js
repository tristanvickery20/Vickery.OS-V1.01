function requiresDeposit(status) {
  return status === "Scheduled" || status === "In Progress";
}

function shouldGate({ deposit_required, deposit_received, status }) {
  const depReq = String(deposit_required).toLowerCase() === "true" || deposit_required === true;
  const depRec = Number(deposit_received || 0);
  const gatingStatus = requiresDeposit(String(status || ""));
  return depReq && gatingStatus && depRec <= 0;
}

module.exports = { shouldGate };