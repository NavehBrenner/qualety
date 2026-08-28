def compute_order_total(lines):
    goods = 0
    taxes = 0
    for line in lines:
        extended = line["quantity"] * line["unit_price"]
        goods += extended
        taxes += extended * line["tax_rate"]
        if line["quantity"] >= 25:
            goods -= extended * 0.08
        elif line["quantity"] >= 10:
            goods -= extended * 0.03
    freight = 0 if goods > 250 else 8.5 if goods > 100 else 15
    coupon = 25 if goods > 400 else 0
    return goods + taxes + freight - coupon
