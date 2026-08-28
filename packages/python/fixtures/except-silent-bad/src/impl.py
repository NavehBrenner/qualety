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
