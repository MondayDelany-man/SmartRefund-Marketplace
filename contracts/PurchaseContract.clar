(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INVALID-LISTING-ID u101)
(define-constant ERR-INVALID-AMOUNT u102)
(define-constant ERR-PURCHASE-ALREADY-EXISTS u103)
(define-constant ERR-PURCHASE-NOT-FOUND u104)
(define-constant ERR-INVALID-STATUS u105)
(define-constant ERR-INSUFFICIENT-FUNDS u106)
(define-constant ERR-ESCROW-NOT-RELEASABLE u107)
(define-constant ERR-INVALID-TIMESTAMP u108)
(define-constant ERR-LISTING-NOT-FOUND u109)
(define-constant ERR-BUYER-MISMATCH u110)
(define-constant ERR-SELLER-MISMATCH u111)
(define-constant ERR-TRANSFER-FAILED u112)
(define-constant ERR-INVALID-ESCROW-DURATION u113)
(define-constant ERR-ESCROW-EXPIRED u114)
(define-constant ERR-INVALID-CURRENCY u115)
(define-constant ERR-MAX-PURCHASES-EXCEEDED u116)
(define-constant ERR-INVALID-DELIVERY-DEADLINE u117)
(define-constant ERR-INVALID-PAYMENT_METHOD u118)
(define-constant ERR-INVALID-QUANTITY u119)
(define-constant ERR-INVALID-DISCOUNT u120)
(define-constant ERR-INVALID-TAX-RATE u121)
(define-constant ERR-INVALID-SHIPPING-FEE u122)
(define-constant ERR-INVALID-INSURANCE-FEE u123)
(define-constant ERR-INVALID-REFUND-PERCENT u124)
(define-constant ERR-INVALID-REPLACEMENT-POLICY u125)

(define-data-var next-purchase-id uint u1)
(define-data-var max-purchases uint u10000)
(define-data-var escrow-fee-rate uint u1)
(define-data-var authority-contract (optional principal) none)

(define-map purchases
  uint
  {
    buyer: principal,
    seller: principal,
    listing-id: uint,
    amount: uint,
    status: (string-ascii 20),
    timestamp: uint,
    escrow-duration: uint,
    delivery-deadline: uint,
    currency: (string-ascii 10),
    quantity: uint,
    discount: uint,
    tax-rate: uint,
    shipping-fee: uint,
    insurance-fee: uint,
    refund-percent: uint,
    replacement-policy: bool
  }
)

(define-map purchase-updates
  uint
  {
    update-status: (string-ascii 20),
    update-timestamp: uint,
    updater: principal
  }
)

(define-read-only (get-purchase (id uint))
  (map-get? purchases id)
)

(define-read-only (get-purchase-updates (id uint))
  (map-get? purchase-updates id)
)

(define-read-only (get-next-purchase-id)
  (ok (var-get next-purchase-id))
)

(define-private (validate-listing-id (id uint))
  (if (> id u0)
    (ok true)
    (err ERR-INVALID-LISTING-ID)
  )
)

(define-private (validate-amount (amount uint))
  (if (> amount u0)
    (ok true)
    (err ERR-INVALID-AMOUNT)
  )
)

(define-private (validate-status (status (string-ascii 20)))
  (if (or (is-eq status "pending") (is-eq status "delivered") (is-eq status "completed") (is-eq status "cancelled"))
    (ok true)
    (err ERR-INVALID-STATUS)
  )
)

(define-private (validate-timestamp (ts uint))
  (if (>= ts block-height)
    (ok true)
    (err ERR-INVALID-TIMESTAMP)
  )
)

(define-private (validate-escrow-duration (duration uint))
  (if (and (> duration u0) (<= duration u10080))
    (ok true)
    (err ERR-INVALID-ESCROW-DURATION)
  )
)

(define-private (validate-currency (cur (string-ascii 10)))
  (if (or (is-eq cur "STX") (is-eq cur "BTC") (is-eq cur "USD"))
    (ok true)
    (err ERR-INVALID-CURRENCY)
  )
)

(define-private (validate-delivery-deadline (deadline uint))
  (if (> deadline block-height)
    (ok true)
    (err ERR-INVALID-DELIVERY-DEADLINE)
  )
)

(define-private (validate-quantity (qty uint))
  (if (> qty u0)
    (ok true)
    (err ERR-INVALID-QUANTITY)
  )
)

(define-private (validate-discount (disc uint))
  (if (<= disc u100)
    (ok true)
    (err ERR-INVALID-DISCOUNT)
  )
)

(define-private (validate-tax-rate (rate uint))
  (if (<= rate u20)
    (ok true)
    (err ERR-INVALID-TAX-RATE)
  )
)

(define-private (validate-shipping-fee (fee uint))
  (if (>= fee u0)
    (ok true)
    (err ERR-INVALID-SHIPPING-FEE)
  )
)

(define-private (validate-insurance-fee (fee uint))
  (if (>= fee u0)
    (ok true)
    (err ERR-INVALID-INSURANCE-FEE)
  )
)

(define-private (validate-refund-percent (percent uint))
  (if (<= percent u100)
    (ok true)
    (err ERR-INVALID-REFUND-PERCENT)
  )
)

(define-private (validate-replacement-policy (policy bool))
  (ok true)
)

(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)

(define-public (set-max-purchases (new-max uint))
  (begin
    (asserts! (> new-max u0) (err ERR-MAX-PURCHASES-EXCEEDED))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set max-purchases new-max)
    (ok true)
  )
)

(define-public (set-escrow-fee-rate (new-rate uint))
  (begin
    (asserts! (<= new-rate u10) (err ERR-INVALID-DISCOUNT))
    (asserts! (is-some (var-get authority-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set escrow-fee-rate new-rate)
    (ok true)
  )
)

(define-public (make-purchase
  (listing-id uint)
  (amount uint)
  (escrow-duration uint)
  (delivery-deadline uint)
  (currency (string-ascii 10))
  (quantity uint)
  (discount uint)
  (tax-rate uint)
  (shipping-fee uint)
  (insurance-fee uint)
  (refund-percent uint)
  (replacement-policy bool)
)
  (let (
    (purchase-id (var-get next-purchase-id))
    (current-max (var-get max-purchases))
    (authority (var-get authority-contract))
    (listing-opt (get-listing listing-id))
    (listing (unwrap! listing-opt (err ERR-LISTING-NOT-FOUND)))
    (seller (get seller listing))
    (net-amount (+ amount shipping-fee insurance-fee))
    (fee (* net-amount (var-get escrow-fee-rate)))
    (total-transfer (+ net-amount fee))
  )
    (asserts! (< purchase-id current-max) (err ERR-MAX-PURCHASES-EXCEEDED))
    (try! (validate-listing-id listing-id))
    (try! (validate-amount amount))
    (try! (validate-escrow-duration escrow-duration))
    (try! (validate-delivery-deadline delivery-deadline))
    (try! (validate-currency currency))
    (try! (validate-quantity quantity))
    (try! (validate-discount discount))
    (try! (validate-tax-rate tax-rate))
    (try! (validate-shipping-fee shipping-fee))
    (try! (validate-insurance-fee insurance-fee))
    (try! (validate-refund-percent refund-percent))
    (try! (validate-replacement-policy replacement-policy))
    (asserts! (is-some authority) (err ERR-NOT-AUTHORIZED))
    (let ((authority-recipient (unwrap! authority (err ERR-NOT-AUTHORIZED))))
      (try! (stx-transfer? total-transfer tx-sender (as-contract tx-sender)))
      (try! (as-contract (stx-transfer? fee tx-sender authority-recipient)))
    )
    (map-set purchases purchase-id
      {
        buyer: tx-sender,
        seller: seller,
        listing-id: listing-id,
        amount: amount,
        status: "pending",
        timestamp: block-height,
        escrow-duration: escrow-duration,
        delivery-deadline: delivery-deadline,
        currency: currency,
        quantity: quantity,
        discount: discount,
        tax-rate: tax-rate,
        shipping-fee: shipping-fee,
        insurance-fee: insurance-fee,
        refund-percent: refund-percent,
        replacement-policy: replacement-policy
      }
    )
    (var-set next-purchase-id (+ purchase-id u1))
    (print { event: "purchase-created", id: purchase-id })
    (ok purchase-id)
  )
)

(define-public (release-escrow (purchase-id uint))
  (let (
    (purchase-opt (map-get? purchases purchase-id))
    (purchase (unwrap! purchase-opt (err ERR-PURCHASE-NOT-FOUND)))
    (seller (get seller purchase))
    (amount (get amount purchase))
    (shipping-fee (get shipping-fee purchase))
    (insurance-fee (get insurance-fee purchase))
    (net-release (+ amount shipping-fee insurance-fee))
  )
    (asserts! (is-eq (get status purchase) "delivered") (err ERR-ESCROW-NOT-RELEASABLE))
    (asserts! (or (is-eq tx-sender (get buyer purchase)) (is-eq tx-sender seller)) (err ERR-NOT-AUTHORIZED))
    (asserts! (<= block-height (get delivery-deadline purchase)) (err ERR-ESCROW-EXPIRED))
    (as-contract (try! (stx-transfer? net-release tx-sender seller)))
    (map-set purchases purchase-id (merge purchase { status: "completed" }))
    (map-set purchase-updates purchase-id
      {
        update-status: "completed",
        update-timestamp: block-height,
        updater: tx-sender
      }
    )
    (print { event: "escrow-released", id: purchase-id })
    (ok true)
  )
)

(define-public (cancel-purchase (purchase-id uint))
  (let (
    (purchase-opt (map-get? purchases purchase-id))
    (purchase (unwrap! purchase-opt (err ERR-PURCHASE-NOT-FOUND)))
    (buyer (get buyer purchase))
    (amount (get amount purchase))
    (shipping-fee (get shipping-fee purchase))
    (insurance-fee (get insurance-fee purchase))
    (net-refund (+ amount shipping-fee insurance-fee))
  )
    (asserts! (is-eq (get status purchase) "pending") (err ERR-INVALID-STATUS))
    (asserts! (is-eq tx-sender buyer) (err ERR-BUYER-MISMATCH))
    (as-contract (try! (stx-transfer? net-refund tx-sender buyer)))
    (map-set purchases purchase-id (merge purchase { status: "cancelled" }))
    (map-set purchase-updates purchase-id
      {
        update-status: "cancelled",
        update-timestamp: block-height,
        updater: tx-sender
      }
    )
    (print { event: "purchase-cancelled", id: purchase-id })
    (ok true)
  )
)

(define-public (update-purchase-status (purchase-id uint) (new-status (string-ascii 20)))
  (let (
    (purchase-opt (map-get? purchases purchase-id))
    (purchase (unwrap! purchase-opt (err ERR-PURCHASE-NOT-FOUND)))
  )
    (asserts! (is-eq tx-sender (get seller purchase)) (err ERR-SELLER-MISMATCH))
    (try! (validate-status new-status))
    (map-set purchases purchase-id (merge purchase { status: new-status }))
    (map-set purchase-updates purchase-id
      {
        update-status: new-status,
        update-timestamp: block-height,
        updater: tx-sender
      }
    )
    (print { event: "status-updated", id: purchase-id, status: new-status })
    (ok true)
  )
)

(define-public (get-purchase-count)
  (ok (var-get next-purchase-id))
)