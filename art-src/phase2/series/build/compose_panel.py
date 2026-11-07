from PIL import Image
import numpy as np
SP='/private/tmp/claude-501/-Users-vladimirsmirnov-opencode-projects-deepseek-three-rows/dbe5aa84-e09c-43e8-9f8a-6cc45177cfb4/scratchpad'
f=Image.open('panel-frame-full.png')
LH,LV,OV=410,399,50
X0,X1=16,1520; Y0,Y1=42,976
Lw,Rw,T,B=148,139,96,96
W=Lw+LH+Rw; H=T+LV+B
out=Image.new('RGBA',(W,H),(0,0,0,0))
def paste(box,pos): out.alpha_composite(f.crop(box),pos)
def loop_tile(box,L,axis):
    """crop strip of length L+OV along axis, crossfade so tile is periodic with period L"""
    x0,y0,x1,y1=box
    if axis==0: strip=f.crop((x0,y0,x0+L+OV,y1))
    else: strip=f.crop((x0,y0,x1,y0+L+OV))
    a=np.array(strip).astype(float); a[...,:3]*=a[...,3:]/255  # premult
    if axis==0: a=a.transpose(1,0,2)
    t=a[:L].copy()
    w=np.linspace(0,1,OV)[None,:,None] if False else None
    w=np.linspace(0,1,OV)[:,None]
    for i in range(OV):
        wi=(i+0.5)/OV
        t[i]=(1-wi)*a[L+i]+wi*a[i]
    # unpremult
    al=t[...,3:]; rgb=np.where(al>0,t[...,:3]/np.maximum(al,1)*255,0)
    t=np.concatenate([np.clip(rgb,0,255),al],axis=2)
    if axis==0: t=t.transpose(1,0,2)
    return Image.fromarray(t.round().astype(np.uint8),'RGBA')
paste((X0,Y0,X0+Lw,Y0+T),(0,0))
paste((X1-Rw,Y0,X1,Y0+T),(W-Rw,0))
paste((X0,Y1-B,X0+Lw,Y1),(0,H-B))
paste((X1-Rw,Y1-B,X1,Y1),(W-Rw,H-B))
out.alpha_composite(loop_tile((X0+Lw,Y0,0,Y0+T),LH,0),(Lw,0))
out.alpha_composite(loop_tile((X0+Lw,Y1-B,0,Y1),LH,0),(Lw,H-B))
out.alpha_composite(loop_tile((X0,Y0+T,X0+Lw,0),LV,1),(0,T))
out.alpha_composite(loop_tile((X1-Rw,Y0+T,X1,0),LV,1),(W-Rw,T))
out.save('panel-frame-composed.png'); print(out.size, dict(Lw=Lw,Rw=Rw,T=T,B=B))
def stretch(w,h):
    nx=(w-Lw-Rw)//LH; ny=(h-T-B)//LV
    t=Image.new('RGBA',(Lw+nx*LH+Rw, T+ny*LV+B),(8,8,8,255))
    for i in range(nx):
        t.alpha_composite(out.crop((Lw,0,Lw+LH,T)),(Lw+i*LH,0)); t.alpha_composite(out.crop((Lw,H-B,Lw+LH,H)),(Lw+i*LH,t.height-B))
    for j in range(ny):
        t.alpha_composite(out.crop((0,T,Lw,T+LV)),(0,T+j*LV)); t.alpha_composite(out.crop((W-Rw,T,W,T+LV)),(t.width-Rw,T+j*LV))
    t.alpha_composite(out.crop((0,0,Lw,T)),(0,0)); t.alpha_composite(out.crop((W-Rw,0,W,T)),(t.width-Rw,0))
    t.alpha_composite(out.crop((0,H-B,Lw,H)),(0,t.height-B)); t.alpha_composite(out.crop((W-Rw,H-B,W,H)),(t.width-Rw,t.height-B))
    return t
t=stretch(1600,1100); t.save(SP+'/panel-test.png'); print(t.size)
bg=Image.new('RGBA',t.size,(30,30,30,255)); bg.alpha_composite(t)
a=bg.crop((0,400,260,600)).resize((780,600),Image.LANCZOS)
b=bg.crop((440,0,1100,110)).resize((1320,220),Image.LANCZOS)
c=Image.new('RGB',(1320,820),(0,0,0)); c.paste(a,(0,0)); c.paste(b,(0,600)); c.save(SP+'/seams.png')
