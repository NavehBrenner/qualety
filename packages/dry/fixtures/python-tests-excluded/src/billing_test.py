def calculate_billing_total(rows: list[float]) -> float:
    goods = 0.0
    for row in rows:
        goods += row
        if row >= 25:
            goods -= row * 0.08
        elif row >= 10:
            goods -= row * 0.03
    return goods
