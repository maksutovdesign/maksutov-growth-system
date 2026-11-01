export function demoCandidates(now=new Date()) {
 const result=[];
 for(let i=0;i<7;i++) {
  const domain=`demo-${i}.invalid`, email=`owner@${domain}`, source=`https://${domain}/design-request`;
  const facts=[{id:'need',type:'synthetic_request',source_url:source,fact:`TEST FIXTURE: Demo ${i} requests a product interface review for its launch.`,confidence:1,observed_at:now.toISOString()},
  {id:'contact',type:'synthetic_contact',source_url:source,fact:`TEST FIXTURE: Demo ${i} lists ${email} as its design contact and requests an external design partner.`,confidence:1,observed_at:now.toISOString()}];
  result.push({synthetic:true,name:`TEST ONLY Demo ${i}`,domain,type:i<3?'direct_client':i<5?'studio_partner':'job',title:`TEST ONLY Design opportunity ${i}`,source_url:source,hard_disqualifier:false,evidence:facts,scoring:Object.fromEntries(Object.entries({need:22,fit:17,business:15,access:12,geography:8,timing:8}).map(([k,points])=>[k,{points,rationale:'Synthetic scoring for pipeline validation; not a commercial assertion',evidence_ids:['need','contact']}]))});
 }
 result[0].draft={target:'owner@demo-0.invalid',full_name:'TEST ONLY Owner',email_ownership_verified:true,email_source_url:result[0].source_url,evidence_ids:['need','contact'],subject:'TEST ONLY — interface review for Demo 0',body:'Hello Demo 0 team. This is a synthetic test message and must never be sent. Your test request describes a product interface review for an upcoming launch, and the test contact page invites an external design partner. Maksutov Design offers UX/UI and web design. A possible first discussion could focus on the launch journey and the areas where users need clearer guidance. Would a short conversation about the stated design scope be useful? Again, this payload exists only to validate a local approval queue.'};
 const low=structuredClone(result[1]);low.title='TEST ONLY Low score';low.domain='low.invalid';low.source_url='https://low.invalid/request'; for(const s of Object.values(low.scoring))s.points=1;
 const missing=structuredClone(result[2]);missing.title='TEST ONLY Missing evidence';missing.evidence=[];
 result.push(low,missing,structuredClone(result[0]));return result;
}
