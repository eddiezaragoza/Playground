# Writes test.gif (small animated) and big.gif (~19 MB, over the 5 MB limit) into the folder given, for gif_ui.py.
import sys, os
from PIL import Image, ImageDraw
out = sys.argv[1]
frames = []
for i in range(12):
    im = Image.new('RGB', (320, 200), (30 + i * 15, 60, 200 - i * 10)); d = ImageDraw.Draw(im)
    d.ellipse((20 + i * 22, 70, 80 + i * 22, 130), fill=(255, 220, 0)); frames.append(im)
frames[0].save(os.path.join(out, 'test.gif'), save_all=True, append_images=frames[1:], duration=80, loop=0)
big = [Image.effect_noise((900, 900), 100).convert('RGB') for _ in range(20)]
big[0].save(os.path.join(out, 'big.gif'), save_all=True, append_images=big[1:], duration=80, loop=0)
