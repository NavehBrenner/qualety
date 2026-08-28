class UnusedBag:
    x = 1


class OnceBag:
    y = 2


OnceBag()


def inner(n):
    return n + 1


class Pipe:
    def run(self, n):
        return inner(n)


Pipe()
