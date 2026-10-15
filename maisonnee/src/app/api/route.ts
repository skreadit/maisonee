import {randomUUID} from 'node:crypto';
import {query,transaction,type DbClient} from '@/lib/db';
import {assertAdmin,assertSameOrigin,createSession,destroySession,getSession,hashPassword,rateLimit,requestAddress,sessionCookie,verifyPassword} from '@/lib/auth';
import {AppError,assertTransition,futureDate,integer,parisDate,quote,slugify,text} from '@/lib/domain';
import type {Booking,BookingStatus,Chef,Menu,PaymentStatus,User} from '@/lib/types';
import {expireBookingHolds,holdHours} from '@/lib/booking-expiry';
export const runtime='nodejs';
export const dynamic='force-dynamic';
type Row=Record<string,unknown>;
const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
const userColumns='id,email,name,role,phone,address';
const bookingColumns=`b.id,b.chef_id AS "chefId",b.client_id AS "clientId",c.name AS "chefName",u.name AS "clientName",b.date,b.guests,b.menu_name AS "menuName",b.total_cents AS "totalCents",b.commission_cents AS "commissionCents",b.chef_net_cents AS "chefNetCents",b.travel_cents AS "travelCents",b.status,b.payment_status AS "paymentStatus",b.address,b.notes,b.created_at AS "createdAt"`;
function email(value:unknown){const result=text(value,'E-mail',5,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))throw new AppError(400,'Renseignez une adresse e-mail valide.');return result;}
function requireSignedIn(user:User|null):User {if(!user)throw new AppError(401,'Connectez-vous pour continuer.');return user;}
function cleanOptional(value:unknown,label:string,max=1000){return value===undefined?'':text(value,label,0,max);}
async function notify(tx:DbClient,userId:string,title:string,body:string){await tx.query('INSERT INTO notifications(id,user_id,title,body) VALUES($1,$2,$3,$4)',[randomUUID(),userId,title,body]);}
async function audit(tx:DbClient,actor:string,action:string,resourceType:string,resourceId:string,metadata:Row={}) {await tx.query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),actor,action,resourceType,resourceId,JSON.stringify(metadata)]);}
async function ownChef(user:User,tx:DbClient={query}):Promise<{id:string;user_id:string}> {const row=(await tx.query<{id:string;user_id:string}>('SELECT id,user_id FROM chef_profiles WHERE user_id=$1',[user.id]))[0];if(!row)throw new AppError(403,'Créez d’abord votre profil chef.');return row;}
async function loadChefs(includePrivate=false,userId?:string):Promise<Chef[]> {
  const chefs=await query<Chef & {userId:string}>(`SELECT c.id,c.user_id AS "userId",c.slug,c.name,c.city,c.cuisine,c.bio,c.image,c.portrait,c.tags,c.status,c.travel_cents AS "travelCents",COALESCE((SELECT min(price_per_person) FROM menus m WHERE m.chef_id=c.id AND m.active),0) AS "pricePerPerson" FROM chef_profiles c ${includePrivate?'':userId?'WHERE c.user_id=$1':"WHERE c.status='APPROVED'"} ORDER BY c.created_at,c.name`,userId&&!includePrivate?[userId]:[]);
  if(!chefs.length)return [];
  const ids=chefs.map(c=>c.id);
  const [menus,availability,reviews]=await Promise.all([
    query<Menu & {chefId:string}>('SELECT id,chef_id AS "chefId",name,description,starter,main,dessert,price_per_person AS "pricePerPerson",min_guests AS "minGuests",max_guests AS "maxGuests",allergens FROM menus WHERE active AND chef_id=ANY($1::text[]) ORDER BY price_per_person',[ids]),
    query<{chefId:string;date:string}>(`SELECT a.chef_id AS "chefId",a.date FROM chef_availability a WHERE a.chef_id=ANY($1::text[]) AND a.date>$2 ${userId?'':"AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.chef_id=a.chef_id AND b.date=a.date AND b.status IN ('REQUESTED','ACCEPTED','CONFIRMED','DISPUTED'))"} ORDER BY a.date`,[ids,parisDate()]),
    query<{chefId:string;name:string;rating:number;comment:string;createdAt:string}>('SELECT r.chef_id AS "chefId",split_part(u.name,\' \',1) AS name,r.rating,r.comment,r.created_at AS "createdAt" FROM reviews r JOIN users u ON u.id=r.client_id WHERE r.chef_id=ANY($1::text[]) ORDER BY r.created_at DESC',[ids]),
  ]);
  return chefs.map(({userId,...chef})=>{void userId;const chefReviews=reviews.filter(r=>r.chefId===chef.id).map(({chefId,...r})=>{void chefId;return r;});return {...chef,menus:menus.filter(m=>m.chefId===chef.id).map(({chefId,...m})=>{void chefId;return m;}),availability:availability.filter(a=>a.chefId===chef.id).map(a=>a.date),reviews:chefReviews,rating:chefReviews.length?chefReviews.reduce((s,r)=>s+r.rating,0)/chefReviews.length:null,reviewCount:chefReviews.length};});
}
async function loadBootstrap(user:User|null) {
  await transaction(tx=>expireBookingHolds(tx));
  const chefs=await loadChefs();
  if(!user)return {user:null,chefs,bookings:[],favorites:[],messages:[],notifications:[],myChef:null,admin:null,demo:process.env.APP_MODE==='demo'};
  const isAdmin=user.role==='ADMIN';if(isAdmin)assertAdmin(user);
  const [bookings,favorites,messages,notifications,myChefs]=await Promise.all([
    query<Booking>(`SELECT ${bookingColumns} FROM bookings b JOIN chef_profiles c ON c.id=b.chef_id JOIN users u ON u.id=b.client_id ${isAdmin?'':'WHERE b.client_id=$1 OR c.user_id=$1'} ORDER BY b.created_at DESC LIMIT 500`,isAdmin?[]:[user.id]),
    query<{chefId:string}>('SELECT chef_id AS "chefId" FROM favorites WHERE user_id=$1',[user.id]),
    query(`SELECT m.id,m.booking_id AS "bookingId",m.sender_id AS "senderId",u.name AS "senderName",m.body,m.created_at AS "createdAt" FROM messages m JOIN bookings b ON b.id=m.booking_id JOIN chef_profiles c ON c.id=b.chef_id JOIN users u ON u.id=m.sender_id ${isAdmin?'':'WHERE b.client_id=$1 OR c.user_id=$1'} ORDER BY m.created_at DESC LIMIT 1000`,isAdmin?[]:[user.id]),
    query('SELECT id,title,body,read,created_at AS "createdAt" FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[user.id]),
    loadChefs(false,user.id),
  ]);
  let admin=null;
  if(isAdmin) {
    const [users,allChefs,commission,commissionHistory,auditLogs,supportTickets,totals]=await Promise.all([
      query(`SELECT ${userColumns},created_at AS "createdAt" FROM users ORDER BY created_at DESC LIMIT 500`),loadChefs(true),
      query<{basisPoints:number}>('SELECT basis_points AS "basisPoints" FROM commission_rules WHERE active'),
      query('SELECT id,basis_points AS "basisPoints",active,created_at AS "createdAt" FROM commission_rules ORDER BY created_at DESC LIMIT 50'),
      query('SELECT id,actor_id AS "actorId",action,resource_type AS "resourceType",resource_id AS "resourceId",metadata,created_at AS "createdAt" FROM audit_logs ORDER BY created_at DESC LIMIT 100'),
      query('SELECT id,email,category,subject,body,status,created_at AS "createdAt" FROM support_tickets ORDER BY created_at DESC LIMIT 200'),
      query<{projected:string;paid:string;commission:string;open:number}>(`SELECT COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED','DECLINED','EXPIRED') THEN total_cents ELSE 0 END),0) AS projected,COALESCE(SUM(CASE WHEN payment_status='PAID' THEN total_cents ELSE 0 END),0) AS paid,COALESCE(SUM(CASE WHEN payment_status='PAID' THEN commission_cents ELSE 0 END),0) AS commission,(SELECT COUNT(*)::int FROM support_tickets WHERE status='OPEN') AS open FROM bookings`),
    ]);
    admin={users,chefs:allChefs,bookings,commission:commission[0]||{basisPoints:1000},commissionHistory,auditLogs,supportTickets,metrics:{projectedVolumeCents:Number(totals[0].projected),paidVolumeCents:Number(totals[0].paid),commissionPaidCents:Number(totals[0].commission),openTickets:totals[0].open}};
  }
  return {user,chefs,bookings,favorites:favorites.map(f=>f.chefId),messages:messages.reverse(),notifications,myChef:myChefs[0]||null,admin,demo:process.env.APP_MODE==='demo'};
}
function respondError(error:unknown) {
  if(error instanceof AppError)return json({error:error.message},error.status);
  const code=(error as {code?:string})?.code;
  if(code==='23505')return json({error:'Cette donnée existe déjà ou ce créneau vient d’être réservé. Rechargez puis réessayez.'},409);
  console.error('API failure',{name:error instanceof Error?error.name:'UnknownError',code});
  return json({error:'Le service est momentanément indisponible. Vos données enregistrées sont conservées.'},500);
}
export async function GET(request:Request) {try{return json(await loadBootstrap(await getSession(request)));}catch(error){return respondError(error);}}
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    if(!request.headers.get('content-type')?.includes('application/json'))throw new AppError(415,'Format de requête incorrect.');
    if(Number(request.headers.get('content-length')||0)>32768)throw new AppError(413,'La demande est trop volumineuse.');
    const raw=await request.text();if(raw.length>32768)throw new AppError(413,'La demande est trop volumineuse.');
    let body:Row;try{body=JSON.parse(raw) as Row;}catch{throw new AppError(400,'La demande est illisible.');}
    if(!body||typeof body!=='object'||Array.isArray(body))throw new AppError(400,'La demande est incorrecte.');
    const action=text(body.action,'Action',1,50);
    const session=await getSession(request);
    await rateLimit(`mutation:${session?.id||requestAddress(request)}`,180,60);
    if(action==='register'||action==='login') {
      const mail=email(body.email);const password=text(body.password,'Mot de passe',action==='register'?12:1,128);
      await rateLimit(`auth:email:${mail}`,12,900);await rateLimit(`auth:address:${requestAddress(request)}`,120,900);
      let user:User;
      if(action==='register') {
        if(body.acceptTerms!==true)throw new AppError(400,'L’acceptation des conditions est nécessaire.');
        const name=text(body.name,'Nom',2,100);const passwordHash=await hashPassword(password);
        user=(await query<User>(`INSERT INTO users(id,email,name,password_hash) VALUES($1,$2,$3,$4) RETURNING ${userColumns}`,[randomUUID(),mail,name,passwordHash]))[0];
      } else {
        const row=(await query<User & {password_hash:string}>(`SELECT ${userColumns},password_hash FROM users WHERE email=$1`,[mail]))[0];
        if(!await verifyPassword(password,row?.password_hash||''))throw new AppError(401,'E-mail ou mot de passe incorrect.');
        if(row.role==='ADMIN')assertAdmin(row);
        const {password_hash,...safeUser}=row;void password_hash;user=safeUser;
      }
      // Rotate any existing authenticated browser session on login.
      await destroySession(request);const token=await createSession(user.id);
      return json({ok:true,user},200,{'Set-Cookie':sessionCookie(token)});
    }
    if(action==='logout'){await destroySession(request);return json({ok:true},200,{'Set-Cookie':sessionCookie('')});}
    if(action==='createSupport') {
      await rateLimit(`support:${session?.id||requestAddress(request)}`,5,3600);
      const mail=session?.email||email(body.email);const category=text(body.category||'Autre','Catégorie',2,60),subject=text(body.subject,'Objet',3,150),message=text(body.body,'Message',10,4000);
      const id=randomUUID();await query('INSERT INTO support_tickets(id,user_id,email,category,subject,body) VALUES($1,$2,$3,$4,$5,$6)',[id,session?.id||null,mail,category,subject,message]);return json({ok:true,ticketId:id});
    }
    const user=requireSignedIn(session);
    if(action==='updateProfile') {
      const name=text(body.name,'Nom',2,100),phone=cleanOptional(body.phone,'Téléphone',30),address=cleanOptional(body.address,'Adresse',500);
      await query('UPDATE users SET name=$1,phone=$2,address=$3 WHERE id=$4',[name,phone,address,user.id]);return json({ok:true});
    }
    if(action==='becomeChef') {
      const name=text(body.name||user.name,'Nom public',2,100),city=text(body.city,'Ville',2,100),cuisine=text(body.cuisine,'Cuisine',2,100),bio=text(body.bio,'Présentation',20,2000);
      const tags=Array.isArray(body.tags)?body.tags.slice(0,5).map(t=>text(t,'Spécialité',2,40)):[];
      const travelCents=body.travelCents===undefined?0:integer(body.travelCents,'Déplacement',0,100000);
      await transaction(async tx=>{const existing=await tx.query<{id:string}>('SELECT id FROM chef_profiles WHERE user_id=$1 FOR UPDATE',[user.id]);
        if(existing.length)await tx.query("UPDATE chef_profiles SET name=$1,city=$2,cuisine=$3,bio=$4,tags=$5,travel_cents=$6,status='PENDING' WHERE user_id=$7",[name,city,cuisine,bio,JSON.stringify(tags),travelCents,user.id]);
        else await tx.query("INSERT INTO chef_profiles(id,user_id,slug,name,city,cuisine,bio,tags,travel_cents,image) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'/images/plate.jpg')",[randomUUID(),user.id,`${slugify(name)}-${randomUUID().slice(0,8)}`,name,city,cuisine,bio,JSON.stringify(tags),travelCents]);
        if(user.role==='CLIENT')await tx.query("UPDATE users SET role='CHEF' WHERE id=$1",[user.id]);
        await notify(tx,user.id,'Candidature enregistrée','Votre profil sera publié après examen par l’équipe. Complétez votre menu et vos disponibilités.');
      });return json({ok:true});
    }
    if(action==='saveMenu') {
      const chef=await ownChef(user);const name=text(body.name,'Nom du menu',2,120),description=text(body.description||'Menu trois temps','Description',3,2000),starter=text(body.starter,'Entrée',2,500),main=text(body.main,'Plat',2,500),dessert=text(body.dessert,'Dessert',2,500);
      const price=integer(body.pricePerPerson,'Prix par personne en centimes',100,1000000),min=integer(body.minGuests,'Minimum de convives',1,100),max=integer(body.maxGuests,'Maximum de convives',min,100),allergens=cleanOptional(body.allergens,'Allergènes',1500);
      if(body.id){const id=text(body.id,'Menu',1,100);const rows=await query('UPDATE menus SET name=$1,description=$2,starter=$3,main=$4,dessert=$5,price_per_person=$6,min_guests=$7,max_guests=$8,allergens=$9,updated_at=now() WHERE id=$10 AND chef_id=$11 RETURNING id',[name,description,starter,main,dessert,price,min,max,allergens,id,chef.id]);if(!rows.length)throw new AppError(404,'Menu introuvable.');return json({ok:true,menuId:id});}
      const id=randomUUID();await query('INSERT INTO menus(id,chef_id,name,description,starter,main,dessert,price_per_person,min_guests,max_guests,allergens) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,chef.id,name,description,starter,main,dessert,price,min,max,allergens]);return json({ok:true,menuId:id});
    }
    if(action==='saveAvailability') {
      const chef=await ownChef(user);if(!Array.isArray(body.dates)||body.dates.length>366)throw new AppError(400,'La liste de dates est incorrecte.');
      const dates=[...new Set(body.dates.map(d=>futureDate(d)))];
      await transaction(async tx=>{await tx.query('SELECT id FROM chef_profiles WHERE id=$1 FOR UPDATE',[chef.id]);await expireBookingHolds(tx,{chefId:chef.id});await tx.query('DELETE FROM chef_availability WHERE chef_id=$1',[chef.id]);for(const date of dates)await tx.query('INSERT INTO chef_availability(chef_id,date) VALUES($1,$2)',[chef.id,date]);});return json({ok:true});
    }
    if(action==='createBooking') {
      const chefId=text(body.chefId,'Chef',1,100),menuId=text(body.menuId,'Menu',1,100),date=futureDate(body.date),guests=integer(body.guests,'Convives',1,100),address=text(body.address,'Adresse',10,500),notes=cleanOptional(body.notes,'Précisions',2000),key=text(body.idempotencyKey,'Clé de réservation',8,100);
      const bookingId=await transaction(async tx=>{
        // Lock the chef row: availability edits, competing dates and quote snapshots share one transaction boundary.
        const chef=(await tx.query<{id:string;user_id:string;name:string;status:string;travel_cents:number}>('SELECT id,user_id,name,status,travel_cents FROM chef_profiles WHERE id=$1 FOR UPDATE',[chefId]))[0];
        if(!chef||chef.status!=='APPROVED')throw new AppError(404,'Ce chef n’est pas disponible à la réservation.');
        if(chef.user_id===user.id)throw new AppError(400,'Vous ne pouvez pas réserver votre propre prestation.');
        await expireBookingHolds(tx,{chefId});
        const existing=(await tx.query<{id:string;chef_id:string;menu_id:string;date:string;guests:number}>('SELECT id,chef_id,menu_id,date,guests FROM bookings WHERE client_id=$1 AND idempotency_key=$2',[user.id,key]))[0];
        if(existing){if(existing.chef_id!==chefId||existing.menu_id!==menuId||existing.date!==date||existing.guests!==guests)throw new AppError(409,'Cette clé correspond à une autre réservation.');return existing.id;}
        if(!(await tx.query('SELECT date FROM chef_availability WHERE chef_id=$1 AND date=$2',[chefId,date])).length)throw new AppError(409,'Le chef n’est pas disponible à cette date.');
        if((await tx.query("SELECT id FROM bookings WHERE chef_id=$1 AND date=$2 AND status IN ('REQUESTED','ACCEPTED','CONFIRMED','DISPUTED')",[chefId,date])).length)throw new AppError(409,'Ce créneau vient d’être réservé. Choisissez une autre date.');
        const menu=(await tx.query<{id:string;name:string;price_per_person:number;min_guests:number;max_guests:number}>('SELECT * FROM menus WHERE id=$1 AND chef_id=$2 AND active FOR SHARE',[menuId,chefId]))[0];
        if(!menu)throw new AppError(404,'Ce menu n’est plus disponible.');integer(guests,'Convives',menu.min_guests,menu.max_guests);
        const rule=(await tx.query<{id:string;basis_points:number}>('SELECT id,basis_points FROM commission_rules WHERE active FOR SHARE'))[0];if(!rule)throw new AppError(503,'La tarification est momentanément indisponible.');
        const prices=quote(menu.price_per_person,guests,chef.travel_cents,rule.basis_points);const id=randomUUID();
        await tx.query("INSERT INTO bookings(id,chef_id,client_id,menu_id,date,guests,menu_name,menu_snapshot,commission_rule_id,commission_basis_points,total_cents,commission_cents,chef_net_cents,travel_cents,address,notes,idempotency_key,request_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,LEAST(now()+$18 * interval '1 hour',$5::text::date::timestamp AT TIME ZONE 'Europe/Paris'))",[id,chefId,user.id,menuId,date,guests,menu.name,JSON.stringify(menu),rule.id,rule.basis_points,prices.totalCents,prices.commissionCents,prices.chefNetCents,prices.travelCents,address,notes,key,holdHours('request')]);
        await tx.query("INSERT INTO booking_status_history(id,booking_id,status,actor_id) VALUES($1,$2,'REQUESTED',$3)",[randomUUID(),id,user.id]);
        await notify(tx,chef.user_id,'Nouvelle demande',`${user.name} souhaite vous réserver le ${date} pour ${guests} convives.`);
        await notify(tx,user.id,'Demande envoyée',`${chef.name} va étudier votre demande du ${date}. Aucun paiement n’a été encaissé.`);
        return id;
      });return json({ok:true,bookingId},201);
    }
    if(action==='transitionBooking') {
      const id=text(body.bookingId,'Réservation',1,100),to=text(body.status,'Statut',1,30) as BookingStatus;
      await transaction(tx=>expireBookingHolds(tx,{bookingId:id}));
      await transaction(async tx=>{
        const booking=(await tx.query<{status:BookingStatus;payment_status:PaymentStatus;date:string;client_id:string;chef_id:string;chef_user_id:string;request_expired:boolean}>(`SELECT b.*,b.request_expires_at<=now() AS request_expired,c.user_id AS chef_user_id FROM bookings b JOIN chef_profiles c ON c.id=b.chef_id WHERE b.id=$1 FOR UPDATE OF b`,[id]))[0];
        if(!booking)throw new AppError(404,'Réservation introuvable.');
        const actor=booking.client_id===user.id?'CLIENT':booking.chef_user_id===user.id?'CHEF':user.role==='ADMIN'?'ADMIN':null;
        if(!actor)throw new AppError(403,'Vous ne pouvez pas modifier cette réservation.');if(actor==='ADMIN')assertAdmin(user);
        assertTransition(booking.status,to,actor,booking.payment_status,booking.date);
        if(to==='ACCEPTED'&&booking.request_expired)throw new AppError(409,'Le délai de réponse à cette demande est dépassé.');
        if(['CANCELLED','DECLINED'].includes(to)&&(await tx.query("SELECT id FROM payment_attempts WHERE booking_id=$1 AND state IN ('CREATED','PENDING')",[id])).length)throw new AppError(409,'Une session de paiement reste ouverte. Contactez le support avant d’annuler.');
        await tx.query("UPDATE bookings SET status=$1,updated_at=now(),payment_expires_at=CASE WHEN $1='ACCEPTED' THEN LEAST(now()+$3 * interval '1 hour',date::date::timestamp AT TIME ZONE 'Europe/Paris') ELSE payment_expires_at END WHERE id=$2",[to,id,to==='ACCEPTED'?holdHours('payment'):24]);
        await tx.query('INSERT INTO booking_status_history(id,booking_id,status,actor_id) VALUES($1,$2,$3,$4)',[randomUUID(),id,to,user.id]);
        await notify(tx,booking.client_id,'Votre réservation évolue',`Réservation du ${booking.date} : ${to}.`);await notify(tx,booking.chef_user_id,'Réservation mise à jour',`Réservation du ${booking.date} : ${to}.`);
        await audit(tx,user.id,'BOOKING_STATUS','booking',id,{from:booking.status,to});
      });return json({ok:true});
    }
    if(action==='toggleFavorite') {
      const chefId=text(body.chefId,'Chef',1,100);if(!(await query("SELECT id FROM chef_profiles WHERE id=$1 AND status='APPROVED'",[chefId])).length)throw new AppError(404,'Chef introuvable.');
      await transaction(async tx=>{await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);const rows=await tx.query('DELETE FROM favorites WHERE user_id=$1 AND chef_id=$2 RETURNING chef_id',[user.id,chefId]);if(!rows.length)await tx.query('INSERT INTO favorites(user_id,chef_id) VALUES($1,$2)',[user.id,chefId]);});return json({ok:true});
    }
    if(action==='sendMessage') {
      const id=text(body.bookingId,'Réservation',1,100),message=text(body.body,'Message',1,4000);await rateLimit(`message:${user.id}`,30,60);
      const booking=(await query<{client_id:string;chef_user_id:string}>('SELECT b.client_id,c.user_id AS chef_user_id FROM bookings b JOIN chef_profiles c ON c.id=b.chef_id WHERE b.id=$1',[id]))[0];
      if(!booking||![booking.client_id,booking.chef_user_id].includes(user.id))throw new AppError(403,'Cette conversation ne vous appartient pas.');
      await transaction(async tx=>{await tx.query('INSERT INTO messages(id,booking_id,sender_id,body) VALUES($1,$2,$3,$4)',[randomUUID(),id,user.id,message]);await notify(tx,booking.client_id===user.id?booking.chef_user_id:booking.client_id,'Nouveau message',`${user.name} vous a écrit au sujet de votre réservation.`);});return json({ok:true});
    }
    if(action==='markRead') {if(body.id)await query('UPDATE notifications SET read=true WHERE id=$1 AND user_id=$2',[text(body.id,'Notification',1,100),user.id]);else await query('UPDATE notifications SET read=true WHERE user_id=$1',[user.id]);return json({ok:true});}
    if(action==='reviewChef') {
      const id=text(body.bookingId,'Réservation',1,100),rating=integer(body.rating,'Note',1,5),comment=text(body.comment,'Avis',10,1500);
      const booking=(await query<{chef_id:string}>("SELECT chef_id FROM bookings WHERE id=$1 AND client_id=$2 AND status='COMPLETED' AND payment_status='PAID'",[id,user.id]))[0];if(!booking)throw new AppError(403,'Un avis est possible uniquement après votre prestation payée et terminée.');
      await query('INSERT INTO reviews(id,booking_id,chef_id,client_id,rating,comment) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),id,booking.chef_id,user.id,rating,comment]);return json({ok:true});
    }
    if(action==='approveChef') {
      assertAdmin(user);const id=text(body.chefId,'Chef',1,100),status=text(body.status,'Statut',1,30);if(!['APPROVED','REJECTED','SUSPENDED'].includes(status))throw new AppError(400,'Statut invalide.');
      await transaction(async tx=>{const chef=(await tx.query<{user_id:string}>('SELECT user_id FROM chef_profiles WHERE id=$1 FOR UPDATE',[id]))[0];if(!chef)throw new AppError(404,'Chef introuvable.');
        if(status==='APPROVED'&&!(await tx.query('SELECT id FROM menus WHERE chef_id=$1 AND active',[id])).length)throw new AppError(409,'Le chef doit proposer au moins un menu avant publication.');
        await tx.query('UPDATE chef_profiles SET status=$1 WHERE id=$2',[status,id]);await audit(tx,user.id,'CHEF_REVIEW','chef',id,{status});await notify(tx,chef.user_id,'Votre candidature',`Le statut de votre profil a été mis à jour : ${status}.`);
      });return json({ok:true});
    }
    if(action==='setCommission') {
      assertAdmin(user);const basisPoints=integer(body.basisPoints,'Commission',0,5000);
      await transaction(async tx=>{await tx.query('SELECT id FROM commission_rules WHERE active FOR UPDATE');await tx.query('UPDATE commission_rules SET active=false WHERE active');const id=randomUUID();await tx.query('INSERT INTO commission_rules(id,basis_points,created_by) VALUES($1,$2,$3)',[id,basisPoints,user.id]);await audit(tx,user.id,'COMMISSION_CHANGE','commission',id,{basisPoints});});return json({ok:true});
    }
    if(action==='resolveSupport') {
      assertAdmin(user);const id=text(body.ticketId,'Ticket',1,100),status=text(body.status||'CLOSED','Statut',1,20);if(!['OPEN','IN_PROGRESS','CLOSED'].includes(status))throw new AppError(400,'Statut invalide.');
      await transaction(async tx=>{if(!(await tx.query('UPDATE support_tickets SET status=$1 WHERE id=$2 RETURNING id',[status,id])).length)throw new AppError(404,'Ticket introuvable.');await audit(tx,user.id,'SUPPORT_STATUS','support',id,{status});});return json({ok:true});
    }
    throw new AppError(400,'Action inconnue.');
  } catch(error){return respondError(error);}
}
