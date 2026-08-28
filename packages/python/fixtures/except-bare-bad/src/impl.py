def f():
    try:
        x = 1
    except:
        raise

    try:
        x = 1
    except BaseException:
        raise

    try:
        x = 1
    except BaseException as e:
        raise e

    try:
        x = 1
    except (ValueError, BaseException):
        raise
