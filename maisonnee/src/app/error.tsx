'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="empty"><h1>Un imprévu en cuisine.</h1><p>La page n’a pas pu être chargée. Réessayez dans un instant.</p><button className="btn" onClick={reset}>Réessayer</button></main>;}
