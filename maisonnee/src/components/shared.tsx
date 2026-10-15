'use client';
import Link from 'next/link';
import { ArrowRight, UtensilsCrossed } from 'lucide-react';
import type { User,Chef,Booking,Message,Notification } from '@/lib/types';
export type { User,Chef,Booking,Message,Notification,Menu } from '@/lib/types';
export type Admin={chefs:Chef[];users:User[];bookings:Booking[];commission:{basisPoints:number};commissionHistory:Record<string,unknown>[];auditLogs:{id:string;action:string;createdAt:string}[];supportTickets:{id:string;subject:string;body:string;status:string}[];metrics:Record<string,number>};
export type Data={user:User|null;chefs:Chef[];bookings:Booking[];favorites:string[];messages:Message[];notifications:Notification[];myChef?:Chef|null;admin?:Admin;demo?:boolean};
export type Action=(action:string,fields?:Record<string,unknown>,success?:string)=>Promise<Record<string,unknown>|null>;
export const money=(c:number)=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:c%100?2:0}).format(c/100);
export const day=(s:string)=>new Date(s.slice(0,10)+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'});
export const minDate=()=>{const d=new Date();d.setDate(d.getDate()+1);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
export const labels:Record<string,string>={REQUESTED:'Demande envoyée',ACCEPTED:'Acceptée · paiement attendu',CONFIRMED:'Confirmée',COMPLETED:'Terminée',CANCELLED:'Annulée',DECLINED:'Déclinée',EXPIRED:'Expirée',DISPUTED:'En litige',UNPAID:'Non payé',PAID:'Payé',PENDING:'En attente',APPROVED:'Publié',DRAFT:'Brouillon',REJECTED:'À modifier'};
export function Empty({title,text,href,cta}:{title:string;text:string;href:string;cta:string}){return <div className="empty"><UtensilsCrossed size={28}/><h2>{title}</h2><p>{text}</p><Link className="btn" href={href}>{cta}<ArrowRight size={16}/></Link></div>;}
export function Skeleton(){return <div className="chef-grid skeletons" aria-busy="true" aria-label="Chargement">{[1,2,3].map(i=><div className="skeleton" key={i}/>)}</div>;}
