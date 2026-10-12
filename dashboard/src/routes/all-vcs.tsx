import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';
import { AppShell } from '@/components/vc-shell';
import { Dashboard, DashboardSkeleton } from '@/components/vc-dashboard';
export const Route=createFileRoute('/all-vcs')({head:()=>({meta:[{title:'All VCs · VC Signal'},{name:'description',content:'Your full investor pipeline with weekly signal summaries and outreach filters.'},{property:'og:title',content:'All VCs · VC Signal'},{property:'og:description',content:'Browse every investor in your private fundraising pipeline.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]}),component:AllVCsPage});
function AllVCsPage(){return <AppShell><Suspense fallback={<DashboardSkeleton/>}><Dashboard gridOnly/></Suspense></AppShell>;}
