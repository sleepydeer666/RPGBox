from pathlib import Path
from collections import deque

from PIL import Image


ROOT = Path("立绘资源") / "tsk"


def remove_alpha_specks(image: Image.Image, minimum_area: int = 24) -> None:
    alpha = image.getchannel("A")
    width, height = alpha.size
    pixels = alpha.load()
    visited = bytearray(width * height)

    for y in range(height):
        for x in range(width):
            index = y * width + x
            if visited[index] or pixels[x, y] == 0:
                continue

            queue = deque([(x, y)])
            visited[index] = 1
            component = []
            while queue:
                current_x, current_y = queue.popleft()
                component.append((current_x, current_y))
                for neighbor_y in range(max(0, current_y - 1), min(height, current_y + 2)):
                    for neighbor_x in range(max(0, current_x - 1), min(width, current_x + 2)):
                        neighbor_index = neighbor_y * width + neighbor_x
                        if visited[neighbor_index] or pixels[neighbor_x, neighbor_y] == 0:
                            continue
                        visited[neighbor_index] = 1
                        queue.append((neighbor_x, neighbor_y))

            if len(component) < minimum_area:
                for component_x, component_y in component:
                    pixels[component_x, component_y] = 0

    image.putalpha(alpha)


def normalize(character: str) -> None:
    source = ROOT / "_work" / character / "大笑_transparent.png"
    destination = ROOT / character / f"{character}_大笑.png"

    with Image.open(source).convert("RGBA") as image:
        scale = 1200 / image.height
        width = round(image.width * scale)
        resized = image.resize((width, 1200), Image.Resampling.LANCZOS)
        if width < 800:
            raise ValueError(f"{source} becomes only {width}px wide at 1200px high")
        left = (width - 800) // 2
        cropped = resized.crop((left, 0, left + 800, 1200))
        alpha = cropped.getchannel("A").point(lambda value: 0 if value <= 32 else value)
        cropped.putalpha(alpha)
        remove_alpha_specks(cropped)
        cropped.save(destination)


for name in ("维纳斯", "菲欧娜"):
    normalize(name)
