# Пробник: готовит слои из картинок Codex (выбрасывается вместе с пробником)
import sys, json
from PIL import Image, ImageFilter, ImageChops, ImageDraw
import numpy as np
D = sys.argv[1]
plate = Image.open(f'{D}/gen-plate/image.png').convert('RGB')
W, H = plate.size
X0, X1, Y0, Y1 = 20, 170, 0, 905
crop = plate.crop((X0, Y0, X1, Y1))
a = np.asarray(crop).astype(np.float32)
lum = a.mean(axis=2)
blur = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(10))).astype(np.float32)
# маска воды: яркое и голубоватое
blue = a[..., 2] - a[..., 0]
m = np.clip((blur - 45) / 40, 0, 1) * np.clip((blue + 5) / 30, 0, 1)
m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255
yy = np.arange(m.shape[0])[:, None]
m *= np.clip(yy / 40, 0, 1) * np.clip((m.shape[0] - yy) / 60, 0, 1)
Image.fromarray((np.clip(m, 0, 1) * 255).astype(np.uint8), 'L').save(f'{D}/spike/wf-mask.png')
# текстура: высокие частоты (струи), растянутые по вертикали, бесшовная по вертикали
seg = crop.crop((0, 150, crop.width, 750))
s = np.asarray(seg).astype(np.float32)
low = np.asarray(seg.filter(ImageFilter.GaussianBlur(7))).astype(np.float32)
hp = np.clip((s - low) * 2.2 + 8, 0, 255)
tex = Image.fromarray(hp.astype(np.uint8)).resize((seg.width, int(seg.height * 1.3)), Image.BICUBIC).filter(ImageFilter.BoxBlur(0))
t = np.asarray(tex).astype(np.float32)
ov = 120
top, body = t[:ov], t[ov:]
# склейка: последние ov строк тела плавно переходят в первые ov строк (верх)
w = np.linspace(0, 1, ov)[:, None, None]
body[-ov:] = body[-ov:] * (1 - w) + top * w
Image.fromarray(body.astype(np.uint8)).save(f'{D}/spike/wf-tex.png')
# луна: ровная альфа диска
moon = Image.open(f'{D}/gen-moon/image.png').convert('RGBA')
al = np.asarray(moon)[..., 3]
ys, xs = np.where(al > 128)
cx, cy, r = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, (xs.max() - xs.min() + ys.max() - ys.min()) / 4
S = 4
big = Image.new('L', (moon.width * S, moon.height * S), 0)
ImageDraw.Draw(big).ellipse(((cx - r + 1.5) * S, (cy - r + 1.5) * S, (cx + r - 1.5) * S, (cy + r - 1.5) * S), fill=255)
moon.putalpha(big.resize(moon.size, Image.LANCZOS))
bb = (int(cx - r - 4), int(cy - r - 4), int(cx + r + 4), int(cy + r + 4))
moon.crop(bb).resize((256, 256), Image.LANCZOS).save(f'{D}/spike/moon.webp', quality=88)
plate.save(f'{D}/spike/plate.webp', quality=86)
geom = {'wf': {'x': X0 / W, 'y': Y0 / H, 'w': (X1 - X0) / W, 'h': (Y1 - Y0) / H}, 'texH': body.shape[0], 'cropW': X1 - X0, 'plateH': H}
json.dump(geom, open(f'{D}/spike/geom.json', 'w'))
print(geom)
