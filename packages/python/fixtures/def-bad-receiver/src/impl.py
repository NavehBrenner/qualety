class Grabber:
    def via_annotated(self):
        return 1

    def via_self_attribute(self):
        return 2

    def via_constructor(self):
        return 3

    def unused_fn(self):
        return 4


class Host:
    def __init__(self):
        self._grabber = Grabber()

    def run(self, grabber):
        if grabber:
            if True:
                a = grabber.via_annotated()
                b = self._grabber.via_self_attribute()
                c = Grabber().via_constructor()
                return a, b, c
        return None
