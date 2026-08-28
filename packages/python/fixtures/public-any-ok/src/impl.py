from typing import Any


def typed(x: int) -> int:
    return x


def with_list(x: list[Any]) -> list[Any]:
    return x


def with_union(x: Any | None) -> Any | None:
    return x


def _private(x: Any) -> Any:
    return x


def outer(x: int) -> int:
    def inner(y: Any) -> Any:
        return y

    return inner(x)
