import { describe,it,expect } from 'vitest';
import { analyze,daysSinceContact } from '@/lib/vc-analysis';
import type {VC,Signal} from '@/lib/vc-data';
const now=new Date('2026-10-12T12:00:00Z');
const base={id:'a',follow_up_score:42,status:'Waiting for response',recommended_action:'Hold',last_contact_date:'2026-10-05'} as VC;
describe('Dashboard metrics',()=>{
 it('handles an empty pipeline without inventing percentages',()=>{expect(analyze([],[],now).percent).toBeNull();});
 it('deduplicates verified VCs and excludes old or unrelated signals',()=>{const signals=[{vc_id:'a',signal_date:'2026-10-10'},{vc_id:'a',signal_date:'2026-10-09'},{vc_id:'b',signal_date:'2026-10-01'},{vc_id:'a',signal_date:'2026-08-01'}] as Signal[];const a=analyze([base,{...base,id:'c',follow_up_score:0}],signals,now);expect(a.percent).toBe(50);expect(a.withSignal).toBe(1);expect(a.activity).toHaveLength(2);expect(a.buckets).toEqual([1,0,0,1]);});
 it('splits reply windows at 10 days',()=>{expect(daysSinceContact(base,now)).toBe(7);const a=analyze([base,{...base,id:'c',last_contact_date:'2026-10-02'}],[],now);expect(a.inside).toHaveLength(1);expect(a.overdue).toHaveLength(1);});
});
