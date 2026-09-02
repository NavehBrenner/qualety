from lock import LockController

controller = LockController()
first = controller.release_lock()
second = controller.release_lock()
