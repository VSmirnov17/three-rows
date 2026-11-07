import sys; sys.path.insert(0,'/private/tmp/claude-501/-Users-vladimirsmirnov-opencode-projects-deepseek-three-rows/dbe5aa84-e09c-43e8-9f8a-6cc45177cfb4/scratchpad')
from alpha_util import *
im=Image.open('job-panel-frame/image.png').convert('RGB')
keep=outer_alpha(im)
al=np.array(keep)
al[136:883,111:1425]=0   # inner field transparent
# feather inner edge slightly
alm=Image.fromarray(al,'L')
rgba=im.convert('RGBA'); rgba.putalpha(alm)
rgba.save('panel-frame-full.png')
a=np.array(im).astype(float); lum=a.mean(axis=2)
def best_len(strip_get, lo, hi, w=50):
    best=None
    for L in range(lo,hi):
        d=np.abs(strip_get(0,w)-strip_get(L,L+w)).mean()
        if best is None or d<best[0]: best=(d,L)
    return best
LH=best_len(lambda s,e: lum[42:135,164+s:164+e], 400,425); print('H tile',LH)
LV=best_len(lambda s,e: lum[135+s:135+e,16:164].T.T if False else lum[135+s:135+e,16:164], 392,412); print('V tile',LV)
LHb=best_len(lambda s,e: lum[883:976,164+s:164+e], 400,425); print('Hb',LHb)
LVr=best_len(lambda s,e: lum[135+s:135+e,1381:1520], 392,412); print('Vr',LVr)
