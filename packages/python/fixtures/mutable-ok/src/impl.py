def with_none(xs=None):
    return xs


def with_tuple(xs=()):
    return xs


def with_frozen(xs=frozenset()):
    return xs


def with_unknown(xs=external()):
    return xs
