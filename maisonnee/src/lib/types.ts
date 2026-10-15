export type Role = 'CLIENT' | 'CHEF' | 'ADMIN';
export type BookingStatus = 'REQUESTED' | 'ACCEPTED' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'DECLINED' | 'DISPUTED' | 'EXPIRED';
export type PaymentStatus = 'UNPAID' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED' | 'PARTIALLY_REFUNDED';
export interface User { id:string; email:string; name:string; role:Role; phone:string; address:string; }
export interface Menu { id:string; name:string; description:string; starter:string; main:string; dessert:string; pricePerPerson:number; minGuests:number; maxGuests:number; allergens:string; }
export interface Chef { id:string; slug:string; name:string; city:string; cuisine:string; bio:string; pricePerPerson:number; image:string; portrait:string; tags:string[]; menus:Menu[]; availability:string[]; status:string; travelCents:number; rating:number|null; reviewCount:number; reviews:{name:string;rating:number;comment:string;createdAt:string}[]; }
export interface Booking { id:string; chefId:string; clientId:string; chefName:string; clientName:string; date:string; guests:number; menuName:string; totalCents:number; commissionCents:number; chefNetCents:number; travelCents:number; status:BookingStatus; paymentStatus:PaymentStatus; address:string; notes:string; createdAt:string; }
export interface Message { id:string; bookingId:string; senderId:string; senderName:string; body:string; createdAt:string; }
export interface Notification { id:string; title:string; body:string; read:boolean; createdAt:string; }
