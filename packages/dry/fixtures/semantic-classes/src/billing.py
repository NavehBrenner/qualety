class BillingTotals:
    def compute(self, lines):
        goods = 0
        taxes = 0
        for line in lines:
            extended = line["quantity"] * line["unit_price"]
            goods += extended
            taxes += extended * line["tax_rate"]
        freight = 0 if goods > 250 else 15
        coupon = 25 if goods > 400 else 0
        return goods + taxes + freight - coupon
