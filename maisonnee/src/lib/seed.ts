import type {DbClient} from './db';
import {hashPassword} from './auth';
export const DEMO_PASSWORD='DemoMaisonnee2026!';
export async function seed(db:DbClient):Promise<void> {
  if(process.env.APP_MODE!=='demo') return;
  if((await db.query("SELECT id FROM users WHERE id='demo-client'")).length)return;
  const password=await hashPassword(DEMO_PASSWORD);
  const accounts=[['demo-client','client@maisonnee.demo','Camille Martin','CLIENT'],['demo-admin','admin@maisonnee.demo','Administration démo','ADMIN'],['demo-chef','chef@maisonnee.demo','Gabriel Moreau','CHEF'],['demo-chef-2','ines@maisonnee.demo','Inès Laurent','CHEF'],['demo-chef-3','adam@maisonnee.demo','Adam Benali','CHEF']];
  for(const [id,email,name,role] of accounts) await db.query('INSERT INTO users(id,email,name,role,password_hash,email_verified_at) VALUES($1,$2,$3,$4,$5,now()) ON CONFLICT(id) DO NOTHING',[id,email,name,role,password]);
  await db.query("INSERT INTO commission_rules(id,basis_points) VALUES('initial-commission',1000) ON CONFLICT(id) DO NOTHING");
  const chefs=[
    ['chef-gabriel','demo-chef','gabriel-moreau','Gabriel Moreau','Paris','Française contemporaine','Une cuisine de saison généreuse et précise, où le végétal rencontre les grands classiques. Un dîner imaginé autour du partage. Profil fictif de démonstration.','/images/plate.jpg',['De saison','Gastronomique'],6900,'L’essentiel de saison','Velouté de potimarron, noisettes torréfiées','Volaille fermière, jus corsé et légumes d’automne','Poire rôtie, crème légère à la vanille'],
    ['chef-ines','demo-chef-2','ines-laurent','Inès Laurent','Paris','Végétale & créative','Des couleurs, des textures et des légumes de saison au centre de l’assiette. Une expérience végétale gourmande et sensible. Profil fictif de démonstration.','/images/season.jpg',['Végétarien','Créative'],5900,'Le jardin à table','Betteraves marinées, chèvre frais et herbes','Risotto d’épeautre aux champignons','Pavlova aux fruits de saison'],
    ['chef-adam','demo-chef-3','adam-benali','Adam Benali','Boulogne-Billancourt','Méditerranéenne','L’esprit des grandes tablées méditerranéennes, des produits lumineux et une cuisine à partager. Profil fictif de démonstration.','/images/table.jpg',['À partager','Méditerranée'],7900,'Une soirée au Sud','Burrata crémeuse, légumes confits et basilic','Poisson du marché, fenouil et citron confit','Tarte fine aux figues et miel'],
  ] as const;
  for(const [id,userId,slug,name,city,cuisine,bio,image,tags,price,menuName,starter,main,dessert] of chefs) {
    await db.query("INSERT INTO chef_profiles(id,user_id,slug,name,city,cuisine,bio,image,portrait,tags,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'APPROVED') ON CONFLICT(id) DO NOTHING",[id,userId,slug,name,city,cuisine,bio,image,'/images/chef.jpg',JSON.stringify(tags)]);
    await db.query('INSERT INTO menus(id,chef_id,name,description,starter,main,dessert,price_per_person,min_guests,max_guests,allergens) VALUES($1,$2,$3,$4,$5,$6,$7,$8,2,12,$9) ON CONFLICT(id) DO NOTHING',[`menu-${id}`,id,menuName,'Trois temps, courses, préparation, service et rangement de la cuisine inclus.',starter,main,dessert,price,'À confirmer avec le chef avant réservation : lait, fruits à coque, gluten selon le menu.']);
    for(let day=1;day<=60;day++) {
      const date=new Date(Date.now()+day*86400000).toISOString().slice(0,10);
      await db.query('INSERT INTO chef_availability(chef_id,date) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,date]);
    }
  }
}
