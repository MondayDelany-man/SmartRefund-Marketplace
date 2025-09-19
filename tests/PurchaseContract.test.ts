import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, stringAsciiCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_INVALID_LISTING_ID = 101;
const ERR_INVALID_AMOUNT = 102;
const ERR_PURCHASE_NOT_FOUND = 104;
const ERR_INVALID_STATUS = 105;
const ERR_LISTING_NOT_FOUND = 109;
const ERR_BUYER_MISMATCH = 110;
const ERR_SELLER_MISMATCH = 111;
const ERR_MAX_PURCHASES_EXCEEDED = 116;
const ERR_INVALID_ESCROW_DURATION = 113;
const ERR_INVALID_CURRENCY = 115;
const ERR_INVALID_DELIVERY_DEADLINE = 117;
const ERR_INVALID_QUANTITY = 119;
const ERR_INVALID_DISCOUNT = 120;
const ERR_INVALID_TAX_RATE = 121;
const ERR_INVALID_SHIPPING_FEE = 122;
const ERR_INVALID_INSURANCE_FEE = 123;
const ERR_INVALID_REFUND_PERCENT = 124;
const ERR_ESCROW_NOT_RELEASABLE = 107;
const ERR_ESCROW_EXPIRED = 114;

interface Purchase {
  buyer: string;
  seller: string;
  listingId: number;
  amount: number;
  status: string;
  timestamp: number;
  escrowDuration: number;
  deliveryDeadline: number;
  currency: string;
  quantity: number;
  discount: number;
  taxRate: number;
  shippingFee: number;
  insuranceFee: number;
  refundPercent: number;
  replacementPolicy: boolean;
}

interface PurchaseUpdate {
  updateStatus: string;
  updateTimestamp: number;
  updater: string;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

interface Listing {
  seller: string;
}

class PurchaseContractMock {
  state: {
    nextPurchaseId: number;
    maxPurchases: number;
    escrowFeeRate: number;
    authorityContract: string | null;
    purchases: Map<number, Purchase>;
    purchaseUpdates: Map<number, PurchaseUpdate>;
  } = {
    nextPurchaseId: 1,
    maxPurchases: 10000,
    escrowFeeRate: 1,
    authorityContract: null,
    purchases: new Map(),
    purchaseUpdates: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1BUYER";
  stxTransfers: Array<{ amount: number; from: string; to: string }> = [];
  listings: Map<number, Listing> = new Map();

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      nextPurchaseId: 1,
      maxPurchases: 10000,
      escrowFeeRate: 1,
      authorityContract: null,
      purchases: new Map(),
      purchaseUpdates: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1BUYER";
    this.stxTransfers = [];
    this.listings = new Map();
  }

  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }

  setMaxPurchases(newMax: number): Result<boolean> {
    if (newMax <= 0) return { ok: false, value: false };
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.maxPurchases = newMax;
    return { ok: true, value: true };
  }

  setEscrowFeeRate(newRate: number): Result<boolean> {
    if (newRate > 10) return { ok: false, value: false };
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.escrowFeeRate = newRate;
    return { ok: true, value: true };
  }

  getListing(id: number): Listing | null {
    return this.listings.get(id) || null;
  }

  addListing(id: number, seller: string) {
    this.listings.set(id, { seller });
  }

  makePurchase(
    listingId: number,
    amount: number,
    escrowDuration: number,
    deliveryDeadline: number,
    currency: string,
    quantity: number,
    discount: number,
    taxRate: number,
    shippingFee: number,
    insuranceFee: number,
    refundPercent: number,
    replacementPolicy: boolean
  ): Result<number> {
    if (this.state.nextPurchaseId >= this.state.maxPurchases) return { ok: false, value: ERR_MAX_PURCHASES_EXCEEDED };
    if (listingId <= 0) return { ok: false, value: ERR_INVALID_LISTING_ID };
    if (amount <= 0) return { ok: false, value: ERR_INVALID_AMOUNT };
    if (escrowDuration <= 0 || escrowDuration > 10080) return { ok: false, value: ERR_INVALID_ESCROW_DURATION };
    if (deliveryDeadline <= this.blockHeight) return { ok: false, value: ERR_INVALID_DELIVERY_DEADLINE };
    if (!["STX", "BTC", "USD"].includes(currency)) return { ok: false, value: ERR_INVALID_CURRENCY };
    if (quantity <= 0) return { ok: false, value: ERR_INVALID_QUANTITY };
    if (discount > 100) return { ok: false, value: ERR_INVALID_DISCOUNT };
    if (taxRate > 20) return { ok: false, value: ERR_INVALID_TAX_RATE };
    if (shippingFee < 0) return { ok: false, value: ERR_INVALID_SHIPPING_FEE };
    if (insuranceFee < 0) return { ok: false, value: ERR_INVALID_INSURANCE_FEE };
    if (refundPercent > 100) return { ok: false, value: ERR_INVALID_REFUND_PERCENT };
    if (!this.state.authorityContract) return { ok: false, value: ERR_NOT_AUTHORIZED };
    const listing = this.getListing(listingId);
    if (!listing) return { ok: false, value: ERR_LISTING_NOT_FOUND };

    const netAmount = amount + shippingFee + insuranceFee;
    const fee = Math.floor(netAmount * (this.state.escrowFeeRate / 100));
    const totalTransfer = netAmount + fee;

    this.stxTransfers.push({ amount: totalTransfer, from: this.caller, to: "contract" });
    this.stxTransfers.push({ amount: fee, from: "contract", to: this.state.authorityContract });

    const id = this.state.nextPurchaseId;
    const purchase: Purchase = {
      buyer: this.caller,
      seller: listing.seller,
      listingId,
      amount,
      status: "pending",
      timestamp: this.blockHeight,
      escrowDuration,
      deliveryDeadline,
      currency,
      quantity,
      discount,
      taxRate,
      shippingFee,
      insuranceFee,
      refundPercent,
      replacementPolicy,
    };
    this.state.purchases.set(id, purchase);
    this.state.nextPurchaseId++;
    return { ok: true, value: id };
  }

  releaseEscrow(purchaseId: number): Result<boolean> {
    const purchase = this.state.purchases.get(purchaseId);
    if (!purchase) return { ok: false, value: ERR_PURCHASE_NOT_FOUND };
    if (purchase.status !== "delivered") return { ok: false, value: ERR_ESCROW_NOT_RELEASABLE };
    if (this.blockHeight > purchase.deliveryDeadline) return { ok: false, value: ERR_ESCROW_EXPIRED };
    if (this.caller !== purchase.buyer && this.caller !== purchase.seller) return { ok: false, value: ERR_NOT_AUTHORIZED };

    const netRelease = purchase.amount + purchase.shippingFee + purchase.insuranceFee;
    this.stxTransfers.push({ amount: netRelease, from: "contract", to: purchase.seller });

    this.state.purchases.set(purchaseId, { ...purchase, status: "completed" });
    this.state.purchaseUpdates.set(purchaseId, {
      updateStatus: "completed",
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  cancelPurchase(purchaseId: number): Result<boolean> {
    const purchase = this.state.purchases.get(purchaseId);
    if (!purchase) return { ok: false, value: ERR_PURCHASE_NOT_FOUND };
    if (purchase.status !== "pending") return { ok: false, value: ERR_INVALID_STATUS };
    if (this.caller !== purchase.buyer) return { ok: false, value: ERR_BUYER_MISMATCH };

    const netRefund = purchase.amount + purchase.shippingFee + purchase.insuranceFee;
    this.stxTransfers.push({ amount: netRefund, from: "contract", to: purchase.buyer });

    this.state.purchases.set(purchaseId, { ...purchase, status: "cancelled" });
    this.state.purchaseUpdates.set(purchaseId, {
      updateStatus: "cancelled",
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  updatePurchaseStatus(purchaseId: number, newStatus: string): Result<boolean> {
    const purchase = this.state.purchases.get(purchaseId);
    if (!purchase) return { ok: false, value: ERR_PURCHASE_NOT_FOUND };
    if (this.caller !== purchase.seller) return { ok: false, value: ERR_SELLER_MISMATCH };
    if (!["pending", "delivered", "completed", "cancelled"].includes(newStatus)) return { ok: false, value: ERR_INVALID_STATUS };

    this.state.purchases.set(purchaseId, { ...purchase, status: newStatus });
    this.state.purchaseUpdates.set(purchaseId, {
      updateStatus: newStatus,
      updateTimestamp: this.blockHeight,
      updater: this.caller,
    });
    return { ok: true, value: true };
  }

  getPurchaseCount(): Result<number> {
    return { ok: true, value: this.state.nextPurchaseId };
  }

  getPurchase(id: number): Purchase | null {
    return this.state.purchases.get(id) || null;
  }
}

describe("PurchaseContract", () => {
  let contract: PurchaseContractMock;

  beforeEach(() => {
    contract = new PurchaseContractMock();
    contract.reset();
  });

  it("creates a purchase successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);

    const purchase = contract.getPurchase(1);
    expect(purchase?.buyer).toBe("ST1BUYER");
    expect(purchase?.seller).toBe("ST3SELLER");
    expect(purchase?.amount).toBe(100);
    expect(purchase?.status).toBe("pending");
    expect(purchase?.escrowDuration).toBe(1440);
    expect(purchase?.currency).toBe("STX");
    expect(purchase?.quantity).toBe(2);
    expect(purchase?.discount).toBe(10);
    expect(purchase?.taxRate).toBe(5);
    expect(purchase?.shippingFee).toBe(20);
    expect(purchase?.insuranceFee).toBe(10);
    expect(purchase?.refundPercent).toBe(50);
    expect(purchase?.replacementPolicy).toBe(true);
    expect(contract.stxTransfers.length).toBe(2);
  });

  it("rejects purchase without authority contract", () => {
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("rejects invalid listing id", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.makePurchase(
      0,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_LISTING_ID);
  });

  it("rejects invalid amount", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      0,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AMOUNT);
  });

  it("rejects invalid escrow duration", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      0,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ESCROW_DURATION);
  });

  it("rejects invalid currency", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "INVALID",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_CURRENCY);
  });

  it("rejects invalid quantity", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      0,
      10,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_QUANTITY);
  });

  it("rejects invalid discount", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      101,
      5,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_DISCOUNT);
  });

  it("rejects invalid tax rate", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      21,
      20,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_TAX_RATE);
  });

  it("rejects invalid shipping fee", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      -1,
      10,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SHIPPING_FEE);
  });

  it("rejects invalid insurance fee", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      -1,
      50,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_INSURANCE_FEE);
  });

  it("rejects invalid refund percent", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    const result = contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      101,
      true
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_REFUND_PERCENT);
  });

  it("rejects purchase with max purchases exceeded", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.state.maxPurchases = 1;
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    const result = contract.makePurchase(
      1,
      200,
      2880,
      200,
      "BTC",
      3,
      15,
      10,
      30,
      15,
      75,
      false
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_PURCHASES_EXCEEDED);
  });

  it("releases escrow successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    contract.updatePurchaseStatus(1, "delivered");
    contract.caller = "ST1BUYER";
    const result = contract.releaseEscrow(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const purchase = contract.getPurchase(1);
    expect(purchase?.status).toBe("completed");
    expect(contract.stxTransfers.length).toBe(3);
  });

  it("rejects release escrow if not releasable", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    const result = contract.releaseEscrow(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ESCROW_NOT_RELEASABLE);
  });

  it("rejects release escrow if expired", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    contract.updatePurchaseStatus(1, "delivered");
    contract.blockHeight = 101;
    contract.caller = "ST1BUYER";
    const result = contract.releaseEscrow(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ESCROW_EXPIRED);
  });

  it("rejects release escrow by unauthorized caller", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    contract.updatePurchaseStatus(1, "delivered");
    contract.caller = "ST4UNAUTH";
    const result = contract.releaseEscrow(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_NOT_AUTHORIZED);
  });

  it("cancels purchase successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    const result = contract.cancelPurchase(1);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const purchase = contract.getPurchase(1);
    expect(purchase?.status).toBe("cancelled");
    expect(contract.stxTransfers.length).toBe(3);
  });

  it("rejects cancel purchase if not pending", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    contract.updatePurchaseStatus(1, "delivered");
    contract.caller = "ST1BUYER";
    const result = contract.cancelPurchase(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("rejects cancel purchase by non-buyer", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    const result = contract.cancelPurchase(1);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_BUYER_MISMATCH);
  });

  it("updates purchase status successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    const result = contract.updatePurchaseStatus(1, "delivered");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const purchase = contract.getPurchase(1);
    expect(purchase?.status).toBe("delivered");
    const update = contract.state.purchaseUpdates.get(1);
    expect(update?.updateStatus).toBe("delivered");
    expect(update?.updater).toBe("ST3SELLER");
  });

  it("rejects update status by non-seller", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    const result = contract.updatePurchaseStatus(1, "delivered");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SELLER_MISMATCH);
  });

  it("rejects invalid new status", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.caller = "ST3SELLER";
    const result = contract.updatePurchaseStatus(1, "invalid");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_STATUS);
  });

  it("sets max purchases successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setMaxPurchases(5000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxPurchases).toBe(5000);
  });

  it("rejects set max purchases without authority", () => {
    const result = contract.setMaxPurchases(5000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("sets escrow fee rate successfully", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setEscrowFeeRate(2);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.escrowFeeRate).toBe(2);
  });

  it("rejects invalid escrow fee rate", () => {
    contract.setAuthorityContract("ST2AUTH");
    const result = contract.setEscrowFeeRate(11);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });

  it("returns correct purchase count", () => {
    contract.setAuthorityContract("ST2AUTH");
    contract.addListing(1, "ST3SELLER");
    contract.makePurchase(
      1,
      100,
      1440,
      100,
      "STX",
      2,
      10,
      5,
      20,
      10,
      50,
      true
    );
    contract.makePurchase(
      1,
      200,
      2880,
      200,
      "BTC",
      3,
      15,
      10,
      30,
      15,
      75,
      false
    );
    const result = contract.getPurchaseCount();
    expect(result.ok).toBe(true);
    expect(result.value).toBe(3);
  });

  it("parses purchase parameters with Clarity types", () => {
    const currency = stringAsciiCV("STX");
    const amount = uintCV(100);
    const quantity = uintCV(2);
    expect(currency.value).toBe("STX");
    expect(amount.value).toEqual(BigInt(100));
    expect(quantity.value).toEqual(BigInt(2));
  });
});