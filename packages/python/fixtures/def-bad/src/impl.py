def wrap(n):
    return add(n)


def add(n):
    return n + 1


after_wrap = wrap(1)


def small_flat(n):
    next_n = n + 1
    return next_n


after_small = small_flat(3)
