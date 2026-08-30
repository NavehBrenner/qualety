from functools import partial


def sort_key(n):
    return n


def mapped(n):
    return n + 1


xs = sorted([1, 2, 3], key=sort_key)
bound = partial(mapped, 1)
