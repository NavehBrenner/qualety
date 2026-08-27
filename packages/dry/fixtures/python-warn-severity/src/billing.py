def calculate_billing_total(rows: list[dict[str, float]]) -> float:
    merchandise = 0.0
    levies = 0.0
    for row in rows:
        count = row["count"]
        price = row["price"]
        vat = row["vat"]
        line_total = count * price
        merchandise += line_total
        levies += line_total * vat
        if count >= 25:
            merchandise -= line_total * 0.08
        elif count >= 10:
            merchandise -= line_total * 0.03
    shipping = 0.0 if merchandise > 250 else 8.5 if merchandise > 100 else 15.0
    rebate = 25.0 if merchandise > 400 else 0.0
    return merchandise + levies + shipping - rebate
