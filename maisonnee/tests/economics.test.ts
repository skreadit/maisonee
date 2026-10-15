import { describe, expect, it } from "vitest";
import { economicsScenarios, simulateEconomics, type EconomicsInput } from "../src/lib/economics";

const input: EconomicsInput = {
  chefs: 10, bookingsPerChef: 10, averageOrderCents: 30_000,
  commissionBps: 1_000, paymentFeeBps: 200, paymentFixedCents: 25,
  refundRateBps: 1_000, refundShareBps: 10_000, supportPerBookingCents: 500,
  acquiredCustomerShareBps: 2_000, acquisitionCostCents: 2_000,
  technologyCostCents: 10_000, fixedCostCents: 100_000,
};

describe("projection économique mensuelle", () => {
  it("distingue GMV, remboursements, revenu de commission et charges", () => {
    const r = simulateEconomics(input);
    expect(r.bookings).toBe(100);
    expect(r.gmvCents).toBe(3_000_000);
    expect(r.refundedCents).toBe(300_000);
    expect(r.netCommissionCents).toBe(270_000);
    expect(r.paymentCostCents).toBe(62_500);
    expect(r.supportCostCents).toBe(50_000);
    expect(r.acquisitionCostCents).toBe(40_000);
    expect(r.contributionCents).toBe(117_500);
    expect(r.resultCents).toBe(7_500);
    expect(r.breakEvenBookings).toBe(94);
    expect(r.chefNetBeforeOwnCostsCents + r.netCommissionCents).toBe(r.retainedGmvCents);
  });
  it("garde les frais de paiement malgré un remboursement total", () => {
    const r = simulateEconomics({ ...input, refundRateBps: 10_000 });
    expect(r.netCommissionCents).toBe(0);
    expect(r.paymentCostCents).toBe(62_500);
    expect(r.breakEvenBookings).toBeNull();
  });
  it("ne divise pas par zéro quand aucune réservation n'est projetée", () => {
    const r = simulateEconomics({ ...input, chefs: 0 });
    expect(r.effectiveTakeRate).toBe(0);
    expect(r.resultCents).toBe(-110_000);
    expect(r.breakEvenBookings).toBeNull();
  });
  it("rejette les taux, centimes et nombres non fiables", () => {
    expect(() => simulateEconomics({ ...input, commissionBps: 10_001 })).toThrow();
    expect(() => simulateEconomics({ ...input, averageOrderCents: 0.1 })).toThrow();
    expect(() => simulateEconomics({ ...input, chefs: Number.NaN })).toThrow();
    expect(() => simulateEconomics({ ...input, chefs: 100_000_000, bookingsPerChef: 100_000_000 })).toThrow();
  });
  it("livre trois scénarios distincts sous commission de 10 %", () => {
    expect(economicsScenarios.map((scenario) => scenario.input.commissionBps)).toEqual([1_000, 1_000, 1_000]);
    expect(simulateEconomics(economicsScenarios[0].input).resultCents).toBeLessThan(0);
    expect(simulateEconomics(economicsScenarios[2].input).resultCents).toBeGreaterThan(0);
  });
});
