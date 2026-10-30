// Read-only decision support. This module has no transport or approval mutation.
export function inspectApproval(row) {
 const checks = {
  approval_exists: Boolean(row),
  explicit_owner_approval: row?.status === 'approved' && row?.owner_decision === true,
  not_expired: row?.not_expired === true,
  payload_matches: row?.payload_matches === true,
  action_matches: row?.action_matches === true,
  draft_approved: row?.draft_status === 'approved',
  target_not_suppressed: row?.suppressed === false,
  not_previously_executed: row?.already_executed === false,
  cooldown_clear: row?.recent_outbound === false,
  active_opportunity: row?.active_opportunity === true,
  supported_action: row?.level === 'A2' && row?.action_type === 'email',
 };
 return {checks, approval_checks_pass: Object.values(checks).every(Boolean),
  execution_enabled: false, executor_available: false,
  blocked_by: [...Object.keys(checks).filter(k=>!checks[k]),'external_executor_not_configured'],
  scope:'Read-only local preflight; cannot approve or execute an action'};
}
