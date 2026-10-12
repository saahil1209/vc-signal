import { queryOptions } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { supabase } from './supabase';

export type Status = 'Yet to reach out' | 'Waiting for response';
export interface VC {
  id: string; vc_name: string; firm: string; thesis: string | null; status: Status;
  last_contact_date: string | null; contact_history: string | null; personal_notes: string | null;
  follow_up_score: number | null; recommended_action: string | null; signal_summary: string | null;
  last_signal_date: string | null; last_run_at: string | null;
  last_run_status: 'running' | 'completed' | 'partial' | null; data_stale: boolean;
}
export interface Signal {
  id: string; vc_id: string; signal_date: string; type: 'invested'|'wrote'|'spoke'|'event'|'other';
  scope: 'person'|'firm'; relevance: 'high'|'medium'|'low'; title: string; url: string;
  evidence_quote: string | null; one_line: string;
}
export interface Run {
  id: string; run_date: string; started_at: string; finished_at: string | null; status: string;
  processed: number; with_signal: number; quiet: number; failed: number;
  errors: {vc_id: string; error: string; at: string}[] | null;
  exa_requests: number; input_tokens: number; output_tokens: number;
}
export const groups = ['Contact this week', 'Holds', 'Monitor', 'Not scored yet', 'Quiet'] as const;
export type Group = typeof groups[number];
export function groupOf(action: string | null): Group {
  if (!action) return 'Not scored yet';
  if (/^(Reach out|Follow up)/.test(action)) return 'Contact this week';
  if (action.startsWith('Hold')) return 'Holds';
  if (action.startsWith('Low priority')) return 'Monitor';
  if (action.startsWith('Deprioritise')) return 'Quiet';
  return 'Not scored yet';
}
export const pipelineOptions = queryOptions({
  queryKey: ['pipeline'],
  queryFn: async (): Promise<VC[]> => {
    const {data, error} = await supabase.from('vc_pipeline_this_week').select('*');
    if (error) throw error;
    return data ?? [];
  },
  refetchInterval: query => query.state.data?.some(v => v.last_run_status === 'running') ? 10_000 : false,
});
export const runsOptions = queryOptions({
  queryKey: ['runs'],
  queryFn: async (): Promise<Run[]> => {
    const {data,error} = await supabase.from('signal_runs').select('*').order('started_at', {ascending:false});
    if (error) throw error;
    return data ?? [];
  },
  refetchInterval: query => query.state.data?.some(r => r.status === 'running') ? 10_000 : false,
});
export function signalsOptions(id: string) {
  const since = new Date(); since.setDate(since.getDate()-30);
  return queryOptions({queryKey:['signals',id], queryFn:async (): Promise<Signal[]> => {
    const {data,error} = await supabase.from('vc_signals').select('*').eq('vc_id',id).gte('signal_date',since.toISOString().slice(0,10)).order('signal_date',{ascending:false});
    if (error) throw error; return data ?? [];
  }});
}
export type Editable = Pick<VC,'vc_name'|'firm'|'thesis'|'status'|'last_contact_date'|'contact_history'|'personal_notes'>;
export function safePayload(values: Partial<Editable>): Partial<Editable> {
  const keys: (keyof Editable)[] = ['vc_name','firm','thesis','status','last_contact_date','contact_history','personal_notes'];
  return Object.fromEntries(keys.filter(k => values[k] !== undefined).map(k => [k,values[k]]));
}
export async function saveVC(id: string, values: Partial<Editable>) {
  const {data,error} = await supabase.from('vc_pipeline').update(safePayload(values)).eq('id',id).select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Your changes could not be saved. Please check your access.');
}
export async function addVC(values: Editable) {
  const {data,error} = await supabase.from('vc_pipeline').insert(safePayload(values)).select('id').single();
  if (error) throw error; return data.id as string;
}
export function relative(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value); return isNaN(date.getTime()) ? 'Unknown' : formatDistanceToNow(date,{addSuffix:true});
}
export function dateLabel(value: string | null) {
  if (!value) return 'Never';
  const date = new Date(value); return isNaN(date.getTime()) ? value : format(date,'d MMM yyyy');
}
export function sourceParts(line: string) {
  const parts = line.split(' · '); return {date:parts[0], text:parts.slice(1,-1).join(' · ') || parts[1] || line, url:parts.length >= 3 ? parts.at(-1) : undefined};
}
export function safeUrl(url?: string | null) {
  try { const parsed = new URL(url ?? ''); return ['https:','http:'].includes(parsed.protocol) ? parsed.href : undefined; } catch { return undefined; }
}
export function domain(url: string) { try {return new URL(url).hostname.replace(/^www\./,'');} catch {return 'Source';} }

// Read-only cross-pipeline activity for dashboard charts and insights.
export const dashboardSignalsOptions = queryOptions({
  queryKey: ['dashboard-signals'],
  queryFn: async (): Promise<Signal[]> => {
    const since = new Date(); since.setDate(since.getDate() - 30);
    const { data, error } = await supabase.from('vc_signals')
      .select('id, vc_id, signal_date, type, relevance, scope, one_line, url')
      .gte('signal_date', since.toISOString().slice(0, 10))
      .order('signal_date', { ascending: false });
    if (error) throw error;
    return (data ?? []) as Signal[];
  },
});
