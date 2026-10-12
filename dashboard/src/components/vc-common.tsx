import { Component, type ReactNode } from 'react';
import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { ExternalLink, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { safeUrl, domain, sourceParts, dateLabel } from '@/lib/vc-data';
export function Score({value}:{value:number|null}) {return <span className={`score ${value!==null && value>=20?'score-high':''}`}>{value ?? '—'}</span>;}
export function StatusPill({status}:{status:string}) {return <span className={`status-pill ${status==='Waiting for response'?'waiting':''}`}><span/>{status}</span>;}
export function SourceLink({url,label}:{url?:string|null|undefined;label?:string}) {const safe=safeUrl(url);return safe?<a className="source-link" href={safe} target="_blank" rel="noopener noreferrer" onClick={e=>e.stopPropagation()}>{label || domain(safe)}<ExternalLink size={12}/></a>:null;}
export function Summary({summary,first=false}:{summary:string|null;first?:boolean}) {if(!summary)return <span className="muted">No verified signal yet</span>;const lines=summary.split('\n').filter(Boolean);return <div className="signal-summary">{(first?lines.slice(0,1):lines).map((line,i)=>{const p=sourceParts(line);return <div key={i}><span className="signal-date">{dateLabel(p.date ?? null)}</span><span>{p.text}</span><SourceLink url={p.url} label="Source"/></div>;})}</div>;}
export function QueryState({loading,error,retry}:{loading?:boolean;error?:Error|null;retry?:()=>void}) {return <div className="query-state">{loading?<><Loader2 className="animate-spin"/>Loading…</>:<><AlertCircle/><h2>We couldn’t load this data</h2><p>{error?.message}</p><Button variant="outline" onClick={retry}>Try again</Button></>}</div>;}

class DataErrorBoundary extends Component<{children:ReactNode;onReset:()=>void},{error:Error|null}> {
  override state: {error:Error|null} = {error:null};
  static getDerivedStateFromError(error:Error) {return {error};}
  override render(){return this.state.error ? <QueryState error={this.state.error} retry={()=>{this.props.onReset();this.setState({error:null});}}/> : this.props.children;}
}
export function DataBoundary({children}:{children:ReactNode}) {return <QueryErrorResetBoundary>{({reset})=><DataErrorBoundary onReset={reset}>{children}</DataErrorBoundary>}</QueryErrorResetBoundary>;}
