def f():
    try:
        x = 1
    except ValueError:
        pass

    try:
        x = 1
    except ValueError:
        ...

    try:
        x = 1
    except ValueError:
        "swallowed"

    for _ in range(1):
        try:
            x = 1
        except ValueError:
            continue


def trailing_pass():
    try:
        x = 1
    except ValueError:
        pass


def string_then_return():
    try:
        x = 1
    except ValueError:
        "swallowed"
    return


def mixed_pass_continue():
    for _ in range(1):
        try:
            x = 1
        except ValueError:
            pass
            continue
