def compute_order_total(lines: list[float]) -> float:
    goods = 0.0
    for line in lines:
        goods += line
        if line >= 25:
            goods -= line * 0.08
        elif line >= 10:
            goods -= line * 0.03
    return goods
