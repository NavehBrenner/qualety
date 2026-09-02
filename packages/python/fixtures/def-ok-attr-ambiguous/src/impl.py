class Alpha:
    def ping(self):
        return 1


class Beta:
    def ping(self):
        return 2


obj = Alpha()
seen = obj.ping()
