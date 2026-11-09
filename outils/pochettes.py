"""Pochettes « photo » de laser game : lumière laser diffusée dans une fumée réaliste.
Rendu physique simplifié : densité de fumée fractale, faisceaux (cœur + diffusion modulée par la fumée),
cônes de projecteurs, obstacles en contre-jour, reflets au sol, bokeh, bloom, grain, vignettage."""
import sys, numpy as np
from scipy.ndimage import gaussian_filter, map_coordinates
from PIL import Image, ImageDraw, ImageFilter

N = 1000
Y, X = np.mgrid[0:N, 0:N].astype(np.float32)

def smoke(seed, scales=(6, 12, 24, 48, 96, 180), warp=40):
    r = np.random.default_rng(seed)
    acc = np.zeros((N, N), np.float32); amp = 1.0; tot = 0
    for s in scales[::-1]:
        f = gaussian_filter(r.standard_normal((N, N)).astype(np.float32), s)
        f /= f.std() + 1e-6; acc += f * amp; tot += amp; amp *= 0.62
    acc /= tot
    # déformation pour des volutes
    wx = gaussian_filter(r.standard_normal((N, N)).astype(np.float32), 60); wx /= wx.std()
    wy = gaussian_filter(r.standard_normal((N, N)).astype(np.float32), 60); wy /= wy.std()
    acc = map_coordinates(acc, [Y + wy * warp, X + wx * warp], order=1, mode='reflect')
    acc = (acc - acc.min()) / (acc.max() - acc.min())
    return acc

def seg_dist(p1, p2):
    (x1, y1), (x2, y2) = p1, p2
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    t = np.clip(((X - x1) * dx + (Y - y1) * dy) / L2, 0, 1)
    return np.hypot(X - (x1 + t * dx), Y - (y1 + t * dy)), t

class Scene:
    def __init__(self, seed, fog_level, fog_contrast=1.6):
        self.L = np.zeros((N, N, 3), np.float32)
        s = smoke(seed)
        self.D = (fog_level * (0.15 + 1.25 * s ** fog_contrast)).astype(np.float32)
        self.rng = np.random.default_rng(seed + 99)
    def beam(self, p1, p2, col, w=1.6, k=1.0, fade=(1, 1)):
        d, t = seg_dist(p1, p2)
        along = fade[0] + (fade[1] - fade[0]) * t
        core = np.exp(-(d / w) ** 2)
        halo = 1 / (1 + (d / (w * 7)) ** 2)
        wide = np.exp(-(d / (w * 40)) ** 2)
        I = (core * (0.55 + 0.9 * self.D) * 2.4 + halo * self.D * 1.3 + wide * self.D * 0.38) * k * along
        self.L += I[..., None] * np.array(col, np.float32)[None, None]
    def cone(self, src, ang, spread, length, col, k=1.0):
        dx, dy = X - src[0], Y - src[1]
        r = np.hypot(dx, dy) + 1e-3
        a = np.arctan2(dy, dx) - ang
        a = (a + np.pi) % (2 * np.pi) - np.pi
        prof = np.exp(-(a / spread) ** 2) * np.exp(-r / length)
        self.L += (prof * self.D * k)[..., None] * np.array(col, np.float32)
    def glow(self, c, r, col, k=1.0):
        d = np.hypot(X - c[0], Y - c[1])
        I = np.exp(-(d / r) ** 2) * 3 + 1 / (1 + (d / (r * 4)) ** 2) * self.D * 0.8
        self.L += (I * k)[..., None] * np.array(col, np.float32)
    def ambient(self, col, k):
        self.L += (self.D * k)[..., None] * np.array(col, np.float32)
    def bokeh(self, n, area, cols, rmin, rmax, k):
        img = Image.new('RGB', (N, N)); dr = ImageDraw.Draw(img)
        for i in range(n):
            x = self.rng.uniform(*area[0]); y = self.rng.uniform(*area[1]); r = self.rng.uniform(rmin, rmax)
            c = cols[i % len(cols)]; a = self.rng.uniform(.35, 1)
            dr.ellipse([x - r, y - r, x + r, y + r], fill=tuple(int(v * 140 * a) for v in c), outline=tuple(int(v * 230 * a) for v in c), width=max(1, int(r * .12)))
        b = np.asarray(img.filter(ImageFilter.GaussianBlur(3.5)), np.float32) / 255
        self.L += b * k
    def occlude(self, polys, rim_col=None, rim_k=0.0, base=0.006):
        m = Image.new('L', (N, N)); dr = ImageDraw.Draw(m)
        for p in polys: dr.polygon(p, fill=255)
        mask = np.asarray(m.filter(ImageFilter.GaussianBlur(1.2)), np.float32) / 255
        lit = gaussian_filter(self.L, (3, 3, 0))
        self.L = self.L * (1 - mask[..., None]) + mask[..., None] * (base + lit * 0.04)
        if rim_col is not None:
            edge = np.asarray(m.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(2)), np.float32) / 255
            self.L += (edge * rim_k)[..., None] * np.array(rim_col, np.float32)
        self.mask = mask
        return mask
    def uv_paint(self, cols, n, k):
        img = Image.new('RGB', (N, N)); dr = ImageDraw.Draw(img)
        for i in range(n):
            c = tuple(int(v * 255) for v in cols[i % len(cols)])
            x0, y0 = self.rng.uniform(0, N), self.rng.uniform(450, N)
            if i % 3 == 0:   # éclaboussure de peinture
                r = self.rng.uniform(6, 22); dr.ellipse([x0 - r, y0 - r, x0 + r, y0 + r], fill=c)
                for _ in range(6):
                    a, d, rr = self.rng.uniform(0, 6.3), self.rng.uniform(r, r * 2.6), self.rng.uniform(1.5, 5)
                    dr.ellipse([x0 + np.cos(a) * d - rr, y0 + np.sin(a) * d - rr, x0 + np.cos(a) * d + rr, y0 + np.sin(a) * d + rr], fill=c)
            else:            # trait de peinture souple
                L, amp, f, ph = self.rng.uniform(80, 260), self.rng.uniform(6, 22), self.rng.uniform(.01, .03), self.rng.uniform(0, 6)
                ang = self.rng.uniform(-.5, .5)
                pts = [(x0 + t * np.cos(ang) - amp * np.sin(f * t + ph) * np.sin(ang), y0 + t * np.sin(ang) + amp * np.sin(f * t + ph) * np.cos(ang)) for t in np.linspace(0, L, 40)]
                dr.line(pts, fill=c, width=int(self.rng.uniform(4, 10)), joint='curve')
        u = np.asarray(img.filter(ImageFilter.GaussianBlur(1.8)), np.float32) / 255
        u = u * self.mask[..., None]
        self.L += (u * 0.8 + gaussian_filter(u, (10, 10, 0)) * 1.8) * k

    def floor(self, y0, k=0.35, blur=9):
        top = self.L[:y0][::-1]
        h = min(N - y0, top.shape[0])
        refl = gaussian_filter(top[:h], (blur, blur * .4, 0)) * k
        ramp = np.linspace(1, .25, h, dtype=np.float32)[:, None, None]
        self.L[y0:y0 + h] = self.L[y0:y0 + h] * 0.35 + refl * ramp
    def develop(self, path, exposure=1.0, seed=0):
        L = self.L * exposure
        bloom = gaussian_filter(np.clip(L - 0.8, 0, None), (14, 14, 0)) * 0.6
        L = L + bloom
        img = 1 - np.exp(-L)
        img = img ** (1 / 1.15)
        # aberration chromatique
        img[..., 0] = np.roll(img[..., 0], 2, axis=1); img[..., 2] = np.roll(img[..., 2], -2, axis=1)
        # vignettage
        v = 1 - 0.55 * (((X - N / 2) ** 2 + (Y - N / 2) ** 2) / (N * N / 2)) ** 1.1
        img *= v[..., None]
        # grain
        g = np.random.default_rng(seed).normal(0, 0.028, (N, N)).astype(np.float32)
        g = gaussian_filter(g, .7)
        img = np.clip(img + g[..., None] * (0.4 + img), 0, 1)
        Image.fromarray((img * 255).astype(np.uint8)).save(path, 'WEBP', quality=90)

RED = (1.0, 0.08, 0.06); GREEN = (0.15, 1.0, 0.25); BLUE = (0.15, 0.35, 1.0)
VIOLET = (0.65, 0.18, 1.0); PINK = (1.0, 0.15, 0.6); CYAN = (0.1, 0.85, 1.0); AMBER = (1.0, 0.55, 0.18)

def arena(path):
    s = Scene(4, 1.0)
    s.ambient(VIOLET, 0.09); s.ambient(BLUE, 0.05)
    s.cone((620, -60), np.pi / 2 + .12, .22, 900, VIOLET, 0.55)
    s.cone((180, -60), np.pi / 2 - .05, .16, 800, BLUE, 0.35)
    s.bokeh(26, ((380, 900), (300, 520)), [CYAN, PINK, (1, 1, 1)], 2, 6, 0.9)
    s.beam((-20, 380), (1020, 640), RED, 1.4, 1.0)
    s.beam((-20, 820), (1020, 300), GREEN, 1.3, 0.8)
    s.beam((560, 470), (1020, 410), RED, 1.0, 0.7)
    s.beam((300, 520), (760, 560), GREEN, 0.9, 0.5)
    s.glow((560, 470), 6, RED, 0.9)
    # obstacles du labyrinthe en contre-jour
    s.occlude([[(0, 1000), (0, 560), (40, 540), (250, 540), (290, 560), (290, 1000)],
               [(640, 1000), (640, 600), (690, 580), (1000, 580), (1000, 1000)],
               [(380, 1000), (380, 700), (520, 700), (520, 1000)],
               [(820, 580), (820, 260), (860, 240), (900, 260), (900, 580)]], VIOLET, 0.25)
    s.uv_paint([PINK, CYAN, GREEN, (1, .9, .2)], 55, 0.16)
    s.floor(905, 0.4)
    s.develop(path, 1.35, 1)

def beats(path):
    s = Scene(9, 1.05, 1.3)
    s.ambient(GREEN, 0.05); s.ambient(VIOLET, 0.04)
    src = (500, 120)
    cols = [GREEN, VIOLET, CYAN]
    for i in range(15):
        a = np.pi / 2 + (i - 7) * 0.085
        end = (src[0] + np.cos(a) * 1300, src[1] + np.sin(a) * 1300)
        s.beam(src, end, cols[i % 3], 1.1, 0.42, fade=(1.0, 0.45))
    s.glow(src, 9, (0.7, 1, 0.8), 1.0)
    s.cone(src, np.pi / 2, .55, 700, GREEN, 0.35)
    s.bokeh(18, ((50, 950), (40, 200)), [VIOLET, (1, 1, 1), CYAN], 2, 5, 0.6)
    s.occlude([[(0, 1000), (0, 760), (30, 740), (330, 740), (360, 760), (360, 1000)],
               [(420, 1000), (420, 830), (600, 830), (600, 1000)],
               [(660, 1000), (660, 780), (700, 760), (1000, 760), (1000, 1000)]], GREEN, 0.3)
    s.uv_paint([GREEN, VIOLET, CYAN], 30, 0.12)
    s.develop(path, 1.25, 2)

def accueil(path):
    s = Scene(15, 0.8, 1.2)
    s.ambient(AMBER, 0.08)
    s.cone((250, -40), np.pi / 2 + .05, .14, 700, AMBER, 0.9)
    s.cone((520, -40), np.pi / 2, .13, 700, AMBER, 0.75)
    s.cone((790, -40), np.pi / 2 - .05, .14, 700, AMBER, 0.85)
    s.bokeh(45, ((0, 1000), (120, 700)), [AMBER, (1, .8, .55), CYAN, PINK], 6, 22, 0.3)
    s.beam((120, 300), (420, 300), CYAN, 4, 0.5)   # néon flou
    s.beam((620, 240), (880, 240), PINK, 4, 0.45)
    s.occlude([[(0, 1000), (0, 820), (1000, 790), (1000, 1000)]], AMBER, 0.9, base=0.03)
    s.glow((250, 805), 30, AMBER, 0.25); s.glow((520, 800), 30, AMBER, 0.2); s.glow((790, 795), 30, AMBER, 0.25)
    s.develop(path, 1.2, 3)

out = sys.argv[1]
arena(out + '/arena.webp'); beats(out + '/beats.webp'); accueil(out + '/accueil.webp')
ims = [Image.open(out + f'/{n}.webp') for n in ['arena', 'beats', 'accueil']]
m = Image.new('RGB', (3000, 1000)); [m.paste(im, (i * 1000, 0)) for i, im in enumerate(ims)]
m.resize((1500, 500)).save(out + '/planche.png')
