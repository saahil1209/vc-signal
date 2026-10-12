import { describe, it, expect } from 'vitest';
import { groupOf, safePayload, safeUrl, sourceParts } from '@/lib/vc-data';
describe('VC Signal backend contract',()=>{
  it('groups every specified action',()=>{
    expect(groupOf('Reach out this week')).toBe('Contact this week');expect(groupOf('Follow up now')).toBe('Contact this week');
    expect(groupOf('Hold for now')).toBe('Holds');expect(groupOf('Low priority')).toBe('Monitor');
    expect(groupOf('Deprioritise')).toBe('Quiet');expect(groupOf(null)).toBe('Not scored yet');
  });
  it('never writes generated signal fields or ids',()=>{
    const values={vc_name:'Test',firm:'Firm',status:'Yet to reach out' as const,follow_up_score:90,recommended_action:'Reach out',signal_summary:'unsafe',last_signal_date:'2026-10-12',id:'abc'};
    expect(safePayload(values)).toEqual({vc_name:'Test',firm:'Firm',status:'Yet to reach out'});
  });
  it('only permits safe external links',()=>{expect(safeUrl('javascript:alert(1)')).toBeUndefined();expect(safeUrl('https://example.com/article')).toBe('https://example.com/article');});
  it('parses signal summaries without losing middle dots',()=>{expect(sourceParts('2026-10-12 · Wrote about logistics · B2B · https://example.com')).toEqual({date:'2026-10-12',text:'Wrote about logistics · B2B',url:'https://example.com'});});
});
