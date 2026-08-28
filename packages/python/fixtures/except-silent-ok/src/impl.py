def log(msg):
    return msg


def f():
    try:
        x = 1
    except ValueError:
        log("err")
        raise

    try:
        x = 1
    except ValueError:
        return

    try:
        x = 1
    except ValueError:
        raise

    try:
        x = 1
    except ValueError:
        pass
        raise
