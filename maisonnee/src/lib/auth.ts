import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {query} from './db';
import {AppError} from './domain';
import type {User} from './types';
const scrypt=(password:string,salt:string,length:number,options:{N:number;r:number;p:number;maxmem:number}):Promise<Buffer>=>new Promise((resolve,reject)=>scryptCallback(password,salt,length,options,(error,key)=>error?reject(error):resolve(key)));
export const SESSION_COOKIE='maisonnee_session';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(password:string):Promise<string> {
  const salt=randomBytes(16).toString('hex');
  const key=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password:string,stored:string):Promise<boolean> {
  const [scheme,salt,key]=stored.split(':');
  if(scheme!=='scrypt'||!salt||!key||!/^[a-f0-9]{128}$/.test(key)) {
    await scrypt(password,'invalid-user-timing-equalizer',64,{N:32768,r:8,p:1,maxmem:64*1024*1024}); return false;
  }
  const result=await scrypt(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024}) as Buffer;
  return timingSafeEqual(result,Buffer.from(key,'hex'));
}
export async function createSession(userId:string):Promise<string> {
  const token=randomBytes(32).toString('base64url');
  await query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',[hash(token),userId,new Date(Date.now()+7*86400000)]);
  return token;
}
function sessionToken(request:Request):string|null {
  const value=request.headers.get('cookie')?.split(';').map(p=>p.trim()).find(p=>p.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length+1);
  return value&&/^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
export async function getSession(request:Request):Promise<User|null> {
  const token=sessionToken(request);if(!token)return null;
  const rows=await query<User>('SELECT u.id,u.email,u.name,u.role,u.phone,u.address FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[hash(token)]);
  return rows[0]||null;
}
export async function destroySession(request:Request){const token=sessionToken(request);if(token)await query('DELETE FROM sessions WHERE token_hash=$1',[hash(token)]);}
export function sessionCookie(token:string):string {
  const secure=process.env.APP_URL?.startsWith('https://')||process.env.APP_MODE!=='demo'&&process.env.NODE_ENV==='production';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token?604800:0}${secure?'; Secure':''}`;
}
export async function requireUser(request:Request):Promise<User> {const user=await getSession(request);if(!user)throw new AppError(401,'Connectez-vous pour continuer.');return user;}
export async function requireAdmin(request:Request):Promise<User> {const user=await requireUser(request);assertAdmin(user);return user;}
export function assertAdmin(user:User) {
  if(user.role!=='ADMIN')throw new AppError(403,'Accès réservé à l’administration.');
  if(process.env.APP_MODE!=='demo')throw new AppError(503,'L’administration de production reste fermée jusqu’à la configuration et la vérification de l’authentification multifacteur.');
}
export function assertSameOrigin(request:Request) {
  const origin=request.headers.get('origin');
  const allowed=new Set<string>();
  if(process.env.APP_URL) allowed.add(new URL(process.env.APP_URL).origin);
  if(process.env.APP_MODE==='demo'||process.env.NODE_ENV==='test') {
    const url=new URL(request.url);allowed.add(url.origin);
    if(['localhost','127.0.0.1'].includes(url.hostname)) {url.hostname=url.hostname==='localhost'?'127.0.0.1':'localhost';allowed.add(url.origin);}
  }
  if(!origin||!allowed.has(origin)||request.headers.get('sec-fetch-site')==='cross-site')throw new AppError(403,'Origine de la requête non autorisée. Rechargez le site puis réessayez.');
}
export async function rateLimit(key:string,limit:number,windowSeconds:number):Promise<void> {
  const pepper=process.env.AUTH_SECRET||(process.env.APP_MODE==='demo'||process.env.NODE_ENV==='test'?'local-demo-only':'');
  if(!pepper||(process.env.APP_MODE!=='demo'&&process.env.NODE_ENV!=='test'&&pepper.length<32))throw new AppError(503,'AUTH_SECRET doit être configuré avec au moins 32 caractères aléatoires.');
  const rows=await query<{count:number}>(`INSERT INTO rate_limits(key,count,reset_at) VALUES($1,1,now()+$2 * interval '1 second')
    ON CONFLICT(key) DO UPDATE SET count=CASE WHEN rate_limits.reset_at<=now() THEN 1 ELSE rate_limits.count+1 END,
    reset_at=CASE WHEN rate_limits.reset_at<=now() THEN now()+$2 * interval '1 second' ELSE rate_limits.reset_at END RETURNING count`,[hash(pepper+key),windowSeconds]);
  if(rows[0].count>limit)throw new AppError(429,'Trop de tentatives. Patientez quelques minutes avant de réessayer.');
}
export function requestAddress(request:Request):string {return process.env.TRUST_PROXY==='true'?request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'shared':'shared';}
