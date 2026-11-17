from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets" / "brand"
OUT.mkdir(parents=True, exist_ok=True)
S = 1024

def rr(d, box, radius, fill, outline=None, width=1):
    d.rounded_rectangle(tuple(int(x) for x in box), radius=int(radius), fill=fill, outline=outline, width=width)

def gradient(size, top, bottom, alpha=255):
    layer = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(layer)
    for y in range(size):
        t = y / (size - 1)
        d.line((0,y,size,y),fill=tuple(round(top[i]*(1-t)+bottom[i]*t) for i in range(3))+(alpha,))
    return layer

def mask_round(box,radius,size=S):
    mask=Image.new("L",(size,size),0)
    rr(ImageDraw.Draw(mask),box,radius,255)
    return mask

def glow(img,rect,radius,color,blur):
    layer=Image.new("RGBA",img.size,(0,0,0,0))
    rr(ImageDraw.Draw(layer),rect,radius,color)
    img.alpha_composite(layer.filter(ImageFilter.GaussianBlur(blur)))

def render():
    im=Image.new("RGBA",(S,S),(0,0,0,0))
    glow(im,(103,87,929,965),138,(26,137,244,80),48)
    shadow=Image.new("RGBA",(S,S),(0,0,0,0))
    rr(ImageDraw.Draw(shadow),(105,88,922,920),134,(3,9,34,230))
    im.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(20)),(0,25))
    shell=gradient(S,(14,82,149),(3,22,61))
    mask=mask_round((88,64,935,928),144)
    im.paste(shell,(0,0),mask)
    d=ImageDraw.Draw(im)
    rr(d,(91,67,930,923),141,None,outline=(60,173,245,255),width=16)
    rr(d,(108,88,915,901),122,None,outline=(11,47,100,255),width=6)
    # Color-coded window controls, deliberately larger for fast legibility.
    for cx,color in [(217,(255,99,99,255)),(319,(255,194,62,255)),(421,(76,223,151,255))]:
        d.ellipse((cx-30,178,cx+30,238),fill=color)
        d.arc((cx-30,178,cx+30,238),195,310,fill=(255,255,255,90),width=4)
    # The cyan terminal pane is the emblem's primary silhouette.
    glow(im,(110,294,914,877),83,(32,232,239,110),18)
    pane=gradient(S,(15,207,222),(4,112,192))
    panel_mask=mask_round((116,290,908,865),82)
    im.paste(pane,(0,0),panel_mask)
    d=ImageDraw.Draw(im)
    rr(d,(116,290,908,865),82,None,outline=(76,241,236,255),width=13)
    d.line((154,317,882,317),fill=(189,255,255,90),width=4)
    # Light sweep and prompt, with readable stroke at favicon size.
    sweep=Image.new("RGBA",(S,S),(0,0,0,0))
    sd=ImageDraw.Draw(sweep)
    sd.polygon([(675,301),(900,301),(900,490),(553,837),(405,837)],fill=(255,255,255,24))
    smask=Image.new("L",(S,S),0)
    rr(ImageDraw.Draw(smask),(129,302,895,852),74,255)
    sweep.putalpha(Image.composite(sweep.getchannel("A"), Image.new("L",(S,S),0),smask))
    im.alpha_composite(sweep)
    d=ImageDraw.Draw(im)
    prompt=[(294,433),(420,551),(294,671)]
    d.line([(x+10,y+13) for x,y in prompt],fill=(0,27,77,115),width=67,joint="curve")
    for x,y in prompt:
        d.ellipse((x+10-33,y+13-33,x+10+33,y+13+33),fill=(0,27,77,115))
    d.line(prompt,fill=(255,255,255,255),width=58,joint="curve")
    for x,y in [prompt[0],prompt[-1]]:
        d.ellipse((x-29,y-29,x+29,y+29),fill=(255,255,255,255))
    rr(d,(468,649,719,707),29,(255,255,255,255))
    # At 16px dots and glow compete with prompt; keep the recognizable >_ larger.
    return im

master=render()
master.resize((512,512),Image.Resampling.LANCZOS).save(OUT/"icon-512.png",optimize=True)
for size, filename in [(192,"icon-192.png"),(180,"apple-touch-icon.png"),(32,"favicon-32.png"),(16,"favicon-16.png")]:
    im=master.resize((size,size),Image.Resampling.LANCZOS)
    im.save(OUT/filename,optimize=True)
master.save(OUT/"favicon.ico",format="ICO",sizes=[(16,16),(32,32),(48,48)])
shutil.copyfile(OUT/"icon-512.png",ROOT/"assets"/"ssh-mcp-pro-icon.png")
print("Generated", [(x.name,x.stat().st_size) for x in sorted(OUT.glob("*"))])
