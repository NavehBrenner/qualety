def compute_order_total(lines: list[dict[str, float]]) -> float:
    goods = 0.0
    taxes = 0.0
    for line in lines:
        quantity = line["quantity"]
        unit_price = line["unit_price"]
        tax_rate = line["tax_rate"]
        extended = quantity * unit_price
        goods += extended
        taxes += extended * tax_rate
        if quantity >= 25:
            goods -= extended * 0.08
        elif quantity >= 10:
            goods -= extended * 0.03
    freight = 0.0 if goods > 250 else 8.5 if goods > 100 else 15.0
    coupon = 25.0 if goods > 400 else 0.0
    return goods + taxes + freight - coupon
