import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { Activity, ArrowRight, ChevronDown, LayoutList, LockKeyhole, LogOut, Moon, Plus, Radio, Sun, ShieldCheck, Loader2, Users } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DataBoundary } from '@/components/vc-common';
import { supabase } from '@/lib/supabase';
import { addVC, type Status } from '@/lib/vc-data';

const AuthContext = createContext<Session | null>(null);
export function useSession() { return useContext(AuthContext); }
export function AppShell({children}: {children:ReactNode}) {
  const [session,setSession] = useState<Session|null>(null);
  const [ready,setReady] = useState(false);
  const [dark,setDark] = useState(true);
  const [adding,setAdding] = useState(false);
  const queryClient = useQueryClient();
  const path = useRouterState({select:s=>s.location.pathname});
  useEffect(()=> {
    const saved = localStorage.getItem('vc-signal-theme') !== 'light'; setDark(saved); document.documentElement.classList.toggle('dark',saved);
    supabase.auth.getSession().then(({data})=>{setSession(data.session); setReady(true);}).catch(()=>setReady(true));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((event,next)=>{setSession(next);setReady(true);if(event==='SIGNED_OUT')queryClient.clear();});
    return ()=>subscription.unsubscribe();
  },[queryClient]);
  function toggleTheme() {const next=!dark; setDark(next); localStorage.setItem('vc-signal-theme',next?'dark':'light'); document.documentElement.classList.toggle('dark',next);}
  return <AuthContext.Provider value={session}><div className="app-layout">
    <aside className="sidebar">
      <Link to="/" className="brand"><span className="brand-mark"><Activity size={20}/></span><span>VC Signal<span className="brand-sub">FOUNDER WORKSPACE</span></span></Link>
      <div className="workspace"><span className="workspace-avatar">V</span><span>Seed round<span className="workspace-sub">B2B logistics SaaS</span></span><ChevronDown size={14}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav><Link to="/" className={`nav-item ${path==='/' || path.startsWith('/vc/')?'active':''}`}><LayoutList size={17}/>This week</Link><Link to="/all-vcs" className={`nav-item ${path==='/all-vcs'?'active':''}`}><Users size={17}/>All VCs</Link><Link to="/runs" className={`nav-item ${path==='/runs'?'active':''}`}><Radio size={17}/>Runs</Link></nav>
      <div className="sidebar-bottom"><div className="private-label"><ShieldCheck size={15}/>Private workspace</div><div className="account"><span className="workspace-avatar">{session?.user.email?.[0]?.toUpperCase() || 'V'}</span><span className="account-text">{session?.user.email || 'Vikram'}<small>{session ? 'Founder' : 'Seed fundraising'}</small></span>{session && <Button variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={async()=>{const {error}=await supabase.auth.signOut();if(error)toast.error(error.message);}}><LogOut size={16}/></Button>}</div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><span className="breadcrumb">Workspace <span>/</span> <strong>{path==='/runs'?'Runs':path==='/all-vcs'?'All VCs':path.startsWith('/vc/')?'Investor details':'This week'}</strong></span><div className="topbar-actions"><span className="topbar-welcome">Welcome back <strong>{String(session?.user.user_metadata?.['full_name'] || session?.user.user_metadata?.['name'] || 'Vikram')}</strong><span className="workspace-avatar">{session?.user.email?.[0]?.toUpperCase() || 'V'}</span></span><Button variant="ghost" size="icon" title={dark?'Use light theme':'Use dark theme'} aria-label="Toggle theme" onClick={toggleTheme}>{dark?<Sun/>:<Moon/>}</Button>{session && <Button className="mobile-signout" variant="ghost" size="icon" title="Sign out" aria-label="Sign out" onClick={async()=>{const {error}=await supabase.auth.signOut();if(error)toast.error(error.message);}}><LogOut size={16}/></Button>}{session && <Button size="sm" onClick={()=>setAdding(true)}><Plus/>Add VC</Button>}</div></header>
      {!ready ? <div className="loading-state"><Loader2 className="animate-spin"/>Loading workspace…</div> : session ? <DataBoundary>{children}</DataBoundary> : <SignIn/>}
      <footer className="app-footer"><span>VC Signal</span><span>Less noise. Better conversations.</span></footer>
    </div><AddDialog open={adding} onOpenChange={setAdding}/><Toaster richColors theme={dark?'dark':'light'} position="bottom-right"/></div></AuthContext.Provider>;
}
function SignIn() {
  const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  return <main className="auth-main"><div className="auth-heading"><span className="eyebrow"><span className="live-dot"/>YOUR FUNDRAISING, IN FOCUS</span><h1>The right conversation.<br/>At the right time.</h1><p>A clearer view of your next investor outreach.</p></div><form className="auth-form" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');try {const {error}=await supabase.auth.signInWithPassword({email,password});if(error)throw error;}catch(e){setError(e instanceof Error?e.message:'Unable to sign in.');}finally{setBusy(false);}}}>
    <span className="auth-icon"><LockKeyhole size={22}/></span><h2>Welcome to VC Signal</h2><p>Sign in to your private workspace.</p><label htmlFor="email">Email address</label><input id="email" type="email" placeholder="you@company.com" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)}/><label htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)}/><Button className="w-full" disabled={busy} type="submit">{busy?<Loader2 className="animate-spin"/>:'Sign in'}{!busy && <ArrowRight/>}</Button>{error && <p className="error-text" role="alert">{error}</p>}<div className="auth-security"><ShieldCheck size={14}/>Private workspace. Access is granted by the owner.</div>
  </form><div className="auth-bottom">A private workspace for your next chapter.</div></main>;
}
function AddDialog({open,onOpenChange}:{open:boolean;onOpenChange:(v:boolean)=>void}) {
  const client=useQueryClient();const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  return <Dialog open={open} onOpenChange={v=>{setError('');onOpenChange(v);}}><DialogContent className="add-dialog"><DialogHeader><DialogTitle>Add an investor</DialogTitle><DialogDescription>New VCs will be scored in the next scan.</DialogDescription></DialogHeader><form className="form-stack" onSubmit={async e=>{e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);setError('');try{await addVC({vc_name:String(f.get('name')).trim(),firm:String(f.get('firm')).trim(),thesis:String(f.get('thesis'))||null,status:String(f.get('status')) as Status,last_contact_date:String(f.get('date'))||null,contact_history:null,personal_notes:null});await client.invalidateQueries({queryKey:['pipeline']});toast.success('Investor added');onOpenChange(false);}catch(e){setError(e instanceof Error?e.message:'Unable to add investor.');}finally{setBusy(false);}}}>
    <label>Name<input name="name" required placeholder="Investor name"/></label><label>Firm<input name="firm" required placeholder="Venture capital firm"/></label><label>Thesis<textarea name="thesis" rows={3} placeholder="Investment focus and fit"/></label><div className="form-pair"><label>Status<select name="status"><option>Yet to reach out</option><option>Waiting for response</option></select></label><label>Last contact<input name="date" type="date"/></label></div>{error && <p className="error-text" role="alert">{error}</p>}<div className="dialog-actions"><Button variant="outline" type="button" onClick={()=>onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}>{busy?<Loader2 className="animate-spin"/>:<Plus/>}Add VC</Button></div></form></DialogContent></Dialog>;
}
