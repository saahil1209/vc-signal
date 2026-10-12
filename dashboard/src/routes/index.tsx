import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { AppShell } from '@/components/vc-shell';
import { Dashboard, DashboardSkeleton } from '@/components/vc-dashboard';
export const Route=createFileRoute('/')({head:()=>({meta:[{title:'This week · VC Signal'},{name:'description',content:'Weekly investor priorities, verified signals, and fundraising insights.'},{property:'og:title',content:'This week · VC Signal'},{property:'og:description',content:'Your investor outreach priorities and pipeline analysis.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:WeekPage});
function WeekPage(){return <AppShell><Suspense fallback={<DashboardSkeleton/>}><Dashboard/></Suspense></AppShell>;}
