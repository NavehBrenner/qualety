from typing import Any
import typing

X = Any


def with_any(x: Any) -> int:
    return 1


def returns_any(x: int) -> Any:
    return x


def typing_any(x: typing.Any) -> int:
    return 1


def aliased(x: X) -> int:
    return 1
