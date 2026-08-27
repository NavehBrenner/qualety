def walk_depth_sum(nodes: list[dict[str, object]]) -> int:
    seen: set[int] = set()
    stack = [{"i": i, "depth": 1} for i in range(len(nodes))]
    total = 0
    while len(stack) > 0:
        frame = stack.pop()
        index = int(frame["i"])
        if index in seen:
            continue
        seen.add(index)
        node = nodes[index]
        total += int(node["value"]) * int(frame["depth"])
        kids = node["kids"]
        if isinstance(kids, list):
            for kid in kids:
                stack.append({"i": int(kid), "depth": int(frame["depth"]) + 1})
    return total
