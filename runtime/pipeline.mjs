import {hasRecentOutbound} from './contact-history.mjs';
import { createHash } from 'node:crypto';
const limits={need:25,fit:20,business:20,access:15,geography:10,timing:10};
export const idFor=(...parts)=>{
 const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
};
export function qualify(candidate,{now=new Date(),demo=false,preferences={},ownerTerms={}}={}) {
 const reasons=[];
 const c=candidate;
 if(!c || typeof c!=='object') return {accepted:false,reasons:['invalid_candidate']};
 if(c.metadata?.required_capabilities?.includes('dtc_shopify_cases') && ownerTerms.dtc_shopify_cases===false) reasons.push('owner_lacks_required_dtc_shopify_cases');
 if(c.synthetic && !demo) reasons.push('synthetic_data_requires_demo');
 if(c.metadata?.review_required===true) reasons.push('manual_review_required');
 if(preferences.remote_only && ['job','studio_partner'].includes(c.type)) {
  if(['office','hybrid'].includes(c.metadata?.work_mode)) reasons.push('owner_requires_remote');
  else if(c.metadata?.work_mode!=='remote') reasons.push('remote_compatibility_unverified');
 }
 if(!['direct_client','studio_partner','job'].includes(c.type)) reasons.push('unsupported_type');
 if(typeof c.name!=='string' || !c.name.trim() || typeof c.title!=='string' || !c.title.trim()) reasons.push('identity_missing');
 let domain;
 try {
  const u=new URL(c.source_url); if(u.protocol!=='https:') throw Error();
  domain=c.domain?.trim().toLowerCase();
  if(!domain || domain.includes('/') || !domain.includes('.') || /\s/.test(domain)) throw Error();
  if(!demo && domain.endsWith('.invalid')) throw Error();
  if(demo && (!c.synthetic || !u.hostname.endsWith('.invalid') || !domain.endsWith('.invalid'))) throw Error();
 }catch {reasons.push('invalid_source_or_domain');}
 const evidence=Array.isArray(c.evidence)?c.evidence:[];
 const evidenceMap=new Map();
 for(const e of evidence){
  try {
   const u=new URL(e.source_url);
   const age=now-new Date(e.observed_at);
   if(!e.id || !e.fact?.trim() || !e.type || u.protocol!=='https:' || !Number.isFinite(age) || age<0 || age>30*86400000 || !(e.confidence>=0 && e.confidence<=1)) throw Error();
   if(demo && !u.hostname.endsWith('.invalid')) throw Error();
   if(evidenceMap.has(e.id)) throw Error();
   evidenceMap.set(e.id,e);
  } catch {reasons.push('invalid_or_stale_evidence');}
 }
 if(evidenceMap.size<2) reasons.push('two_verified_observations_required');
 if(c.hard_disqualifier!==false) reasons.push('disqualifier_not_cleared');
 let score=0,positive=0;
 for(const [key,max] of Object.entries(limits)) {
  const item=c.scoring?.[key];
  if(!item || !Number.isFinite(item.points) || item.points<0 || item.points>max || !item.rationale?.trim() || !Array.isArray(item.evidence_ids) || !item.evidence_ids.length || item.evidence_ids.some(x=>!evidenceMap.has(x))) {
   reasons.push(`unsupported_score:${key}`);continue;
  }
  score+=item.points;
  if(item.points>0)positive++;
 }
 if(positive<2)reasons.push('insufficient_positive_signals');
 if(score<65)reasons.push('below_qualified_threshold');
 const confidence=evidence.length?Math.min(...evidence.map(e=>Number.isFinite(e?.confidence)?e.confidence:0)):0;
 return {accepted:reasons.length===0,reasons,score,confidence,domain,evidence};
}
export async function runPipeline(db,workspace,candidates,{demo=false,now=new Date()}={}) {
 if(!Array.isArray(candidates) || candidates.length>100)throw Error('Expected at most 100 candidates');
 const q=async(s,p=[]) => (await db.query(s,p)).rows;
 const settings=(await q('select settings from workspaces where id=$1',[workspace]))[0]?.settings ?? {};
 const preferences=settings.work_preferences ?? {};
 const ownerTerms=settings.owner_terms ?? {};
 const summary={candidates:candidates.length,qualified:0,rejected:[],duplicates:0,companies_created:0,opportunities_created:0,evidence_created:0,drafts_created:0,approvals_created:0,blocked_drafts:[],external_actions_attempted:0,external_actions_executed:0};
 const event=async(type,entity,id,payload={})=>q('insert into events(workspace_id,entity_type,entity_id,event_type,actor_type,actor_id,payload) values($1,$2,$3,$4,\'agent\',\'local_pipeline\',$5)',[workspace,entity,id,type,payload]);
 const seen=new Set();
 for(const c of candidates){
  const v=qualify(c,{demo,now,preferences,ownerTerms});
  if(!v.accepted){summary.rejected.push({title:c?.title??null,reasons:v.reasons});continue;}
  const key=JSON.stringify([v.domain,c.type,c.source_url]);
  if(seen.has(key)){summary.duplicates++;continue;}seen.add(key);
  const companyId=(await q('select id from companies where workspace_id=$1 and domain=$2',[workspace,v.domain]))[0]?.id ?? idFor(workspace,'company',v.domain);
  const suppressed=(await q('select is_suppressed($1,null,null,$2,$3) blocked',[workspace,companyId,v.domain]))[0].blocked;
  if(suppressed){summary.rejected.push({title:c.title,reasons:['suppressed_company_or_domain']});continue;}
  summary.qualified++;
  const inserted=await q('insert into companies(id,workspace_id,name,domain,source_url,metadata) values($1,$2,$3,$4,$5,$6) on conflict do nothing returning id',[companyId,workspace,c.name.trim(),v.domain,c.source_url,{synthetic:!!c.synthetic}]);
  summary.companies_created+=inserted.length;
  const opportunityId=idFor(workspace,'opportunity',key);
  const opportunity=await q("insert into opportunities(id,workspace_id,company_id,type,title,source_url,score,score_breakdown,confidence,stage,next_action,metadata) values($1,$2,$3,$4,$5,$6,$7,$8,$9,'qualified',$11,$10) on conflict do nothing returning id",[opportunityId,workspace,companyId,c.type,c.title,c.source_url,v.score,c.scoring,v.confidence,{...(c.metadata && typeof c.metadata==='object' && !Array.isArray(c.metadata)?c.metadata:{}),synthetic:!!c.synthetic,scoring_is_researcher_assessment:true},c.metadata?.recommended_next_action ?? 'Review evidence and draft']);
  if(!opportunity.length){summary.duplicates++;continue;}
  summary.opportunities_created++;
  await event('opportunity_discovered','opportunity',opportunityId,{synthetic:!!c.synthetic});
  await event('opportunity_qualified','opportunity',opportunityId,{score:v.score});
  const evidenceIds=new Map();
  for(const e of v.evidence){
   const eid=idFor(opportunityId,'evidence',e.id);
   await q('insert into evidence(id,workspace_id,opportunity_id,company_id,evidence_type,source_url,fact,inference,confidence,observed_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[eid,workspace,opportunityId,companyId,e.type,e.source_url,e.fact,e.inference??null,e.confidence,e.observed_at]);
   evidenceIds.set(e.id,eid);summary.evidence_created++;
  }
  if(!c.draft)continue;
  const d=c.draft;
  const email=d.target?.trim().toLowerCase();
  const words=typeof d.body==='string'?d.body.trim().split(/\s+/u).length:0;
  const refs=Array.isArray(d.evidence_ids)?[...new Set(d.evidence_ids)]:[];
  let reason;
  if(c.type==='job')reason='job_application_drafting_not_implemented';
  else if(!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (demo && !email.endsWith('.invalid')))reason='invalid_target';
  else if(d.email_ownership_verified!==true || !d.email_source_url || !v.evidence.some(e=>e.source_url===d.email_source_url && e.fact.toLowerCase().includes(email)))reason='email_ownership_not_evidenced';
  else if(words<60 || words>140 || !d.subject?.trim() || !d.full_name?.trim())reason='draft_quality_gate';
  else if(refs.length<2 || refs.some(r=>!evidenceIds.has(r)))reason='draft_requires_two_crm_evidence_records';
  else if((await q('select (is_suppressed($1,$2,null,$3,$4) or is_suppressed($1,$2,null,null,$5)) blocked',[workspace,email,companyId,v.domain,email.split('@')[1]]))[0].blocked)reason='suppressed_recipient';
  else if(await hasRecentOutbound(db,{workspace,email,companyId,now}))reason='recent_outreach_requires_owner_review';
  if(reason){summary.blocked_drafts.push({opportunity_id:opportunityId,reason});continue;}
  const existingPerson=(await q('select id,company_id from people where workspace_id=$1 and email=$2',[workspace,email]))[0];
  if(existingPerson && existingPerson.company_id!==companyId){summary.blocked_drafts.push({opportunity_id:opportunityId,reason:'ambiguous_person_company'});continue;}
  const personId=existingPerson?.id ?? idFor(workspace,'person',email);
  await q('insert into people(id,workspace_id,company_id,full_name,email,email_source,email_confidence) values($1,$2,$3,$4,$5,$6,1) on conflict do nothing',[personId,workspace,companyId,d.full_name,email,d.email_source_url]);
  await q('update opportunities set person_id=$2 where id=$1',[opportunityId,personId]);
  const draftId=idFor(opportunityId,'draft',email,d.subject,d.body);
  const draft=(await q("insert into drafts(id,workspace_id,opportunity_id,person_id,type,channel,subject,body,personalization_basis,status,created_by_agent,claims_used) values($1,$2,$3,$4,'cold_email','email',$5,$6,$7,'ready_for_approval','outreach_writer',$8) returning payload_hash",[draftId,workspace,opportunityId,personId,d.subject,d.body,refs.map(r=>({evidence_id:evidenceIds.get(r)})),[{source:'researcher supplied draft',review_required:true}]]))[0];
  await q("insert into approvals(id,workspace_id,opportunity_id,draft_id,level,action_type,target,payload_hash,payload_snapshot,requested_by) values($1,$2,$3,$4,'A2','email',$5,$6,$7,'outreach_writer')",[idFor(draftId,'approval',email),workspace,opportunityId,draftId,email,draft.payload_hash,{reason:'Evidence-grounded draft; owner must review all claims',source_evidence:refs.map(r=>evidenceIds.get(r)),synthetic:!!c.synthetic}]);
  await q("update opportunities set stage='approval_pending' where id=$1",[opportunityId]);
  summary.drafts_created++;summary.approvals_created++;
  await event('draft_created','draft',draftId);
 }
 const digest={
  pipeline:await q('select type,stage,count(*)::int count from opportunities where workspace_id=$1 group by type,stage order by type,stage',[workspace]),
  pending_approvals:await q('select approval_id,target,subject,body,level from v_approval_queue where workspace_id=$1 order by requested_at,approval_id',[workspace]),
  failed_runs:await q("select agent_name,error_category,error_safe from agent_runs where workspace_id=$1 and status='failed' order by started_at desc limit 20",[workspace]),
  funnel:await q('select * from v_weekly_funnel where workspace_id=$1',[workspace]),
 };
 const allEvidence=candidates.flatMap(c=>Array.isArray(c?.evidence)?c.evidence:[]).filter(e=>e && typeof e.source_url==='string' && typeof e.fact==='string');
 return {summary:'Local A1 ingestion, qualification, CRM drafting and analytics completed; no external execution',evidence:allEvidence.map(e=>({source:e.source_url,fact:e.fact,confidence:e.confidence})),confidence:allEvidence.length?Math.min(...allEvidence.map(e=>Number.isFinite(e.confidence)?e.confidence:0)):0,recommended_next_action:'Owner reviews evidence and exact pending payloads; no send capability installed',approval_level:'A1',crm_updates:summary,artifacts:[],risks:['Researcher assertions require source review; this runtime does not browse or generate claims','Cold email only; job applications are not generated','Conservative 90-day cooldown requires owner review for any recent company outreach'],digest};
}
