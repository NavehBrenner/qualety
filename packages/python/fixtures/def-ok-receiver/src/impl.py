class Grabber:
    def via_self_attribute(self):
        return 1

    def via_constructor(self):
        return 2


class Host:
    _grabber = Grabber()

    def __init__(self):
        self._grabber = Grabber()

    def run(self):
        if True:
            if True:
                a = self._grabber.via_self_attribute()
                b = self._grabber.via_self_attribute()
                c = Grabber().via_constructor()
                d = Grabber().via_constructor()
                return a, b, c, d
        return None
