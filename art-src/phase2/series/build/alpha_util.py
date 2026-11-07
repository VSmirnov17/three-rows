from PIL import Image, ImageFilter
import numpy as np
from scipy import ndimage
def outer_alpha(im, thr=42, seeds=((0,0),)):
    a=np.array(im.convert('RGB')).astype(int)
    lum=(a[...,0]*0.3+a[...,1]*0.59+a[...,2]*0.11)
    cand=lum<thr
    lab,n=ndimage.label(cand)
    out=np.zeros(cand.shape,bool)
    for (x,y) in seeds:
        out|=(lab==lab[y,x])
    keep=Image.fromarray(np.where(out,0,255).astype(np.uint8))
    return keep.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
