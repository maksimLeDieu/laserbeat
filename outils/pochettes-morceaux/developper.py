import sys, numpy as np
from scipy.ndimage import gaussian_filter
from PIL import Image
D=sys.argv[1]
names={'mic':'LaserBeat 1 - Phonk Laser Game','cassette':'LaserBeat 2 - Phonk','favela':'LaserBeat 3 - Mandelao','drift':'LaserBeat 4 - Drift Hardbass','blocks':'LaserBeat 5 - Drift Hardbass II','guitar':'LaserBeat 6 - Hard Rock'}
N=1000;Y,X=np.mgrid[0:N,0:N].astype(np.float32)
for i,(k,n) in enumerate(names.items()):
    im=np.asarray(Image.open(f'{D}/raw-{k}.png').convert('RGB'),np.float32)/255
    bloom=gaussian_filter(np.clip(im-.7,0,None),(12,12,0))*.8
    im=1-(1-im)*(1-bloom)
    im[...,0]=np.roll(im[...,0],2,1); im[...,2]=np.roll(im[...,2],-2,1)
    v=1-.5*(((X-N/2)**2+(Y-N/2)**2)/(N*N/2))**1.1; im*=v[...,None]
    g=gaussian_filter(np.random.default_rng(i).normal(0,.03,(N,N)).astype(np.float32),.7)
    if k=='cassette':  # lignes de balayage façon VHS
        im*= (0.93+0.07*(np.sin(Y*np.pi/2.5)**2))[...,None]
    im=np.clip(im+g[...,None]*(.35+im),0,1)
    Image.fromarray((im*255).astype(np.uint8)).save(f'{D}/{n}.webp','WEBP',quality=88)
ims=[Image.open(f'{D}/{n}.webp').resize((500,500)) for n in names.values()]
m=Image.new('RGB',(1500,1000));[m.paste(im,((j%3)*500,(j//3)*500)) for j,im in enumerate(ims)];m.save(f'{D}/planche.png')
