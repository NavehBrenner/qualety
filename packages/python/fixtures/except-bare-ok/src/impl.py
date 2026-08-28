def f():
    try:
        x = 1
    except Exception:
        raise

    try:
        x = 1
    except ValueError:
        raise

    try:
        x = 1
    except (ValueError, OSError):
        raise

    try:
        x = 1
    except Exception as e:
        raise e
