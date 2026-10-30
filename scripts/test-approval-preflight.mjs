import assert from 'node:assert/strict';
import {inspectApproval} from '../runtime/approval-preflight.mjs';
// Pure synthetic objects only: never write approval decisions to the CRM.
const valid={status:'approved',owner_decision:true,not_expired:true,payload_matches:true,action_matches:true,draft_status:'approved',suppressed:false,already_executed:false,recent_outbound:false,active_opportunity:true,level:'A2',action_type:'email'};
assert.equal(inspectApproval(valid).approval_checks_pass,true);
assert.equal(inspectApproval(valid).execution_enabled,false);
const changes=[{status:'pending'},{owner_decision:false},{not_expired:false},{payload_matches:false},{action_matches:false},{draft_status:'ready_for_approval'},{suppressed:true},{already_executed:true},{recent_outbound:true},{active_opportunity:false},{level:'A3'},{action_type:'application'}];
for(const change of changes)assert.equal(inspectApproval({...valid,...change}).approval_checks_pass,false);
assert.equal(inspectApproval(null).approval_checks_pass,false);
assert.equal(inspectApproval({}).approval_checks_pass,false);
console.log('15/15 preflight scenarios PASS; synthetic objects only; executor always disabled');
