# SmartRefund Marketplace

## Overview

SmartRefund Marketplace is a decentralized Web3 platform built on the Stacks blockchain using Clarity smart contracts. It solves real-world problems in e-commerce, such as trust issues in refunds and replacements. In traditional online shopping, buyers often face delays, denials, or biases from centralized platforms when seeking refunds or replacements for faulty or undelivered goods. Sellers, on the other hand, deal with fraudulent claims. This project leverages smart contracts to automate and enforce refunds or replacements based on verifiable conditions, using escrows, oracles for real-world data (e.g., delivery confirmation), and decentralized dispute resolution.

Key features:
- Trustless escrow for payments.
- Automated refunds if delivery fails or product doesn't match description.
- Replacement logic triggered by buyer-seller agreements or oracles.
- Decentralized arbitration to minimize central authority.
- Reduces fraud through on-chain verification.

The platform involves 7 core smart contracts written in Clarity, ensuring security, predictability, and Bitcoin-anchored settlement via Stacks.

## Prerequisites

- Stacks blockchain environment (testnet or mainnet).
- Clarity development tools (e.g., Clarinet for local testing).
- Integration with an oracle service (e.g., for delivery status from shipping APIs).
- Users need STX tokens for transactions.

## Installation and Deployment

1. Clone the repository: `git clone <repo-url>`.
2. Install Clarinet: Follow [Stacks documentation](https://docs.stacks.co/clarity).
3. Deploy contracts using Clarinet: `clarinet deploy`.
4. Interact via Stacks Wallet or custom frontend (not included; build your own dApp interface).

## Smart Contracts

Below are the 7 smart contracts. Each is designed to be modular, composable, and secure. They use Clarity's functional style, error handling with `(err u1)`, and principals for access control. For brevity, these are simplified versions; in production, add more validations and events.

### 1. RegistryContract.clar
This contract handles user registration as buyers or sellers, storing profiles on-chain.

```clarity
;; Registry Contract for Users
(define-map users principal { role: (string-ascii 10), balance: uint })

(define-public (register-user (role (string-ascii 10)))
  (map-set users tx-sender { role: role, balance: u0 })
  (ok true)
)

(define-read-only (get-user-role (user principal))
  (match (map-get? users user)
    some-user (ok (get role some-user))
    (err u1) ;; User not found
  )
)
```

### 2. ListingContract.clar
Sellers list products with details like price, description, and conditions for refund/replacement.

```clarity
;; Listing Contract for Products
(define-map listings uint { seller: principal, price: uint, description: (string-utf8 256), refund-window: uint })

(define-data-var next-listing-id uint u1)

(define-public (list-product (price uint) (description (string-utf8 256)) (refund-window uint))
  (let ((listing-id (var-get next-listing-id)))
    (map-set listings listing-id { seller: tx-sender, price: price, description: description, refund-window: refund-window })
    (var-set next-listing-id (+ listing-id u1))
    (ok listing-id)
  )
)

(define-read-only (get-listing (id uint))
  (map-get? listings id)
)
```

### 3. PurchaseContract.clar
Handles purchases by creating an escrow that locks buyer funds until conditions are met.

```clarity
;; Purchase Contract with Escrow
(define-map purchases uint { buyer: principal, listing-id: uint, amount: uint, status: (string-ascii 20) })

(define-data-var next-purchase-id uint u1)

(define-public (make-purchase (listing-id uint) (amount uint))
  (let ((purchase-id (var-get next-purchase-id))
        (listing (unwrap! (get-listing listing-id) (err u2))))
    (try! (stx-transfer? amount tx-sender (as-contract tx-sender))) ;; Escrow funds
    (map-set purchases purchase-id { buyer: tx-sender, listing-id: listing-id, amount: amount, status: "pending" })
    (var-set next-purchase-id (+ purchase-id u1))
    (ok purchase-id)
  )
)

(define-public (release-escrow (purchase-id uint))
  (let ((purchase (unwrap! (map-get? purchases purchase-id) (err u3))))
    (asserts! (is-eq (get status purchase) "delivered") (err u4))
    (as-contract (stx-transfer? (get amount purchase) tx-sender (get seller (unwrap! (get-listing (get listing-id purchase)) (err u5)))))
    (map-set purchases purchase-id (merge purchase { status: "completed" }))
    (ok true)
  )
)
```

### 4. DeliveryVerificationContract.clar
Integrates with an oracle to verify delivery status, triggering next steps.

```clarity
;; Delivery Verification with Oracle
(define-map deliveries uint { purchase-id: uint, oracle-data: (optional (string-utf8 256)), verified: bool })

(define-public (submit-delivery-proof (purchase-id uint) (proof (string-utf8 256)))
  ;; In production, validate oracle principal
  (map-set deliveries purchase-id { purchase-id: purchase-id, oracle-data: (some proof), verified: true })
  (ok true)
)

(define-read-only (is-delivered (purchase-id uint))
  (let ((delivery (map-get? deliveries purchase-id)))
    (ok (get verified delivery))
  )
)
```

### 5. RefundContract.clar
Executes refunds if conditions (e.g., no delivery within window) are met.

```clarity
;; Refund Execution Contract
(define-public (request-refund (purchase-id uint))
  (let ((purchase (unwrap! (map-get? purchases purchase-id) (err u6)))
        (listing (unwrap! (get-listing (get listing-id purchase)) (err u7))))
    (asserts! (is-eq tx-sender (get buyer purchase)) (err u8))
    (asserts! (> block-height (+ (get refund-window listing) block-height)) (err u9)) ;; Within window
    (asserts! (not (unwrap! (is-delivered purchase-id) (err u10))) (err u11)) ;; Not delivered
    (as-contract (stx-transfer? (get amount purchase) tx-sender (get buyer purchase)))
    (map-set purchases purchase-id (merge purchase { status: "refunded" }))
    (ok true)
  )
)
```

### 6. ReplacementContract.clar
Handles product replacements by escrowing new shipment details and verifying.

```clarity
;; Replacement Handling Contract
(define-map replacements uint { purchase-id: uint, new-listing-id: uint, status: (string-ascii 20) })

(define-public (request-replacement (purchase-id uint) (new-description (string-utf8 256)))
  (let ((purchase (unwrap! (map-get? purchases purchase-id) (err u12))))
    (asserts! (is-eq tx-sender (get buyer purchase)) (err u13))
    (asserts! (is-eq (get status purchase) "delivered") (err u14)) ;; Only after delivery
    ;; Seller creates new listing for replacement
    (let ((new-listing-id (unwrap! (list-product (get amount purchase) new-description u0) (err u15)))) ;; Simplified
      (map-set replacements purchase-id { purchase-id: purchase-id, new-listing-id: new-listing-id, status: "pending" })
      (ok new-listing-id)
    )
  )
)

(define-public (confirm-replacement (purchase-id uint))
  (let ((replacement (unwrap! (map-get? replacements purchase-id) (err u16))))
    (asserts! (unwrap! (is-delivered (get new-listing-id replacement)) (err u17))
    (map-set purchases purchase-id (merge (unwrap! (map-get? purchases purchase-id) (err u18)) { status: "replaced" }))
    (ok true)
  )
)
```

### 7. ArbitrationContract.clar
For disputes, allows decentralized voting or oracle-based resolution to force refund/replacement.

```clarity
;; Arbitration for Disputes
(define-map disputes uint { purchase-id: uint, votes-for-refund: uint, votes-for-seller: uint, resolved: bool })

(define-public (start-dispute (purchase-id uint))
  (map-set disputes purchase-id { purchase-id: purchase-id, votes-for-refund: u0, votes-for-seller: u0, resolved: false })
  (ok true)
)

(define-public (vote-on-dispute (dispute-id uint) (vote-for-refund bool))
  ;; In production, restrict to staked arbitrators
  (let ((dispute (unwrap! (map-get? disputes dispute-id) (err u19))))
    (if vote-for-refund
      (map-set disputes dispute-id (merge dispute { votes-for-refund: (+ (get votes-for-refund dispute) u1) }))
      (map-set disputes dispute-id (merge dispute { votes-for-seller: (+ (get votes-for-seller dispute) u1) }))
    )
    (if (> (+ (get votes-for-refund dispute) (get votes-for-seller dispute)) u10) ;; Threshold
      (begin
        (if (> (get votes-for-refund dispute) (get votes-for-seller dispute))
          (try! (request-refund (get purchase-id dispute)))
          (try! (release-escrow (get purchase-id dispute)))
        )
        (map-set disputes dispute-id (merge dispute { resolved: true }))
      )
      (ok false)
    )
    (ok true)
  )
)
```

## Usage Flow

1. Seller registers and lists a product.
2. Buyer purchases, funds go to escrow.
3. Seller ships; oracle verifies delivery.
4. If issues: Buyer requests refund (auto if conditions met) or replacement.
5. Disputes go to arbitration.
6. Funds released/refunded accordingly.

## Security Considerations

- Use non-reentrant patterns.
- Audit for overflows/underflows (Clarity handles uint safely).
- Oracle trust: Use reputable oracles.
- Test with Clarinet for edge cases.

## Contributing

Fork the repo, add features (e.g., NFT for products), and PR.

## License

MIT License.