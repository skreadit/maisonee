import { Suspense } from 'react';
import Marketplace from '@/components/Marketplace';
export default function Page(){return <Suspense fallback={<main className="empty">Votre table se prépare…</main>}><Marketplace/></Suspense>;}
