def with_list(xs=[]):
    return xs


def with_dict(xs={}):
    return xs


def with_set(xs=set()):
    return xs


def with_list_call(xs=list()):
    return xs


def with_dict_call(xs=dict()):
    return xs


async def with_async(xs=[]):
    return xs


def factory():
    return []


def with_factory(xs=factory()):
    return xs
