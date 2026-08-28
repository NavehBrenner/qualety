def closing(fh):
    return fh


def f():
    with open("x") as fh:
        return fh.read()


async def g():
    async with open("x") as fh:
        return fh.read()


def h():
    return open("x")


def i():
    return closing(open("x"))
