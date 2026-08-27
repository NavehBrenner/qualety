from typing import overload


def public_fn(x: int) -> int:
    return x


def _private(x):
    return x


def outer(x: int) -> int:
    def inner(y):
        return y

    return inner(x)


class Box:
    def __init__(self) -> None:
        return None

    def run(self, x: int) -> int:
        return x


class _Hidden:
    def run(self, x):
        return x


@overload
def over(x: int) -> int: ...


def over(x: object) -> object:
    return x
