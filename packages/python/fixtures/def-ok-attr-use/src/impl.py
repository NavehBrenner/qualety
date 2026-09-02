class BoardSpec:
    def __init__(self, width):
        self.width = width

    @property
    def width_m(self):
        return self.width / 1000

    def describe(self):
        return "board"

    def helper(self):
        return 1

    def render(self, spec):
        if spec.width_m:
            if spec.describe():
                first = spec.describe()
                a = self.helper()
                b = self.helper()
                return first, a, b
        return spec.width_m
