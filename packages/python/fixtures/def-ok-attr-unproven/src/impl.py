class Grabber:
    def live(self):
        return 1

    def unused_other(self):
        return 2


def factory():
    if True:
        if True:
            return Grabber()
    return Grabber()


class Host:
    def __init__(self):
        self._x = factory()

    def run(self):
        if True:
            if True:
                return self._x.live()
        return None
