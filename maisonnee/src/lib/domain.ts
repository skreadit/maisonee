import type { BookingStatus, PaymentStatus } from './types';

export class AppError extends Error { constructor(public status:number, message:string) { super(message); this.name='AppError'; } }
export function text(value:unknown, label:string, min=1, max=1000):string {
  if(typeof value!=='string'||value.trim().length<min||value.trim().length>max) throw new AppError(400,`${label} : entre ${min} et ${max} caractères attendus.`);
  return value.trim();
}
export function integer(value:unknown,label:string,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max) throw new AppError(400,`${label} doit être un entier entre ${min} et ${max}.`);
  return value;
}
export function parisDate(now=new Date()):string { return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(now); }
export function futureDate(value:unknown, now=new Date()):string {
  const date=text(value,'Date',10,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(`${date}T12:00:00Z`).toISOString().slice(0,10)!==date||date<=parisDate(now)||date>new Date(now.getTime()+366*86400000).toISOString().slice(0,10)) throw new AppError(400,'Choisissez une date valide, à partir de demain et dans les 12 prochains mois.');
  return date;
}
export function quote(pricePerPerson:number,guests:number,travelCents:number,basisPoints:number) {
  integer(pricePerPerson,'Prix',100,1000000); integer(guests,'Convives',1,100); integer(travelCents,'Déplacement',0,100000); integer(basisPoints,'Commission',0,5000);
  const serviceCents=pricePerPerson*guests;
  // Commission porte uniquement sur la prestation, hors déplacement ; arrondi au centime.
  const commissionCents=Math.round(serviceCents*basisPoints/10000);
  return {serviceCents,travelCents,totalCents:serviceCents+travelCents,commissionCents,chefNetCents:serviceCents+travelCents-commissionCents};
}
export function assertTransition(from:BookingStatus,to:BookingStatus,actor:'CLIENT'|'CHEF'|'ADMIN',payment:PaymentStatus,date:string,now=new Date()) {
  const available:Record<string,BookingStatus[]>={
    CLIENT_REQUESTED:['CANCELLED'],CLIENT_ACCEPTED:['CANCELLED'],CLIENT_CONFIRMED:['DISPUTED'],CLIENT_COMPLETED:['DISPUTED'],
    CHEF_REQUESTED:['ACCEPTED','DECLINED'],CHEF_ACCEPTED:['CANCELLED'],CHEF_CONFIRMED:['COMPLETED','DISPUTED'],
    ADMIN_REQUESTED:['CANCELLED','DECLINED'],ADMIN_ACCEPTED:['CANCELLED'],ADMIN_CONFIRMED:['DISPUTED'],ADMIN_COMPLETED:['DISPUTED'],
  };
  if(!(available[`${actor}_${from}`]||[]).includes(to)) throw new AppError(409,'Cette modification de statut n’est pas autorisée.');
  if(to==='ACCEPTED'&&date<=parisDate(now)) throw new AppError(409,'La date de cette demande est dépassée. Elle ne peut plus être acceptée.');
  if(['CANCELLED','DECLINED'].includes(to)&&!['UNPAID','FAILED'].includes(payment)) throw new AppError(409,'Un paiement est en cours ou encaissé. Contactez le support pour sécuriser l’annulation et le remboursement.');
  if(to==='COMPLETED'&&(payment!=='PAID'||date>=parisDate(now))) throw new AppError(409,'La prestation doit être payée et sa date passée pour être terminée.');
}
export function slugify(value:string):string {return value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');}
