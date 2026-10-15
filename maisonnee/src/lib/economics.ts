/** Monthly planning assumptions, not provider prices or accounting advice. All money is in EUR cents. */
export type EconomicsInput = {
  chefs: number;
  bookingsPerChef: number;
  averageOrderCents: number;
  commissionBps: number;
  paymentFeeBps: number;
  paymentFixedCents: number;
  refundRateBps: number;
  refundShareBps: number;
  supportPerBookingCents: number;
  acquiredCustomerShareBps: number;
  acquisitionCostCents: number;
  technologyCostCents: number;
  fixedCostCents: number;
};

export const economicsAssumptionsDate = "2026-10-13";

export function simulateEconomics(input: EconomicsInput) {
  for (const [key, value] of Object.entries(input)) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000_000) {
      throw new Error(`Hypothèse invalide : ${key}`);
    }
    if (key.endsWith("Bps") && (!Number.isInteger(value) || value > 10_000)) {
      throw new Error(`Le taux ${key} doit être compris entre 0 et 10 000 points de base.`);
    }
    if ((key.endsWith("Cents") || key === "chefs") && !Number.isInteger(value)) {
      throw new Error(`Le montant ou effectif ${key} doit être entier.`);
    }
  }
  const bookings = input.chefs * input.bookingsPerChef;
  const money = (value: number) => {
    const cents = Math.round(value);
    if (!Number.isSafeInteger(cents)) throw new Error("Projection trop élevée pour un calcul fiable.");
    return cents;
  };
  const gmvCents = money(bookings * input.averageOrderCents);
  const refundedCents = money(gmvCents * input.refundRateBps / 10_000 * input.refundShareBps / 10_000);
  const retainedGmvCents = gmvCents - refundedCents;
  const grossCommissionCents = money(gmvCents * input.commissionBps / 10_000);
  const refundedCommissionCents = money(refundedCents * input.commissionBps / 10_000);
  const netCommissionCents = grossCommissionCents - refundedCommissionCents;
  // Conservative planning assumption: original payment fees are not returned on refund.
  const paymentCostCents = money(bookings * (money(input.averageOrderCents * input.paymentFeeBps / 10_000) + input.paymentFixedCents));
  const supportCostCents = money(bookings * input.supportPerBookingCents);
  const acquiredCustomers = bookings * input.acquiredCustomerShareBps / 10_000;
  const acquisitionCostCents = money(acquiredCustomers * input.acquisitionCostCents);
  const contributionBeforeAcquisitionCents = netCommissionCents - paymentCostCents - supportCostCents;
  const contributionCents = contributionBeforeAcquisitionCents - acquisitionCostCents;
  const resultCents = contributionCents - input.technologyCostCents - input.fixedCostCents;
  const contributionPerBookingCents = bookings > 0 ? contributionCents / bookings : 0;
  return {
    bookings,
    gmvCents,
    refundedCents,
    retainedGmvCents,
    grossCommissionCents,
    refundedCommissionCents,
    netCommissionCents,
    chefNetBeforeOwnCostsCents: retainedGmvCents - netCommissionCents,
    paymentCostCents,
    supportCostCents,
    acquiredCustomers,
    acquisitionCostCents,
    contributionBeforeAcquisitionCents,
    contributionCents,
    technologyCostCents: input.technologyCostCents,
    fixedCostCents: input.fixedCostCents,
    resultCents,
    contributionPerBookingCents,
    effectiveTakeRate: gmvCents > 0 ? netCommissionCents / gmvCents : 0,
    breakEvenBookings: contributionPerBookingCents > 0
      ? Math.ceil((input.technologyCostCents + input.fixedCostCents) / contributionPerBookingCents)
      : null,
  };
}

const common: EconomicsInput = {
  chefs: 30, bookingsPerChef: 4, averageOrderCents: 48_000,
  commissionBps: 1_000, paymentFeeBps: 180, paymentFixedCents: 25,
  refundRateBps: 700, refundShareBps: 10_000,
  supportPerBookingCents: 600, acquiredCustomerShareBps: 4_000,
  acquisitionCostCents: 3_500, technologyCostCents: 15_000, fixedCostCents: 200_000,
};

export const economicsScenarios: { id: string; name: string; input: EconomicsInput }[] = [
  { id: "prudent", name: "Prudent", input: { ...common, chefs: 15, bookingsPerChef: 2, averageOrderCents: 32_000, refundRateBps: 1_200, supportPerBookingCents: 800, acquiredCustomerShareBps: 6_000, acquisitionCostCents: 4_000 } },
  { id: "central", name: "Central", input: { ...common } },
  { id: "optimiste", name: "Optimiste", input: { ...common, chefs: 60, bookingsPerChef: 6, averageOrderCents: 62_000, refundRateBps: 400, supportPerBookingCents: 400, acquiredCustomerShareBps: 2_500, acquisitionCostCents: 2_500, technologyCostCents: 25_000, fixedCostCents: 350_000 } },
];
