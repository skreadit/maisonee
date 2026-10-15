import {describe,it,expect} from 'vitest';
import {quote,assertTransition,futureDate,parisDate} from '../src/lib/domain';
import {hashPassword,verifyPassword,assertSameOrigin,assertAdmin} from '../src/lib/auth';
describe('financial quotes',()=>{
  it('charges commission only on service and preserves exact cents',()=>{expect(quote(6999,3,1500,1000)).toEqual({serviceCents:20997,totalCents:22497,travelCents:1500,commissionCents:2100,chefNetCents:20397});});
  it('rejects invalid guests and injected fractional prices',()=>{expect(()=>quote(6900,0,0,1000)).toThrow();expect(()=>quote(69.1,4,0,1000)).toThrow();});
});
describe('booking state machine',()=>{
  it('only chef can accept and no caller can directly confirm payment',()=>{const now=new Date('2026-10-13T12:00:00Z');expect(()=>assertTransition('REQUESTED','ACCEPTED','CHEF','UNPAID','2026-10-14',now)).not.toThrow();expect(()=>assertTransition('REQUESTED','ACCEPTED','CLIENT','UNPAID','2026-10-14',now)).toThrow();expect(()=>assertTransition('ACCEPTED','CONFIRMED','ADMIN','UNPAID','2026-10-14',now)).toThrow();});
  it('refuses acceptance on or after the Paris service date',()=>{const now=new Date('2026-10-14T12:00:00Z');expect(()=>assertTransition('REQUESTED','ACCEPTED','CHEF','UNPAID','2026-10-14',now)).toThrow('dépassée');expect(()=>assertTransition('REQUESTED','ACCEPTED','CHEF','UNPAID','2026-10-13',now)).toThrow('dépassée');});
  it('blocks pending/paid cancellation until a refund workflow',()=>{expect(()=>assertTransition('ACCEPTED','CANCELLED','CLIENT','PAID','2026-10-14')).toThrow();expect(()=>assertTransition('ACCEPTED','CANCELLED','CLIENT','PENDING','2026-10-14')).toThrow();expect(()=>assertTransition('ACCEPTED','CANCELLED','CLIENT','UNPAID','2026-10-14')).not.toThrow();});
  it('requires paid service and a past Paris date for completion',()=>{const now=new Date('2026-10-14T12:00:00Z');expect(()=>assertTransition('CONFIRMED','COMPLETED','CHEF','PAID','2026-10-13',now)).not.toThrow();expect(()=>assertTransition('CONFIRMED','COMPLETED','CHEF','PAID','2026-10-14',now)).toThrow();expect(()=>assertTransition('CONFIRMED','COMPLETED','CHEF','UNPAID','2026-10-13',now)).toThrow();});
});
describe('validation and security',()=>{
  it('validates leap days and local dates',()=>{expect(()=>futureDate('2027-02-29',new Date('2026-10-13T10:00Z'))).toThrow();expect(parisDate(new Date('2026-10-13T23:00:00Z'))).toBe('2026-10-14');expect(()=>futureDate('2026-10-13',new Date('2026-10-13T10:00Z'))).toThrow();});
  it('hashes with independent salts and compares the correct password',async()=>{const first=await hashPassword('SecureExample123!'),second=await hashPassword('SecureExample123!');expect(first).not.toBe(second);expect(await verifyPassword('SecureExample123!',first)).toBe(true);expect(await verifyPassword('bad password',first)).toBe(false);});
  it('rejects missing and cross-site origins',()=>{process.env.APP_MODE='demo';expect(()=>assertSameOrigin(new Request('http://localhost:3000/api'))).toThrow();expect(()=>assertSameOrigin(new Request('http://localhost:3000/api',{headers:{origin:'https://attacker.invalid'}}))).toThrow();expect(()=>assertSameOrigin(new Request('http://localhost:3000/api',{headers:{origin:'http://localhost:3000'}}))).not.toThrow();});
  it('keeps production administration closed until MFA is implemented',()=>{process.env.APP_MODE='production';const admin={id:'admin',email:'admin@example.test',name:'Admin',role:'ADMIN' as const,phone:'',address:''};expect(()=>assertAdmin(admin)).toThrow('multifacteur');process.env.APP_MODE='demo';expect(()=>assertAdmin(admin)).not.toThrow();expect(()=>assertAdmin({...admin,role:'CLIENT'})).toThrow('administration');});
});
