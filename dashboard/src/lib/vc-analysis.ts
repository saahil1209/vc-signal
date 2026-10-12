import { groupOf, type VC, type Signal } from './vc-data';
export function daysSinceContact(vc:VC, now=new Date()) {
  if(!vc.last_contact_date)return null;
  const date=new Date(`${vc.last_contact_date.slice(0,10)}T00:00:00Z`);
  const today=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  return Number.isNaN(date.getTime())?null:Math.max(0,Math.floor((today-date.getTime())/86400000));
}
export function analyze(rows:VC[],signals:Signal[],now=new Date()) {
  const ids=new Set(rows.map(v=>v.id));
  const since=new Date(now);since.setDate(since.getDate()-30);
  const activity=signals.filter(s=>ids.has(s.vc_id)&&s.signal_date.slice(0,10)>=since.toISOString().slice(0,10)&&s.signal_date.slice(0,10)<=now.toISOString().slice(0,10));
  const scored=rows.filter(v=>v.follow_up_score!==null);
  const signalIds=new Set(activity.map(s=>s.vc_id));
  const withSignal=scored.filter(v=>signalIds.has(v.id)).length;
  const waiting=rows.filter(v=>v.status==='Waiting for response');
  const inside=waiting.filter(v=>groupOf(v.recommended_action)==='Holds'&&daysSinceContact(v,now)!==null&&(daysSinceContact(v,now)??10)<10);
  const overdue=waiting.filter(v=>daysSinceContact(v,now)!==null&&(daysSinceContact(v,now)??0)>=10);
  const buckets=[scored.filter(v=>v.follow_up_score===0).length,scored.filter(v=>(v.follow_up_score??0)>=1&&(v.follow_up_score??0)<20).length,scored.filter(v=>(v.follow_up_score??0)>=20&&(v.follow_up_score??0)<40).length,scored.filter(v=>(v.follow_up_score??0)>=40).length];
  return {activity,scored,withSignal,percent:scored.length?Math.round(withSignal/scored.length*100):null,waiting,inside,overdue,buckets};
}
