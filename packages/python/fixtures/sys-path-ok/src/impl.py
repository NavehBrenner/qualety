import sys


def show():
    print(sys.path)
    if "." in sys.path:
        return sys.path


class Bag:
    def append(self, item):
        return item


path = Bag()
path.append(".")
