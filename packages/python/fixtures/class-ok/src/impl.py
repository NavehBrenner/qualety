class UsedTwice:
    x = 1


UsedTwice()
UsedTwice()


class Parent:
    x = 1


class ChildA(Parent):
    y = 1


class ChildB(Parent):
    z = 1


class Derived(list):
    pass


class Heavy:
    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None
