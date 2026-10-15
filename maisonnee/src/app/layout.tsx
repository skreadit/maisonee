import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {title:{default:'Maisonnée — Les talents de demain, à votre table',template:'%s | Maisonnée'},description:'Rencontrez de jeunes chefs et imaginez une expérience culinaire chez vous. Paris et Île-de-France.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="fr"><body>{children}</body></html>;}
