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


def fallthrough_pass():
    try:
        return 1
    except OSError:
        pass
    return 0


def continue_then_raise():
    for _ in (1,):
        try:
            return 1
        except OSError:
            continue
    raise RuntimeError("none")


def continue_then_return():
    for _ in (1,):
        try:
            return 1
        except OSError:
            continue
    return 0


def ellipsis_then_return():
    try:
        x = 1
    except ValueError:
        ...
    return


def ellipsis_then_assign():
    try:
        x = 1
    except ValueError:
        ...
    y = 0


def pass_then_annassign():
    try:
        x = 1
    except ValueError:
        pass
    y: int = 0
