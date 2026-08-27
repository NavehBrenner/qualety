def twice(n):
    return n + 1


first = twice(1)
second = twice(2)


def nested(n):
    if n > 0:
        if n > 1:
            return n
    return 0


after_nested = nested(3)
