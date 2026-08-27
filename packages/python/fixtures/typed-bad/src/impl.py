def public_fn(x):
    return x


def public_args(*args, **kwargs) -> None:
    return None


class Box:
    def run(self, x):
        return x
