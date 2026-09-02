from torch.utils.data import DataLoader

g = None
loader = DataLoader([], num_workers=2, generator=g)
zero = DataLoader([], num_workers=0)
init = DataLoader([], num_workers=2, worker_init_fn=lambda ident: None)
