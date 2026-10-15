import { test, expect, type APIRequestContext, type Page, type Response } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const demoPassword = 'DemoMaisonnee2026!';
const base = process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3000';
const origin = new URL(base).origin;
type Bootstrap = { demo: boolean; user: { id: string } | null; myChef?: { availability: string[] }; bookings: { id: string; status: string; paymentStatus: string; totalCents: number }[] };

async function mutate(request: APIRequestContext, action: string, values: Record<string, unknown> = {}) {
  const result = await request.post('/api', { headers: { Origin: origin }, data: { action, ...values } });
  expect(result.ok(), `${action}: ${await result.text()}`).toBeTruthy();
  return result.json();
}
async function uiMutation(page: Page, action: string, perform: () => Promise<unknown>): Promise<Response> {
  const response = page.waitForResponse(r => {
    if (new URL(r.url()).pathname !== '/api' || r.request().method() !== 'POST') return false;
    try { return r.request().postDataJSON()?.action === action; } catch { return false; }
  });
  await perform();
  const result = await response;
  expect(result.ok(), `${action}: ${await result.text()}`).toBeTruthy();
  return result;
}
async function signIn(page: Page, email: string, destination = '/espace/reservations') {
  await page.goto(`/connexion?next=${encodeURIComponent(destination)}`);
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(email);
  await page.getByLabel('Mot de passe', { exact: true }).fill(demoPassword);
  await uiMutation(page, 'login', () => page.getByRole('button', { name: 'Se connecter', exact: true }).click());
  await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/')));
  await expect(page.getByRole('link', { name: /Mon espace/ })).toBeVisible();
}
async function signOut(page: Page) {
  await page.goto('/espace');
  await uiMutation(page, 'logout', () => page.getByRole('button', { name: /Se déconnecter|Déconnexion/i }).click());
  await expect(page.locator('header').getByRole('link', { name: 'Se connecter', exact: true })).toBeVisible();
}
async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
  expect(dimensions.document, `Horizontal overflow: ${JSON.stringify(dimensions)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
}
function bookingCard(page: Page, bookingId: string) {
  return page.locator('article.booking-row').filter({ hasText: `Référence : ${bookingId.slice(0, 8)}` });
}
async function openReservations(page: Page, label = 'Mes réservations') {
  await page.getByRole('navigation', { name: 'Navigation de votre espace' })
    .getByRole('button', { name: label, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: label, exact: true })).toBeVisible();
}

test('client, chef et administration suivent une demande persistante sans faux paiement', async ({ page, playwright }) => {
  const identifier = randomUUID().slice(0, 8);
  const clientEmail = `e2e-${identifier}@example.test`;
  const clientName = `Recette ${identifier}`;
  const mealDate = new Date(Date.now() + (90 + Math.floor(Math.random() * 240)) * 86_400_000).toISOString().slice(0, 10);
  const chefSetup = await playwright.request.newContext({ baseURL: base });
  let bookingId: string | undefined;
  let dateWasAlreadyOpen = false;
  try {
    // The only setup mutation opens one future slot. All user journeys below use the UI.
    const bootstrap = await (await chefSetup.get('/api?resource=bootstrap')).json() as Bootstrap;
    expect(bootstrap.demo, 'This suite requires an isolated APP_MODE=demo server.').toBe(true);
    const paymentConfig = await (await chefSetup.get('/api/payments/status')).json();
    expect(paymentConfig.configured, 'The fail-closed E2E suite must run without Stripe credentials.').toBe(false);
    await mutate(chefSetup, 'login', { email: 'chef@maisonnee.demo', password: demoPassword });
    const chefData = await (await chefSetup.get('/api?resource=bootstrap')).json() as Bootstrap;
    const currentDates = chefData.myChef?.availability ?? [];
    dateWasAlreadyOpen = currentDates.includes(mealDate);
    await mutate(chefSetup, 'saveAvailability', { dates: [...new Set([...currentDates, mealDate])] });

    await page.goto('/inscription');
    await page.getByLabel('Prénom et nom', { exact: true }).fill(clientName);
    await page.getByLabel('Adresse e-mail', { exact: true }).fill(clientEmail);
    await page.getByLabel('Mot de passe', { exact: true }).fill(demoPassword);
    await page.getByRole('checkbox').check();
    await uiMutation(page, 'register', () => page.getByRole('button', { name: 'Créer mon compte', exact: true }).click());
    await expect(page.getByRole('link', { name: /Mon espace/ })).toBeVisible();

    await page.goto('/');
    await page.getByLabel('Ville', { exact: true }).fill('Paris');
    await page.getByLabel('Date du repas', { exact: true }).fill(mealDate);
    await page.getByLabel('Nombre de convives', { exact: true }).selectOption('4');
    await page.getByRole('button', { name: 'Trouver mon chef', exact: true }).click();
    await expect(page).toHaveURL(/\/chefs\?/);
    await page.getByRole('link', { name: 'Gabriel Moreau', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Gabriel Moreau');
    await page.getByRole('button', { name: /L’essentiel de saison/ }).click();
    await page.getByLabel('Date de votre repas', { exact: true }).selectOption(mealDate);
    await page.getByLabel('Nombre de convives', { exact: true }).fill('4');
    await expect(page.locator('.price-line.total')).toContainText('276');
    await page.getByRole('button', { name: 'Composer mon moment', exact: true }).click();
    await page.getByLabel('Adresse de la prestation', { exact: true }).fill('10 rue de la Recette, 75011 Paris — adresse fictive');
    await page.getByLabel('Vos envies et les équipements disponibles', { exact: true }).fill(`Recette automatisée ${identifier}, cuisine équipée.`);
    await page.getByRole('checkbox').check();
    const created = await uiMutation(page, 'createBooking', () => page.getByRole('button', { name: 'Envoyer ma demande', exact: true }).click());
    bookingId = (await created.json()).bookingId as string;
    await expect(page).toHaveURL(/\/espace\/reservations/);
    await openReservations(page);
    const clientCard = bookingCard(page, bookingId);
    await expect(clientCard).toContainText('Demande envoyée');
    await expect(clientCard).toContainText('276');
    await page.reload();
    await openReservations(page);
    await expect(bookingCard(page, bookingId)).toContainText('Demande envoyée');
    await signOut(page);

    await signIn(page, 'chef@maisonnee.demo', '/espace/chef');
    await openReservations(page, 'Mes demandes');
    const chefCard = bookingCard(page, bookingId);
    await expect(chefCard).toContainText(clientName);
    await uiMutation(page, 'transitionBooking', () => chefCard.getByRole('button', { name: /Accepter/ }).click());
    await expect(bookingCard(page, bookingId)).toContainText('Acceptée');
    // Open the conversation using the selected reservation, then send through its form.
    await bookingCard(page, bookingId).getByRole('button', { name: /Échanger|Message|Conversation/i }).click();
    const message = `Bonjour ${identifier}, votre demande a bien été acceptée.`;
    await page.getByLabel('Votre message', { exact: true }).fill(message);
    await uiMutation(page, 'sendMessage', () => page.getByRole('button', { name: 'Envoyer le message', exact: true }).click());
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await signOut(page);

    await signIn(page, clientEmail);
    await openReservations(page);
    const accepted = bookingCard(page, bookingId);
    await expect(accepted).toContainText('Acceptée');
    await accepted.getByRole('button', { name: /Échanger|Message|Conversation/i }).click();
    await expect(page.getByText(message, { exact: true })).toBeVisible();
    await page.goto('/espace/reservations');
    await openReservations(page);
    const paymentResponse = page.waitForResponse(r => new URL(r.url()).pathname === '/api/payments/checkout');
    await bookingCard(page, bookingId).getByRole('button', { name: /Payer/ }).click();
    expect((await paymentResponse).status()).toBe(503);
    await expect(page.getByRole('status')).toContainText(/pas configurés|reste à configurer|indisponible/i);
    await page.reload();
    await openReservations(page);
    await expect(bookingCard(page, bookingId)).toContainText('Non payé');
    await expect(bookingCard(page, bookingId)).not.toContainText('Confirmée');
    await signOut(page);

    await signIn(page, 'admin@maisonnee.demo', '/administration');
    await openReservations(page, 'Réservations');
    await expect(bookingCard(page, bookingId)).toContainText(clientName);
    await expect(bookingCard(page, bookingId)).toContainText('Acceptée');
    await expect(bookingCard(page, bookingId)).toContainText('Non payé');
    await expectNoHorizontalOverflow(page);
  } finally {
    // Preserve accounting history; free only this test's slot and restore its availability.
    if (bookingId) await mutate(chefSetup, 'transitionBooking', { bookingId, status: 'CANCELLED' });
    if (!dateWasAlreadyOpen) {
      const current = await (await chefSetup.get('/api?resource=bootstrap')).json() as Bootstrap;
      if (current.myChef) await mutate(chefSetup, 'saveAvailability', { dates: current.myChef.availability.filter(d => d !== mealDate) });
    }
    await chefSetup.dispose();
  }
});

test('une erreur de connexion reste explicite et ne crée aucune session', async ({ page }) => {
  await page.goto('/connexion');
  await page.getByLabel('Adresse e-mail', { exact: true }).fill(`absent-${randomUUID().slice(0, 8)}@example.test`);
  await page.getByLabel('Mot de passe', { exact: true }).fill('MotDePasseIncorrect2026!');
  const rejected = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === '/api');
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  expect((await rejected).status()).toBe(401);
  await expect(page.getByRole('status')).toContainText('E-mail ou mot de passe incorrect');
  await expect(page.locator('header').getByRole('link', { name: 'Se connecter', exact: true })).toBeVisible();
});

test('les pages publiques et la navigation fonctionnent sur un écran de 390 pixels', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['/', '/chefs', '/chefs/gabriel-moreau', '/inscription', '/aide']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Chargement', { exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  }
  await page.goto('/');
  await expect(page.getByLabel('Chargement', { exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  const screenshotPath = testInfo.outputPath('accueil-mobile.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Accueil mobile 390 pixels', { path: screenshotPath, contentType: 'image/png' });
  await page.getByRole('button', { name: 'Ouvrir le menu', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Trouver un chef', exact: true }).click();
  await expect(page).toHaveURL(/\/chefs$/);
  await expect(page.getByRole('button', { name: 'Ouvrir le menu', exact: true })).toBeVisible();
});

test('l’accueil de bureau charge ses visuels et les espaces restent protégés', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Les grandes tables');
  await expect(page.getByLabel('Chargement', { exact: true })).toHaveCount(0);
  await expect(page.locator('.chef-card')).toHaveCount(3);
  await page.locator('footer').scrollIntoViewIfNeeded();
  await expect.poll(async () => page.locator('img').evaluateAll(images => images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expectNoHorizontalOverflow(page);
  const screenshotPath = testInfo.outputPath('accueil-bureau.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await testInfo.attach('Accueil bureau 1440 pixels', { path: screenshotPath, contentType: 'image/png' });
  for (const route of ['/espace/reservations', '/espace/chef', '/administration']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Votre espace vous attend.', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Navigation de votre espace' })).toHaveCount(0);
  }
  expect(pageErrors).toEqual([]);
});
