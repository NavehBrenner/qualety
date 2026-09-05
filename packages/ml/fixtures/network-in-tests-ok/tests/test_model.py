from torchvision.models import resnet18


def test_load():
    resnet18(pretrained=False)
