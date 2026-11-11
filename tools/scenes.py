#!/usr/bin/env python3
"""Fonds d'écran de WeshTransfer : scènes de nuit, aplats, même palette que
img/scene.svg (la centrale). Génère img/scenes/*.svg.
Usage : python3 tools/scenes.py"""
import math, pathlib, random

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "scenes"

BG, HILL, HILL2 = "#0E0B14", "#16121E", "#1C1726"
MASS, MASS2, MASS3 = "#2A2239", "#251F33", "#221C2D"
EDGE, TRIM = "#3B3152", "#2C2540"
SMOKE = ["#3A3252", "#352D4B", "#40375A"]
VIOLET, WHITE, RED, FLAME, FLAME2 = "#A48BFF", "#E9E4F5", "#E8674A", "#E8904A", "#F2C46B"
GROUND = "#0A080E"

BASE_CSS = """
.smoke{animation:drift 31s linear infinite;transform-box:fill-box;transform-origin:50% 100%;opacity:0}
@keyframes drift{0%{transform:translate(0,0) scale(.5);opacity:0}12%{opacity:.95}100%{transform:translate(300px,-360px) scale(2.2);opacity:0}}
.blink{animation:blink 2.6s steps(1) infinite}
@keyframes blink{50%{opacity:.1}}
.tw{animation:tw 5s ease-in-out infinite}
@keyframes tw{50%{opacity:.2}}
"""
REDUCED = "@media (prefers-reduced-motion:reduce){*{animation:none!important}.smoke{opacity:.8}}"


def f(x):
    return ("%.1f" % x).rstrip("0").rstrip(".")


def svg(label, css, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" '
            'role="img" aria-label="' + label + '">\n<style>' + BASE_CSS + css + REDUCED + "</style>\n" + body + "</svg>\n")


def sky(seed, moon=(1330, 170), stars=90, top=560):
    """Ciel de nuit : aplat, lueur violette qui monte de l'horizon (la
    pollution lumineuse, forcément), étoiles dont quelques-unes scintillent,
    croissant de lune dans son halo."""
    rnd = random.Random(seed)
    out = ['<defs><linearGradient id="hz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s" stop-opacity="0"/>'
           '<stop offset="1" stop-color="%s" stop-opacity=".16"/></linearGradient></defs>' % (VIOLET, VIOLET),
           '<rect width="1600" height="1000" fill="%s"/><rect y="330" width="1600" height="510" fill="url(#hz)"/>' % BG,
           '<g fill="#4A4266">']
    for _ in range(stars):
        out.append('<circle cx="%d" cy="%d" r="%s"/>' % (rnd.randint(0, 1600), rnd.randint(20, top), rnd.choice(["1", "1", "1.4", "1.8"])))
    out.append('</g><g fill="#8279A6">')
    for i in range(9):
        out.append('<circle class="tw" style="animation-delay:-%ss" cx="%d" cy="%d" r="1.8"/>' % (f(rnd.random() * 5), rnd.randint(0, 1600), rnd.randint(20, top - 120)))
    out.append("</g>")
    if moon:
        x, y = moon
        out.append('<circle cx="%d" cy="%d" r="78" fill="%s" opacity=".035"/><circle cx="%d" cy="%d" r="56" fill="%s" opacity=".04"/>'
                   '<circle cx="%d" cy="%d" r="40" fill="#2B2540"/><circle cx="%d" cy="%d" r="38" fill="%s"/>'
                   % (x, y, VIOLET, x, y, VIOLET, x, y, x + 15, y - 9, BG))
    return "\n".join(out)


def hills(y1=700, y2=770):
    return ('<path d="M0 %d C 180 %d 340 %d 520 %d C 700 %d 860 %d 1040 %d C 1220 %d 1400 %d 1600 %d V1000 H0 Z" fill="%s"/>\n'
            '<path d="M0 %d C 220 %d 420 %d 600 %d C 820 %d 1000 %d 1200 %d C 1380 %d 1500 %d 1600 %d V1000 H0 Z" fill="%s"/>'
            % (y1, y1 - 40, y1 - 10, y1 - 32, y1 - 54, y1 - 16, y1 - 38, y1 - 60, y1 - 24, y1 - 50, HILL,
               y2, y2 - 30, y2 - 10, y2 - 22, y2 - 36, y2 - 10, y2 - 26, y2 - 40, y2 - 20, y2 - 28, HILL))


def ground(y=830):
    return '<rect y="%d" width="1600" height="%d" fill="%s"/>\n<rect y="%d" width="1600" height="2" fill="%s"/>' % (y, 1000 - y, GROUND, y, HILL)


def puff(x, y, r, delay, dur=31, color=None):
    c = color or SMOKE[int(abs(delay)) % 3]
    return ('<g transform="translate(%s %s)"><g class="smoke" style="animation-duration:%ss;animation-delay:%ss">'
            '<circle r="%s" fill="%s"/><circle cx="%s" cy="%s" r="%s" fill="%s"/><circle cx="%s" cy="%s" r="%s" fill="%s"/>'
            '<circle cx="%s" cy="%s" r="%s" fill="%s"/></g></g>'
            % (f(x), f(y), dur, f(delay), f(r), c, f(r * .9), f(-r * .36), f(r * .77), c, f(-r * .68), f(-r * .27), f(r * .68), c,
               f(r * .27), f(-r * .9), f(r * .64), c))


def plume(x, y, r, n=6, dur=31):
    return "".join(puff(x, y, r, -dur * i / n, dur) for i in range(n))


def windows(x0, y0, cols, rows, dx, dy, seed, w=16, h=10, p=.6):
    rnd = random.Random(seed)
    out = []
    for c in range(cols):
        for r in range(rows):
            if rnd.random() < p:
                warm = rnd.random() < .22
                out.append('<rect x="%s" y="%s" width="%d" height="%d" fill="%s" opacity="%s"/>'
                           % (f(x0 + c * dx), f(y0 + r * dy), w, h, WHITE if warm else VIOLET, ".3" if warm else ".55"))
    return "".join(out)


def beacon(x, y, delay=0, r=2.2, color=RED):
    return '<circle cx="%s" cy="%s" r="%s" fill="%s" class="blink" style="animation-delay:%ss"/>' % (f(x), f(y), r, color, f(delay))


def pylon(x, top, base=830, w=18):
    return ('<path d="M%s %s L%s %s L%s %s M%s %s L%s %s M%s %s L%s %s M%s %s L%s %s" stroke="#2E2740" stroke-width="3" fill="none"/>'
            % (f(x - w), base, f(x), top, f(x + w), base, f(x - w * .67), base - 70, f(x + w * .67), base - 70,
               f(x - w * .44), base - 120, f(x + w * .44), base - 120, f(x - w), top + 28, f(x + w), top + 28))


# ============================================================ 1. plateforme
def oil_rig():
    css = """
.flame{animation:flick 1.3s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
@keyframes flick{0%{transform:scale(1,1)}40%{transform:scale(.9,1.12)}100%{transform:scale(1.08,.92)}}
.glow{animation:glow 1.3s ease-in-out infinite alternate}
@keyframes glow{from{opacity:.06}to{opacity:.14}}
.swell{animation:swell 9s ease-in-out infinite alternate}
@keyframes swell{from{transform:translateX(-30px)}to{transform:translateX(30px)}}
.heli{animation:heli 46s linear infinite}
@keyframes heli{0%{transform:translate(1700px,120px)}100%{transform:translate(-200px,60px)}}
"""
    b = [sky(11, moon=(240, 150))]
    # hélicoptère de relève
    b.append('<g class="heli"><g transform="translate(0 200)"><ellipse cx="0" cy="0" rx="26" ry="9" fill="#3A3252"/>'
             '<rect x="18" y="-3" width="40" height="4" fill="#3A3252"/><rect x="-34" y="-14" width="68" height="2" fill="#3A3252"/>'
             + beacon(-20, 2, 0, 1.6) + "</g></g>")
    # tanker à l'horizon
    b.append('<path d="M120 752 L420 752 L400 772 L140 772 Z" fill="%s"/><rect x="330" y="728" width="46" height="24" fill="%s"/>'
             '<rect x="340" y="712" width="10" height="16" fill="%s"/>%s%s' % (MASS3, MASS3, MASS3,
             windows(334, 734, 3, 1, 13, 10, 3, 8, 5, 1), beacon(345, 710, .8, 1.6)))
    # mer
    b.append('<rect y="760" width="1600" height="240" fill="#0B0911"/>')
    b.append('<g class="swell" stroke="%s" stroke-width="2" fill="none">' % HILL +
             "".join('<path d="M%d %d h%d"/>' % (x, y, l) for x, y, l in
                     [(40, 800, 160), (330, 820, 220), (700, 796, 120), (980, 845, 240), (1350, 808, 160), (160, 880, 260),
                      (620, 900, 180), (1180, 930, 300), (420, 960, 140), (1480, 890, 100)]) + "</g>")
    # reflet de la torchère
    b.append('<ellipse class="glow" cx="1400" cy="828" rx="80" ry="10" fill="%s"/>' % FLAME)
    # pieds et pont
    for x in (930, 1010, 1150, 1230):
        b.append('<rect x="%d" y="640" width="22" height="200" fill="%s"/>' % (x, MASS2))
        b.append('<path d="M%d 700 L%d 760 M%d 760 L%d 700" stroke="%s" stroke-width="3"/>' % (x + 22, x + 58, x + 22, x + 58, TRIM) if x in (930, 1150) else "")
    b.append('<rect x="900" y="610" width="370" height="34" fill="%s"/><rect x="900" y="610" width="370" height="6" fill="%s"/>' % (MASS, EDGE))
    # modules d'habitation
    b.append('<rect x="930" y="540" width="130" height="70" fill="%s"/>%s' % (MASS2, windows(942, 552, 6, 4, 20, 14, 5, 12, 7, .55)))
    b.append('<rect x="1070" y="566" width="90" height="44" fill="%s"/>%s' % (MASS3, windows(1080, 576, 4, 2, 20, 14, 6, 12, 7, .5)))
    # hélipont
    b.append('<rect x="870" y="532" width="80" height="8" fill="%s"/><ellipse cx="910" cy="532" rx="40" ry="5" fill="%s"/>' % (EDGE, MASS))
    # derrick
    b.append('<path d="M1170 610 L1205 330 L1240 610 Z" fill="none" stroke="%s" stroke-width="5"/>' % MASS)
    b.append('<path d="M1178 560 L1232 520 M1232 560 L1178 520 M1184 480 L1226 440 M1226 480 L1184 440 M1190 400 L1220 370 M1220 400 L1190 370" stroke="%s" stroke-width="3"/>' % MASS)
    b.append(beacon(1205, 326, 0) + beacon(1172, 606, 1.3, 1.8))
    # grue
    b.append('<path d="M1100 566 L1100 500 L1010 430" stroke="%s" stroke-width="6" fill="none"/><path d="M1010 430 L1010 470" stroke="%s" stroke-width="1.5"/>' % (MASS, TRIM))
    # bras de torchère + flamme + fumée noire
    b.append('<path d="M1260 612 L1400 488" stroke="%s" stroke-width="8"/><path d="M1270 600 L1300 590 M1300 590 L1330 560 M1330 560 L1360 548 M1360 548 L1380 520" stroke="%s" stroke-width="3" fill="none"/>' % (MASS, TRIM))
    b.append('<circle class="glow" cx="1402" cy="462" r="64" fill="%s"/>' % FLAME)
    b.append(plume(1404, 410, 20, 6, 24))
    b.append('<g class="flame"><path d="M1402 488 C 1380 470 1388 440 1396 424 C 1398 440 1406 436 1404 414 C 1420 432 1428 466 1402 488 Z" fill="%s"/>'
             '<path d="M1402 486 C 1392 474 1396 458 1400 450 C 1402 460 1408 458 1407 448 C 1414 462 1414 478 1402 486 Z" fill="%s"/></g>' % (FLAME, FLAME2))
    return svg("Une plateforme pétrolière en mer, la nuit, torchère allumée", css, "\n".join(b))


# ====================================================== 2. ferme de serveurs
def datacenter():
    css = """
.fan{animation:spin 1.6s linear infinite;transform-box:fill-box;transform-origin:50% 50%}
@keyframes spin{to{transform:rotate(360deg)}}
.heat{animation:heat 6s ease-out infinite;opacity:0;transform-box:fill-box;transform-origin:50% 100%}
@keyframes heat{0%{opacity:0;transform:translateY(0) scale(.6)}25%{opacity:.5}100%{opacity:0;transform:translateY(-90px) scale(1.9)}}
.led{animation:led 1.9s steps(1) infinite}
@keyframes led{30%{opacity:.15}60%{opacity:1}}
"""
    b = [sky(22, moon=(300, 140))]
    # dunes
    b.append('<path d="M0 720 C 200 650 380 700 560 690 C 760 676 900 640 1100 670 C 1300 700 1450 650 1600 680 V1000 H0 Z" fill="%s"/>' % HILL)
    b.append('<path d="M0 780 C 260 750 480 790 700 770 C 940 748 1180 790 1400 768 C 1500 758 1560 770 1600 766 V1000 H0 Z" fill="%s"/>' % HILL2)
    # château d'eau
    b.append('<rect x="560" y="600" width="6" height="230" fill="%s"/><rect x="604" y="600" width="6" height="230" fill="%s"/>'
             '<path d="M563 700 L607 760 M607 700 L563 760" stroke="%s" stroke-width="3"/><ellipse cx="585" cy="596" rx="46" ry="12" fill="%s"/>'
             '<rect x="539" y="540" width="92" height="56" fill="%s"/><ellipse cx="585" cy="540" rx="46" ry="12" fill="%s"/>%s'
             % (MASS3, MASS3, MASS3, MASS2, MASS2, EDGE, beacon(585, 526, .5)))
    rnd = random.Random(7)
    halls = [(680, 610, 420, 220), (1120, 650, 380, 180), (820, 700, 560, 130)]
    for i, (x, y, w, h) in enumerate(halls):
        b.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/><rect x="%d" y="%d" width="%d" height="6" fill="%s"/>'
                 % (x, y, w, h, [MASS, MASS2, MASS3][i], x, y, w, EDGE))
        # voyants des baies
        leds = []
        for c in range(int(w / 26)):
            for r in range(int((h - 30) / 22)):
                if rnd.random() < .55:
                    col = VIOLET if rnd.random() < .8 else "#6FCF8E"
                    leds.append('<rect x="%d" y="%d" width="6" height="3" fill="%s" class="led" style="animation-delay:-%ss;opacity:.8"/>'
                                % (x + 14 + c * 26, y + 22 + r * 22, col, f(rnd.random() * 2)))
        b.append("".join(leds))
        # groupes froids sur le toit : caisson à ventelles, turbine dans sa
        # virole, air chaud qui s'en échappe en bouffées
        for k in range(int(w / 70)):
            cx, cy = x + 36 + k * 70, y - 20
            b.append('<rect x="%d" y="%d" width="60" height="20" rx="2" fill="%s"/><rect x="%d" y="%d" width="60" height="3" fill="%s"/>%s'
                     % (cx - 30, cy, TRIM, cx - 30, cy, EDGE,
                        "".join('<rect x="%d" y="%d" width="%d" height="1.5" fill="#1A1624"/>' % (cx + sx, cy + 7 + r * 4, 14, )
                                for sx in (-26, 12) for r in range(3))))
            b.append('<circle cx="%d" cy="%d" r="15" fill="#15111C" stroke="%s" stroke-width="2.5"/>'
                     '<g transform="translate(%d %d)"><g class="fan" style="animation-delay:-%ss"><circle r="12" fill="none"/>%s</g></g>'
                     '<circle cx="%d" cy="%d" r="3" fill="%s"/>'
                     % (cx, cy - 6, EDGE, cx, cy - 6, f(rnd.random() * 1.6),
                        "".join('<path transform="rotate(%d)" d="M0 0 C4 -3 9 -6 6 -12 C1 -11 -2 -6 0 0 Z" fill="#4A4266"/>' % a for a in (0, 120, 240)),
                        cx, cy - 6, EDGE))
            for n in range(2):
                b.append('<ellipse class="heat" style="animation-delay:-%ss" cx="%s" cy="%d" rx="9" ry="6" fill="#3A3252"/>'
                         % (f(rnd.random() * 6), f(cx + rnd.uniform(-5, 5)), cy - 26))
    # lignes haute tension qui alimentent le tout
    b.append(pylon(1520, 600) + pylon(420, 620))
    b.append('<path d="M0 640 C 150 660 300 660 420 626 M438 626 C 800 660 1200 660 1520 606 M1538 606 C 1580 610 1600 612 1600 612" stroke="#2E2740" stroke-width="1.5" fill="none"/>')
    # cactus
    for x, s in ((130, 1), (1470, .8), (330, .6)):
        b.append('<g transform="translate(%d 830) scale(%s)" fill="%s"><rect x="-8" y="-120" width="16" height="120" rx="8"/>'
                 '<rect x="-34" y="-86" width="12" height="44" rx="6"/><rect x="-34" y="-54" width="30" height="12" rx="6"/>'
                 '<rect x="22" y="-100" width="12" height="40" rx="6"/><rect x="4" y="-72" width="30" height="12" rx="6"/></g>' % (x, s, "#15111C"))
    b.append(ground(830))
    return svg("Une ferme de serveurs dans le désert, la nuit", css, "\n".join(b))


# ====================================================== 4. aéroport, jets privés
def jet(body, wing, gear=True, lit=True):
    out = [
        # dérive en T et réacteur arrière
        '<path d="M9 -5 L3 -25 L13 -25 L27 -6 Z" fill="%s"/><path d="M-3 -27 L17 -27 L20 -23.5 L1 -23.5 Z" fill="%s"/>' % (body, body),
        '<rect x="19" y="-13" width="20" height="7.5" rx="3.6" fill="%s"/><rect x="36" y="-12" width="3" height="5.5" rx="1.4" fill="#15111C"/>' % wing,
        # fuselage effilé
        '<path d="M4 -1 C10 -5 20 -6.5 34 -6.5 L78 -6.5 C89 -6.5 96 -3.5 100 0 C96 3 89 4.5 78 4.5 L20 4.5 C12 4.5 6 2.5 4 -1 Z" fill="%s"/>' % body,
        # aile en flèche et winglet
        '<path d="M42 2 L62 2 L50 8.5 L33 9.5 Z" fill="%s"/><path d="M33 9.5 L29 3 L32 3 L37 9 Z" fill="%s"/>' % (wing, wing),
    ]
    if lit:
        out.append('<path d="M85 -4.8 L93 -1.8 L85 -1.8 Z" fill="%s" opacity=".5"/>' % WHITE)
        out.append("".join('<rect x="%d" y="-4.2" width="3.2" height="2.6" rx="1.2" fill="%s" opacity=".7"/>' % (x, VIOLET) for x in (48, 54, 60, 66, 72)))
    if gear:
        out.append('<path d="M30 4 V10 M83 4 V10" stroke="%s" stroke-width="1.6"/><circle cx="30" cy="10.5" r="2.4" fill="#15111C"/>'
                   '<circle cx="83" cy="10.5" r="2" fill="#15111C"/>' % wing)
    return "".join(out)


def airport():
    css = """
.takeoff{animation:takeoff 16s cubic-bezier(.5,0,.9,.6) infinite}
@keyframes takeoff{0%{transform:translate(120px,843px) rotate(0deg)}34%{transform:translate(660px,843px) rotate(0deg)}42%{transform:translate(800px,838px) rotate(-9deg)}100%{transform:translate(1760px,330px) rotate(-17deg)}}
.radar{animation:radar 5s ease-in-out infinite;transform-box:fill-box;transform-origin:50% 100%}
@keyframes radar{0%,100%{transform:scaleX(1)}50%{transform:scaleX(-1)}}
.rabbit{animation:rabbit 1.6s steps(1) infinite;opacity:.12}
@keyframes rabbit{0%{opacity:1}12%{opacity:.12}}
.sweep{animation:sweep 4s linear infinite;transform-box:fill-box;transform-origin:0 50%}
@keyframes sweep{0%{transform:rotate(-30deg);opacity:0}20%{opacity:.08}50%{transform:rotate(30deg);opacity:0}100%{opacity:0}}
"""
    b = [sky(33, moon=(1200, 130))]
    b.append(hills(700, 760))
    # tour de contrôle : fût en béton qui s'affine, vigie vitrée évasée,
    # toit débordant, radar et balise (310 de haut, contre 420 avant)
    tx = 1380
    b.append('<path d="M%d 830 L%d 640 Q%d 622 %d 612 L%d 612 Q%d 622 %d 640 L%d 830 Z" fill="%s"/>'
             % (tx - 22, tx - 13, tx - 13, tx - 22, tx + 22, tx + 13, tx + 13, tx + 22, MASS))
    b.append('<rect x="%d" y="700" width="5" height="12" fill="%s" opacity=".4"/><rect x="%d" y="760" width="5" height="12" fill="%s" opacity=".4"/>'
             % (tx - 3, VIOLET, tx - 3, VIOLET))
    b.append('<rect x="%d" y="606" width="60" height="8" rx="2" fill="%s"/>' % (tx - 30, TRIM))
    b.append('<path d="M%d 606 L%d 574 L%d 574 L%d 606 Z" fill="%s"/>' % (tx - 34, tx - 46, tx + 46, tx + 34, MASS2))
    b.append('<path d="M%d 601 L%d 580 L%d 580 L%d 601 Z" fill="%s" opacity=".5"/>%s'
             % (tx - 33, tx - 41, tx + 41, tx + 33, VIOLET,
                "".join('<path d="M%s 580 L%s 601" stroke="%s" stroke-width="2"/>' % (f(tx + k * 13.6), f(tx + k * 11), MASS2) for k in (-2, -1, 0, 1, 2))))
    b.append('<rect x="%d" y="566" width="104" height="8" rx="2" fill="%s"/><rect x="%d" y="558" width="40" height="8" fill="%s"/>'
             % (tx - 52, EDGE, tx - 20, TRIM))
    b.append('<rect x="%d" y="524" width="2.5" height="34" fill="%s"/><g transform="translate(%d 552)"><path class="radar" d="M-13 0 Q0 -9 13 0 L11 2 Q0 -5 -11 2 Z" fill="%s"/></g>%s'
             % (tx - 1, EDGE, tx + 12, EDGE, beacon(tx, 522, 0)))
    b.append('<path class="sweep" d="M%d 590 L1600 572 L1600 606 Z" fill="%s"/>' % (tx + 46, WHITE))
    # terminal
    b.append('<rect x="820" y="720" width="480" height="110" fill="%s"/><rect x="820" y="720" width="480" height="8" fill="%s"/>%s'
             % (MASS2, EDGE, windows(836, 740, 15, 3, 30, 24, 9, 18, 12, .65)))
    # jets garés, un chauffeur par jet
    for x, sc in ((230, 1.2), (400, 1.4), (600, 1.2)):
        b.append('<g transform="translate(%d %s) scale(%s)">%s</g>%s%s'
                 % (x, f(830 - 13 * sc), sc, jet(MASS, MASS3), beacon(x + 8 * sc, 830 - 39 * sc, x / 300, 1.6),
                    beacon(x + 34 * sc, 830 - 3.5 * sc, x / 200, 1.3, WHITE)))
    # camion de kérosène
    b.append('<rect x="1460" y="800" width="70" height="24" rx="5" fill="%s"/><rect x="1530" y="806" width="26" height="18" fill="%s"/>'
             '<circle cx="1475" cy="826" r="5" fill="%s"/><circle cx="1542" cy="826" r="5" fill="%s"/>%s'
             % (MASS2, MASS, TRIM, TRIM, beacon(1543, 803, .3, 1.6, "#E2B55A")))
    b.append(ground(830))
    # piste : balisage qui court vers le seuil
    b.append('<rect y="836" width="1600" height="26" fill="#0D0B12"/>')
    b.append("".join('<rect x="%d" y="846" width="30" height="4" fill="%s" opacity=".35"/>' % (x, "#4A4266") for x in range(40, 1600, 80)))
    b.append("".join('<circle cx="%d" cy="866" r="2" fill="%s" class="rabbit" style="animation-delay:%ss"/>' % (x, WHITE, f(i * .1))
                     for i, x in enumerate(range(1560, 0, -100))))
    b.append("".join('<circle cx="%d" cy="834" r="1.6" fill="%s" opacity=".6"/>' % (x, VIOLET) for x in range(20, 1600, 60)))
    # le jet qui décolle (pour un fichier de 3 Mo)
    b.append('<g class="takeoff"><g transform="scale(1.25) translate(-50 -12)">%s%s%s</g></g>'
             % (jet("#3A3252", "#2C2540", gear=False), beacon(8, -27, 0, 1.6), beacon(34, 9, .4, 1.3, WHITE)))
    return svg("Un aéroport de jets privés, la nuit, un jet au décollage", css, "\n".join(b))


# ======================================================== 5. ski en été
def ski():
    css = """
.spray{animation:spray 2.4s linear infinite;opacity:0}
@keyframes spray{0%{opacity:.9;transform:translate(0,0)}100%{opacity:0;transform:translate(-120px,-60px)}}
.chair{animation:chair 40s linear infinite}
@keyframes chair{from{transform:translate(0,0)}to{transform:translate(900px,-420px)}}
"""
    b = [sky(44, moon=(260, 160), top=480)]
    # montagnes
    b.append('<path d="M-40 830 L380 330 L560 520 L760 250 L1080 640 L1250 420 L1640 830 Z" fill="%s"/>' % HILL2)
    b.append('<path d="M380 330 L440 402 L420 420 L396 398 L372 420 L340 378 Z M760 250 L850 360 L820 372 L786 344 L760 372 L720 334 L690 336 Z M1250 420 L1310 482 L1280 490 L1258 470 L1232 490 L1210 462 Z" fill="%s"/>' % EDGE)
    b.append('<path d="M-40 830 L300 560 L520 700 L760 520 L1000 740 L1200 600 L1640 830 Z" fill="%s"/>' % HILL)
    # la seule neige : celle des canons, sur une piste en herbe
    b.append('<path d="M620 830 C 700 720 760 620 780 540 L 840 540 C 860 640 930 740 1010 830 Z" fill="#2E2940"/>')
    # télésiège
    b.append('<path d="M380 830 L1280 410" stroke="#2E2740" stroke-width="2"/>' + pylon(560, 700, 830, 10) + pylon(880, 560, 830, 10) + pylon(1180, 420, 830, 10))
    for i in range(6):
        b.append('<g class="chair" style="animation-delay:-%ss"><g transform="translate(380 830)"><path d="M0 0 v14 h12 v-6" stroke="%s" stroke-width="3" fill="none"/></g></g>' % (f(i * 40 / 6), TRIM))
    # canons à neige
    rnd = random.Random(5)
    for x, y in ((700, 760), (820, 640), (960, 780)):
        b.append('<g transform="translate(%d %d)"><rect x="-3" y="-40" width="6" height="40" fill="%s"/><path d="M-4 -44 L-40 -58 L-40 -44 L-4 -36 Z" fill="%s"/>%s</g>'
                 % (x, y, MASS, EDGE, beacon(0, -36, x / 500, 1.6, "#E2B55A")))
        b.append("".join('<circle class="spray" style="animation-delay:-%ss" cx="%d" cy="%d" r="%s" fill="%s"/>'
                         % (f(rnd.random() * 2.4), x - 42 + rnd.randint(-4, 4), y - 52 + rnd.randint(-6, 6), rnd.choice(["1.5", "2", "2.5"]), WHITE)
                         for _ in range(14)))
    # chalet, chauffé à fond
    b.append('<path d="M1320 830 V740 L1390 690 L1460 740 V830 Z" fill="%s"/><rect x="1420" y="690" width="14" height="30" fill="%s"/>%s%s'
             % (MASS, MASS2, windows(1338, 756, 3, 2, 34, 28, 4, 18, 14, .9), plume(1427, 690, 12, 5, 26)))
    b.append(ground(830))
    return svg("Une station de ski en plein été, canons à neige allumés", css, "\n".join(b))


# ========================================================== 6. autoroute
def highway():
    css = """
.lane-a{animation:lanea 50s linear infinite}
@keyframes lanea{from{transform:translateX(-400px)}to{transform:translateX(400px)}}
.lane-b{animation:laneb 38s linear infinite}
@keyframes laneb{from{transform:translateX(400px)}to{transform:translateX(-400px)}}
.board{animation:board 6s steps(1) infinite}
@keyframes board{80%{opacity:.85}83%{opacity:.3}86%{opacity:.85}}
"""
    b = [sky(55, moon=None, stars=60, top=400)]
    # ville au loin, tout allumé
    rnd = random.Random(9)
    x = 0
    while x < 1600:
        w, h = rnd.randint(40, 90), rnd.randint(80, 260)
        b.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>' % (x, 700 - h, w, h + 20, HILL2))
        b.append(windows(x + 6, 710 - h, int((w - 8) / 14), int(h / 18), 14, 18, x, 6, 6, .45))
        x += w + rnd.randint(0, 14)
    b.append('<rect y="700" width="1600" height="300" fill="%s"/>' % HILL)
    # panneau publicitaire : WeshTransfer, forcément. En bas à droite, au bord
    # de la voie rapide : c'est la seule zone que le grand titre de l'accueil
    # ne recouvre sur aucun écran (téléphone, tablette, ordinateur ; mesuré).
    # Panneau éclairé, clair, logo sombre : jamais confondu avec le texte
    # violet posé par-dessus le décor.
    b.append('<rect x="1214" y="712" width="6" height="32" fill="%s"/><rect x="1158" y="652" width="120" height="64" rx="3" fill="%s"/>'
             '<g class="board"><rect x="1162" y="656" width="112" height="56" rx="2" fill="#EDE7DC"/>'
             '<g transform="translate(1180 660) scale(.42)"><path d="M2.87 21.1A7 7 0 0 1 9.54 12L22.73 12A7 7 0 0 1 29.46 17.07L39.76 52.91A4 4 0 0 0 47.45 52.9L57.65 17.08A7 7 0 0 1 64.38 12L77.01 12A7 7 0 0 1 83.75 17.08L94.57 55.1A3.42 3.42 0 0 0 97.86 57.59L97.86 112L91.95 112A7.22 7.22 0 0 1 85.01 106.76L74.5 69.85A4 4 0 0 0 66.8 69.85L56.87 104.74A10 10 0 0 1 47.25 112L38.83 112A10 10 0 0 1 29.3 105Z" fill="#2A2340"/>'
             '<path d="M98.54 20.92A7 7 0 0 1 105.27 12L155.9 12A2.1 2.1 0 0 0 158 9.9L158 5.76A2.52 2.52 0 0 1 162.23 3.91L181.61 21.8A3 3 0 0 1 181.61 26.2L162.23 44.09A2.52 2.52 0 0 1 158 42.24L158 38.1A2.1 2.1 0 0 0 155.9 36L141.07 36A10 10 0 0 0 131.54 43L111.52 106.53A7.82 7.82 0 0 1 104.07 112L97.86 112L97.86 57.59A3.42 3.42 0 0 0 101.15 55.11L103.63 46.55A14 14 0 0 0 103.64 38.83Z" fill="#7B5CE6"/></g></g>'
             '<rect x="1162" y="656" width="112" height="6" fill="#FFFFFF" opacity=".35"/>'
             % (MASS, MASS))
    # viaduc
    b.append('<rect y="742" width="1600" height="30" fill="%s"/><rect y="742" width="1600" height="4" fill="%s"/>' % (MASS, EDGE))
    b.append("".join('<rect x="%d" y="772" width="30" height="60" fill="%s"/>' % (x, MASS2) for x in range(80, 1600, 260)))
    # lampadaires
    b.append("".join('<path d="M%d 742 V660 h24" stroke="%s" stroke-width="3" fill="none"/><rect x="%d" y="658" width="12" height="4" fill="%s" opacity=".7"/>'
                     % (x, TRIM, x + 18, "#E2B55A") for x in range(40, 1600, 200) if not 1140 <= x <= 1290))
    # bouchon : phares d'un côté, feux arrière de l'autre
    a = "".join('<rect x="%d" y="728" width="44" height="14" rx="4" fill="%s"/><circle cx="%d" cy="735" r="2.2" fill="%s"/><circle cx="%d" cy="735" r="2.2" fill="%s"/>'
                % (x, MASS3, x + 44, WHITE, x + 44, WHITE) for x in range(-380, 1980, 70))
    bb = "".join('<rect x="%d" y="716" width="44" height="14" rx="4" fill="%s"/><circle cx="%d" cy="723" r="2" fill="%s"/>'
                 % (x, MASS2, x, RED) for x in range(-380, 1980, 64))
    b.append('<g class="lane-b">%s</g><g class="lane-a">%s</g>' % (bb, a))
    b.append(ground(830))
    return svg("Une autoroute de SUV embouteillée, la nuit", css, "\n".join(b))


# ============================================================ 7. croisière
def cruise():
    css = """
.swell{animation:swell 9s ease-in-out infinite alternate}
@keyframes swell{from{transform:translateX(-30px)}to{transform:translateX(30px)}}
.shimmer{animation:shimmer 3.4s ease-in-out infinite alternate}
@keyframes shimmer{from{opacity:.05}to{opacity:.16}}
"""
    b = [sky(66, moon=(300, 150))]
    # iceberg, de moins en moins gros
    b.append('<path d="M120 764 L168 700 L196 724 L232 660 L262 706 L300 764 Z" fill="%s"/><path d="M232 660 L262 706 L240 722 L222 700 Z" fill="%s" opacity=".7"/>'
             % (HILL2, EDGE))
    b.append('<rect y="760" width="1600" height="240" fill="#0B0911"/>')
    # coque, proue à droite
    b.append('<path d="M640 728 L1456 728 L1508 714 L1446 796 L694 796 Q650 786 640 728 Z" fill="%s"/>'
             '<path d="M640 728 L1456 728 L1508 714 L1505 720 L1456 734 L641 734 Z" fill="%s"/>' % (MASS, EDGE))
    b.append("".join('<circle cx="%d" cy="762" r="3" fill="%s" opacity=".5"/>' % (x, VIOLET) for x in range(700, 1420, 26)))
    # canots de sauvetage (pas assez pour tout le monde)
    b.append("".join('<rect x="%d" y="716" width="30" height="9" rx="4.5" fill="%s" opacity=".6"/>' % (x, FLAME) for x in range(720, 1300, 64)))
    # ponts empilés, cabines toutes allumées
    tiers = [(676, 690, 760, 38), (700, 654, 700, 36), (736, 620, 610, 34), (780, 588, 500, 32), (840, 560, 360, 28)]
    for i, (x, y, w, h) in enumerate(tiers):
        b.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/><rect x="%d" y="%d" width="%d" height="3" fill="%s"/>%s'
                 % (x, y, w, h, MASS2 if i % 2 == 0 else MASS3, x, y, w, EDGE,
                    windows(x + 12, y + 10, int((w - 20) / 17), 2, 17, 12, 60 + i, 9, 6, .78)))
    # passerelle de commandement
    b.append('<path d="M1150 588 L1150 558 L1262 558 L1284 588 Z" fill="%s"/><path d="M1158 566 L1258 566 L1270 580 L1158 580 Z" fill="%s" opacity=".55"/>'
             % (MASS, VIOLET))
    # cheminées au fioul lourd
    for x, top, w, r in ((904, 478, 62, 24), (1000, 500, 50, 18)):
        b.append('<path d="M%d 560 L%d %d L%d %d L%d 560 Z" fill="%s"/><rect x="%d" y="%d" width="%d" height="10" fill="%s" opacity=".7"/>'
                 % (x, x + 10, top, x + w - 4, top, x + w + 4, MASS, x + 9, top + 12, w - 12, VIOLET))
        b.append(plume(x + w / 2 + 2, top - 6, r, 6, 26 if r > 20 else 30))
    # toboggan aquatique, parce qu'il en faut un
    b.append('<path d="M872 560 V520 C872 496 826 496 826 520 C826 544 866 540 866 556 C866 574 810 566 800 588" fill="none" stroke="%s" stroke-width="5" opacity=".55" stroke-linecap="round"/>' % VIOLET)
    # mât et guirlandes
    b.append('<rect x="1204" y="470" width="3" height="88" fill="%s"/><rect x="1192" y="492" width="27" height="2.5" fill="%s"/>%s' % (EDGE, EDGE, beacon(1205.5, 466, 0)))
    for (x0, y0), (cx, cy), (x1, y1), n in (((1205, 474), (1380, 640), (1504, 714), 16), ((1205, 474), (1090, 520), (962, 480), 10)):
        b.append('<path d="M%d %d Q%d %d %d %d" fill="none" stroke="%s" stroke-width="1"/>' % (x0, y0, cx, cy, x1, y1, TRIM))
        for k in range(1, n):
            t = k / n
            px = (1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1
            py = (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1
            b.append('<circle class="tw" style="animation-delay:-%ss;animation-duration:2.4s" cx="%s" cy="%s" r="2" fill="%s"/>' % (f(k * .37), f(px), f(py + 2), FLAME2))
    # reflets et houle
    rnd = random.Random(12)
    b.append('<g class="shimmer">' + "".join('<rect x="%d" y="%d" width="%d" height="2" fill="%s"/>'
             % (rnd.randint(680, 1420), 806 + i * 9, rnd.randint(30, 110), VIOLET if i % 3 else FLAME2) for i in range(14)) + "</g>")
    b.append('<g class="swell" stroke="%s" stroke-width="2" fill="none">' % HILL +
             "".join('<path d="M%d %d h%d"/>' % (x, y, l) for x, y, l in
                     [(40, 800, 160), (330, 822, 220), (60, 880, 260), (520, 905, 180), (1180, 940, 300), (420, 960, 140), (1500, 850, 90)]) + "</g>")
    return svg("Un paquebot de croisière géant, la nuit, toutes cabines allumées", css, "\n".join(b))


# ====================================================== 8. tourisme spatial
def rocket():
    css = """
.lift{animation:lift 24s cubic-bezier(.7,0,.9,.45) infinite}
@keyframes lift{0%{transform:translate(0,0);opacity:0}3%{opacity:1}22%{transform:translate(0,0)}96%{opacity:1}100%{transform:translate(90px,-1150px);opacity:0}}
.flame{animation:flick .3s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 0%}
@keyframes flick{from{transform:scale(1,1)}to{transform:scale(.86,1.2)}}
.glow{animation:glow 24s ease-out infinite}
@keyframes glow{0%{opacity:0}8%{opacity:.42}40%{opacity:.3}70%,100%{opacity:0}}
.billow{animation:billow 24s ease-out infinite;transform-box:fill-box;transform-origin:50% 100%;opacity:0}
@keyframes billow{0%,6%{opacity:0;transform:translate(0,0) scale(.3)}22%{opacity:.95}70%{opacity:.85}100%{opacity:0;transform:translate(var(--dx),-46px) scale(2.9)}}
"""
    b = [sky(77, moon=(380, 150))]
    b.append(hills(716, 772))
    # hangar d'assemblage
    b.append('<rect x="700" y="610" width="190" height="220" fill="%s"/><rect x="700" y="610" width="190" height="6" fill="%s"/>'
             '<rect x="760" y="650" width="70" height="180" fill="%s"/>%s<rect x="716" y="630" width="30" height="5" fill="%s" opacity=".6"/>'
             % (MASS2, EDGE, MASS3, "".join('<rect x="%d" y="650" width="1.5" height="180" fill="%s"/>' % (x, TRIM) for x in (777, 795, 813)), VIOLET))
    b.append('<rect x="890" y="730" width="120" height="100" fill="%s"/><rect x="890" y="730" width="120" height="5" fill="%s"/>%s'
             % (MASS3, EDGE, windows(902, 748, 5, 3, 21, 22, 8, 12, 9, .6)))
    # sphères de carburant
    for x, r in ((1340, 34), (1414, 26)):
        b.append('<path d="M%d 830 L%d %d M%d 830 L%d %d" stroke="%s" stroke-width="4"/><circle cx="%d" cy="%d" r="%d" fill="%s"/>'
                 '<path d="M%d %d A%d %d 0 0 1 %d %d" fill="none" stroke="%s" stroke-width="3"/>'
                 % (x - r + 6, x - r + 12, 830 - r, x + r - 6, x + r - 12, 830 - r, TRIM, x, 826 - r - 8, r, MASS2,
                    x - r + 5, 826 - r - 12, r - 5, r - 5, x + 4, 826 - 2 * r - 3, EDGE))
    # paratonnerres
    for x in (1030, 1300):
        b.append('<path d="M%d 830 L%d 380" stroke="#2E2740" stroke-width="2.5"/>%s' % (x, x, beacon(x, 378, x / 700, 2)))
    b.append('<path d="M1030 380 Q1165 430 1300 380" stroke="#2E2740" stroke-width="1" fill="none"/>')
    # tour de lancement
    tx = 1110
    b.append('<rect x="%d" y="470" width="34" height="360" fill="none" stroke="%s" stroke-width="4"/>' % (tx, MASS))
    b.append("".join('<path d="M%d %d L%d %d M%d %d L%d %d M%d %d H%d" stroke="%s" stroke-width="2.5"/>'
                     % (tx, y, tx + 34, y + 45, tx + 34, y, tx, y + 45, tx, y + 45, tx + 34, TRIM) for y in range(470, 830, 45)))
    b.append('<rect x="%d" y="560" width="46" height="5" fill="%s"/><rect x="%d" y="700" width="46" height="5" fill="%s"/>%s'
             % (tx + 34, MASS, tx + 34, MASS, beacon(tx + 17, 466, .6)))
    # compte à rebours
    b.append('<rect x="930" y="672" width="92" height="34" rx="3" fill="#0A080E" stroke="%s" stroke-width="2"/>'
             '<text x="976" y="696" text-anchor="middle" font-family="ui-monospace,Menlo,monospace" font-size="19" font-weight="700" fill="%s" class="blink">T-00:11</text>'
             % (TRIM, RED))
    # les SUV des passagers
    for i, x in enumerate(range(470, 660, 62)):
        b.append('<rect x="%d" y="812" width="46" height="14" rx="4" fill="%s"/><rect x="%d" y="804" width="26" height="10" rx="3" fill="%s"/><circle cx="%d" cy="819" r="2" fill="%s"/>'
                 % (x, MASS3, x + 8, MASS3, x + 46, WHITE))
    b.append(ground(830))
    # pas de tir, lueur, nuage de décollage
    px = 1202
    b.append('<defs><radialGradient id="fg"><stop offset="0" stop-color="%s" stop-opacity="1"/><stop offset="1" stop-color="%s" stop-opacity="0"/></radialGradient></defs>'
             '<circle class="glow" cx="%d" cy="806" r="300" fill="url(#fg)"/>' % (FLAME, FLAME, px))
    b.append('<path d="M%d 830 L%d 816 L%d 816 L%d 830 Z" fill="%s"/>' % (px - 62, px - 46, px + 46, px + 62, MASS))
    rnd = random.Random(21)
    for i in range(16):
        dx = rnd.choice((-1, 1)) * rnd.randint(60, 330)
        r = rnd.randint(22, 40)
        c = SMOKE[i % 3]
        b.append('<g transform="translate(%d 834)"><g class="billow" style="--dx:%dpx;animation-delay:%ss">'
                 '<circle r="%d" fill="%s"/><circle cx="%s" cy="%s" r="%s" fill="%s"/><circle cx="%s" cy="%s" r="%s" fill="%s"/></g></g>'
                 % (px + rnd.randint(-24, 24), dx, f(rnd.random() * 2.2), r, c, f(r * .8), f(-r * .4), f(r * .75), c, f(-r * .7), f(-r * .3), f(r * .7), c))
    # la fusée : 11 minutes d'apesanteur, une vie d'émissions
    body = "#40375A"
    b.append('<g class="lift"><g transform="translate(%d 816) scale(1.55)">'
             '<g class="flame"><path d="M-12 0 Q0 96 12 0 Z" fill="%s"/><path d="M-6 0 Q0 54 6 0 Z" fill="%s"/>'
             '<path d="M-27 -8 Q-21 40 -15 -8 Z" fill="%s"/><path d="M15 -8 Q21 40 27 -8 Z" fill="%s"/></g>'
             '<rect x="-28" y="-128" width="13" height="120" rx="6" fill="%s"/><rect x="15" y="-128" width="13" height="120" rx="6" fill="%s"/>'
             '<path d="M-15 0 L-15 -176 Q0 -236 15 -176 L15 0 Z" fill="%s"/>'
             '<rect x="-15" y="-150" width="30" height="7" fill="%s" opacity=".75"/><rect x="-15" y="-60" width="30" height="4" fill="%s"/>'
             '<circle cx="0" cy="-170" r="4.5" fill="%s" opacity=".8"/></g></g>'
             % (px, FLAME, FLAME2, FLAME, FLAME, EDGE, EDGE, body, VIOLET, TRIM, WHITE))
    return svg("Une fusée de tourisme spatial au décollage, la nuit", css, "\n".join(b))


# ====================================================== 9. golf dans le désert
def palm(x, base, s=1.0, lean=8):
    out = ['<g transform="translate(%d %d) scale(%s)" fill="none" stroke="%s" stroke-linecap="round">' % (x, base, f(s), MASS2),
           '<path d="M0 0 Q%d -60 %d -120" stroke-width="7"/>' % (lean, lean // 2)]
    for a, l in ((-160, 54), (-125, 60), (-95, 50), (-60, 58), (-25, 56), (10, 48), (-190, 46)):
        ex, ey = math.cos(math.radians(a)) * l, math.sin(math.radians(a)) * l
        out.append('<path d="M%d -120 Q%s %s %s %s" stroke-width="5"/>' % (lean // 2, f(lean // 2 + ex * .5), f(-120 + ey * .5 - 16), f(lean // 2 + ex), f(-120 + ey + 14)))
    out.append("</g>")
    return "".join(out)


def golf():
    css = """
.arc{stroke-dasharray:3 9;animation:arc 1s linear infinite}
@keyframes arc{to{stroke-dashoffset:-24}}
.cart{animation:cart 70s linear infinite}
@keyframes cart{from{transform:translateX(-160px)}to{transform:translateX(1760px)}}
.cone{animation:cone 7s ease-in-out infinite alternate}
@keyframes cone{from{opacity:.035}to{opacity:.07}}
"""
    grass, green = "#15221C", "#1C3026"
    b = [sky(88, moon=(1290, 140))]
    b.append('<path d="M0 716 C 220 660 420 706 620 690 C 840 672 1000 650 1200 676 C 1380 700 1500 660 1600 676 V1000 H0 Z" fill="%s"/>' % HILL)
    # la ville au loin, tours climatisées
    rnd = random.Random(31)
    x = 720
    while x < 1560:
        w, h = rnd.randint(26, 54), rnd.randint(60, 190)
        b.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>%s' % (x, 720 - h, w, h + 30, HILL2, windows(x + 5, 728 - h, int((w - 6) / 10), int(h / 14), 10, 14, x, 4, 5, .4)))
        x += w + rnd.randint(4, 22)
    b.append('<path d="M1090 750 L1098 470 L1104 330 L1110 470 L1118 750 Z" fill="%s"/>%s%s' % (MASS3, windows(1100, 500, 1, 16, 8, 15, 3, 5, 6, .7), beacon(1104, 326, 0)))
    b.append('<path d="M0 772 C 260 742 480 780 700 762 C 940 742 1180 782 1400 760 C 1500 750 1560 762 1600 758 V1000 H0 Z" fill="%s"/>' % HILL2)
    # projecteurs : on joue de nuit, il fait trop chaud le jour
    for x, d in ((640, 1), (1530, -1)):
        b.append('<path class="cone" d="M%d 598 L%d 830 L%d 830 Z" fill="%s"/>' % (x + d * 14, x + d * 60, x + d * 420, WHITE))
        b.append('<rect x="%d" y="596" width="4" height="234" fill="%s"/><rect x="%d" y="590" width="34" height="10" rx="2" fill="%s"/>%s'
                 % (x - 2, MASS, x - 17, EDGE, "".join('<rect x="%d" y="593" width="6" height="4" fill="%s" opacity=".9"/>' % (x - 14 + k * 8, WHITE) for k in range(4))))
    # le parcours : gazon anglais, 45 degrés à l'ombre
    b.append('<path d="M0 806 C 300 780 600 798 900 786 C 1200 774 1400 796 1600 784 V830 H0 Z" fill="%s"/>' % grass)
    b.append('<ellipse cx="1060" cy="806" rx="250" ry="15" fill="%s"/>' % green)
    b.append('<ellipse cx="800" cy="814" rx="70" ry="7" fill="%s"/>' % HILL2)
    # lac artificiel et sa fontaine
    b.append('<ellipse cx="1380" cy="812" rx="120" ry="10" fill="#0B0911"/><rect x="1330" y="810" width="70" height="1.5" fill="%s" opacity=".3"/>' % VIOLET)
    b.append('<g fill="none" stroke="%s" stroke-width="2" opacity=".6"><path class="arc" d="M1380 810 Q1380 730 1362 808"/><path class="arc" d="M1380 810 Q1380 730 1398 808"/><path class="arc" d="M1380 810 V746"/></g>' % WHITE)
    # drapeau
    b.append('<rect x="1099" y="736" width="2" height="70" fill="%s" opacity=".7"/><path d="M1101 736 L1128 745 L1101 754 Z" fill="%s"/><ellipse cx="1100" cy="806" rx="6" ry="2" fill="#0A080E"/>' % (WHITE, RED))
    # arrosage automatique, en continu
    for x in (720, 930, 1220, 1480):
        b.append('<rect x="%d" y="798" width="4" height="8" fill="%s"/><g fill="none" stroke="%s" stroke-width="2" opacity=".55">'
                 '<path class="arc" d="M%d 798 Q%d 742 %d 800"/><path class="arc" d="M%d 798 Q%d 742 %d 800"/></g>'
                 % (x - 2, EDGE, WHITE, x, x - 44, x - 92, x, x + 44, x + 92))
    b.append(palm(560, 812, 1.15) + palm(860, 800, .8, -8) + palm(1560, 806, 1.0, -10) + palm(1250, 796, .7))
    # voiturette
    b.append('<g class="cart"><g transform="translate(0 800)"><rect x="0" y="0" width="40" height="12" rx="3" fill="%s"/><rect x="6" y="-16" width="26" height="3" fill="%s"/>'
             '<path d="M8 -14 V0 M30 -14 V0" stroke="%s" stroke-width="2"/><circle cx="9" cy="14" r="4" fill="#0A080E"/><circle cx="31" cy="14" r="4" fill="#0A080E"/>'
             '<circle cx="40" cy="5" r="2" fill="%s"/></g></g>' % (MASS, EDGE, EDGE, WHITE))
    b.append(ground(830))
    return svg("Un golf tout vert en plein désert, arrosé la nuit", css, "\n".join(b))


SCENES = {
    "plateforme.svg": oil_rig,
    "serveurs.svg": datacenter,
    "aeroport.svg": airport,
    "ski.svg": ski,
    "autoroute.svg": highway,
    "croisiere.svg": cruise,
    "fusee.svg": rocket,
    "golf.svg": golf,
}


# ================================================================ mode THC
# Direction parallèle : même dessin en aplats, palette verte, la lumière
# violette de la marque devient celle des lampes de culture. Les décors
# sortent dans img/scenes/thc-*.svg.
LAMP, PINK = "#B05CFF", "#E26BD8"
THC_PALETTE = dict(BG="#0B0F0C", HILL="#121915", HILL2="#19221C", MASS="#233028", MASS2="#1D2922", MASS3="#19241E",
                   EDGE="#34463B", TRIM="#263229", SMOKE=["#3F5747", "#37503F", "#48614F"], VIOLET="#5FD068",
                   WHITE="#ECF2EC", RED="#E8674A", FLAME="#E8904A", FLAME2="#F2C46B", GROUND="#070A08")


def weed(x, base, s=1.0, col="#2F9E4F", tip="#5FD068"):
    leaf = "M0 -26 C-6 -38 -26 -46 -38 -38 C-26 -34 -12 -32 0 -26Z"
    out = ['<g transform="translate(%s %s) scale(%s)"><path d="M0 0 V-46" stroke="%s" stroke-width="3"/>' % (f(x), f(base), f(s), col)]
    for tr in ("", "scale(-1 1)", "translate(0 -11) rotate(-18)", "translate(0 -11) scale(-1 1) rotate(-18)",
               "translate(0 -21) scale(.8) rotate(-34)", "translate(0 -21) scale(-.8 .8) rotate(-34)"):
        out.append('<path transform="%s" d="%s" fill="%s"/>' % (tr, leaf, col))
    out.append('<path d="M0 -46 C-4 -58 0 -66 0 -70 C0 -66 4 -58 0 -46Z" fill="%s"/></g>' % tip)
    return "".join(out)


def cone_defs():
    return ('<defs><linearGradient id="lc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s" stop-opacity=".34"/><stop offset="1" stop-color="%s" stop-opacity="0"/></linearGradient>'
            '<linearGradient id="pc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="%s" stop-opacity=".3"/><stop offset="1" stop-color="%s" stop-opacity="0"/></linearGradient></defs>'
            % (LAMP, LAMP, PINK, PINK))


BREATH = """
.breath{animation:breath 6s ease-in-out infinite alternate}
@keyframes breath{from{opacity:.65}to{opacity:1}}
"""


def thc_serre():
    b = [sky(101, moon=(330, 150)), cone_defs(), hills(716, 772)]
    # trois tentes de culture, lampes allumées 18 heures sur 24
    for i, (x, w, h) in enumerate(((640, 300, 250), (960, 360, 300), (1340, 220, 220))):
        y = 830 - h
        g = "lc" if i != 1 else "pc"
        b.append('<rect x="%d" y="%d" width="%d" height="%d" rx="6" fill="%s" stroke="%s" stroke-width="3"/>' % (x, y, w, h, HILL, TRIM))
        b.append('<g class="breath" style="animation-delay:-%ss"><path d="M%d %d H%d L%d 830 H%d Z" fill="url(#%s)"/>'
                 '<rect x="%d" y="%d" width="%d" height="13" rx="3" fill="%s"/></g>'
                 % (i * 2, x + 16, y + 30, x + w - 16, x + w - 4, x + 4, g, x + 16, y + 17, w - 32, LAMP if i != 1 else PINK))
        b.append('<path d="M%d %d V%d M%d %d V%d" stroke="%s" stroke-width="2"/>' % (x + 40, y, y + 17, x + w - 40, y, y + 17, TRIM))
        n = int((w - 40) / 52)
        for k in range(n):
            px = x + 34 + k * (w - 68) / max(1, n - 1)
            b.append('<rect x="%s" y="820" width="36" height="10" rx="2" fill="%s"/>' % (f(px - 18), MASS))
            b.append(weed(px, 820, 1.25 if i == 1 else 1.05))
    # extracteur : l'odeur part chez les voisins
    b.append('<rect x="930" y="430" width="34" height="100" fill="%s"/><rect x="924" y="424" width="46" height="10" rx="2" fill="%s"/>%s' % (MASS, EDGE, plume(947, 416, 22, 6, 28)))
    b.append("".join('<circle class="tw" style="animation-delay:-%ss;animation-duration:2.6s" cx="%d" cy="556" r="3" fill="%s"/>' % (f(k * .7), 1250 + k * 14, VIOLET) for k in range(3)))
    b.append(ground(830))
    return svg("Une serre de culture, lampes violettes allumées, la nuit", BREATH, "\n".join(b))


def thc_toit():
    css = """
.ember{animation:ember 4s ease-in-out infinite}
@keyframes ember{0%,100%{opacity:.5}40%{opacity:1}}
"""
    b = [sky(102, moon=(1180, 190), top=520)]
    b.append('<circle cx="1180" cy="190" r="120" fill="%s" opacity=".03"/>' % VIOLET)
    rnd = random.Random(19)
    x = 0
    while x < 1600:
        w, h = rnd.randint(50, 110), rnd.randint(60, 240)
        b.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/>%s' % (x, 760 - h, w, h + 80, HILL2, windows(x + 7, 772 - h, int((w - 8) / 15), int(h / 20), 15, 20, x + 3, 6, 7, .35)))
        x += w + rnd.randint(0, 18)
    # le toit, au premier plan
    b.append('<rect x="560" y="700" width="1040" height="130" fill="%s"/><rect x="560" y="700" width="1040" height="8" fill="%s"/>' % (MASS2, EDGE))
    b.append("".join('<rect x="%d" y="676" width="4" height="26" fill="%s"/>' % (x, EDGE) for x in range(570, 1600, 90)) + '<rect x="560" y="674" width="1040" height="4" fill="%s"/>' % EDGE)
    # réservoir d'eau et antenne
    b.append('<path d="M660 700 L672 620 M740 700 L728 620 M672 660 L728 660" stroke="%s" stroke-width="4"/><rect x="654" y="548" width="92" height="76" rx="4" fill="%s"/>'
             '<path d="M650 548 L700 520 L750 548 Z" fill="%s"/>' % (TRIM, MASS, EDGE))
    b.append('<path d="M1500 700 V560 M1480 590 H1520 M1486 612 H1514" stroke="%s" stroke-width="3"/>%s' % (TRIM, beacon(1500, 556, .4)))
    # canapé, table basse, guirlande
    b.append('<rect x="930" y="640" width="220" height="48" rx="12" fill="%s"/><rect x="914" y="622" width="34" height="68" rx="12" fill="%s"/><rect x="1132" y="622" width="34" height="68" rx="12" fill="%s"/>'
             '<rect x="946" y="606" width="188" height="46" rx="14" fill="%s"/><rect x="936" y="688" width="8" height="12" fill="%s"/><rect x="1136" y="688" width="8" height="12" fill="%s"/>'
             % (MASS, MASS, MASS, MASS3, TRIM, TRIM))
    b.append('<rect x="1210" y="672" width="110" height="8" rx="3" fill="%s"/><rect x="1222" y="680" width="6" height="20" fill="%s"/><rect x="1302" y="680" width="6" height="20" fill="%s"/>' % (EDGE, TRIM, TRIM))
    b.append('<ellipse cx="1262" cy="670" rx="20" ry="5" fill="%s"/><path d="M1258 668 L1318 644" stroke="%s" stroke-width="9" stroke-linecap="round"/>'
             '<circle class="ember" cx="1320" cy="643" r="6" fill="%s"/><circle class="ember" cx="1320" cy="643" r="26" fill="%s" opacity=".18"/>%s'
             % (TRIM, WHITE, FLAME, FLAME, plume(1324, 628, 16, 6, 22)))
    for k in range(1, 15):
        t = k / 15
        px, py = 700 + t * 800, 520 + 150 * (4 * (t - .5) ** 2) * -1 + 150 + 40 * t
        b.append('<circle class="tw" style="animation-delay:-%ss;animation-duration:3s" cx="%s" cy="%s" r="3" fill="%s"/>' % (f(k * .4), f(px), f(py - 90), FLAME2 if k % 2 else VIOLET))
    b.append(ground(830))
    return svg("Un toit en ville, la nuit, un canapé et une fumée qui monte", css, "\n".join(b))


def thc_champ():
    css = """
.sway{animation:sway 5s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 100%}
@keyframes sway{from{transform:rotate(-2.5deg)}to{transform:rotate(2.5deg)}}
.tractor{animation:tractor 90s linear infinite}
@keyframes tractor{from{transform:translateX(1700px)}to{transform:translateX(-200px)}}
"""
    b = [sky(103, moon=None, top=500)]
    b.append('<circle cx="1120" cy="470" r="230" fill="%s" opacity=".035"/><circle cx="1120" cy="470" r="170" fill="#1B2A20"/>'
             '<circle cx="1070" cy="420" r="26" fill="%s" opacity=".5"/><circle cx="1180" cy="520" r="38" fill="%s" opacity=".4"/><circle cx="1150" cy="400" r="14" fill="%s" opacity=".5"/>'
             % (VIOLET, HILL2, HILL2, HILL2))
    b.append(hills(690, 740))
    # grange
    b.append('<path d="M360 760 V690 L420 650 L480 690 V760 Z" fill="%s"/>%s<rect x="480" y="712" width="90" height="48" fill="%s"/>' % (MASS, windows(396, 708, 2, 1, 34, 20, 4, 18, 14, 1), MASS3))
    # tracteur, pas pressé
    b.append('<g class="tractor"><g transform="translate(0 742)"><rect x="0" y="-22" width="44" height="18" rx="3" fill="%s"/><rect x="22" y="-40" width="22" height="20" rx="2" fill="%s"/>'
             '<circle cx="34" cy="0" r="12" fill="#070A08"/><circle cx="6" cy="4" r="8" fill="#070A08"/><circle cx="-2" cy="-14" r="2.4" fill="%s"/></g></g>' % (MASS, MASS2, WHITE))
    # rangs de chanvre, du fond vers nous
    rnd = random.Random(23)
    for row, (y, sc, col, step) in enumerate(((756, .5, "#1E5A34", 46), (780, .8, "#23703D", 64), (806, 1.15, "#2A8A48", 88), (836, 1.7, "#2F9E4F", 124))):
        for k, x in enumerate(range(-20 + row * 17, 1640, step)):
            b.append('<g class="sway" style="animation-delay:-%ss">%s</g>' % (f(rnd.random() * 5), weed(x, y, sc, col, VIOLET if row > 1 else col)))
    b.append('<rect y="836" width="1600" height="164" fill="%s"/>' % GROUND)
    return svg("Un champ de chanvre sous une lune énorme", css, "\n".join(b))


def thc_snack():
    css = """
.neon{animation:neon 5s steps(1) infinite}
@keyframes neon{0%,100%{opacity:1}71%{opacity:.35}73%{opacity:1}76%{opacity:.5}78%{opacity:1}}
.lane-a{animation:lanea 60s linear infinite}
@keyframes lanea{from{transform:translateX(-400px)}to{transform:translateX(400px)}}
"""
    b = [sky(104, moon=(280, 160)), cone_defs(), hills(712, 770)]
    # le snack, ouvert 24 h : la fringale n'a pas d'horaires
    b.append('<rect x="820" y="610" width="520" height="220" fill="%s"/><rect x="800" y="596" width="560" height="18" rx="3" fill="%s"/>' % (MASS2, EDGE))
    b.append('<rect x="850" y="676" width="330" height="96" rx="4" fill="%s" opacity=".5"/><path d="M850 772 H1180 L1230 830 H800 Z" fill="url(#lc)"/>' % WHITE)
    b.append("".join('<rect x="%d" y="676" width="4" height="96" fill="%s"/>' % (x, MASS2) for x in (930, 1014, 1098)))
    b.append('<path d="M836 676 H1194 L1210 650 H820 Z" fill="%s"/>%s' % (LAMP, "".join('<path d="M%d 650 L%d 676" stroke="%s" stroke-width="10" opacity=".35"/>' % (x - 6, x, BG) for x in range(860, 1200, 44))))
    b.append('<rect x="1230" y="700" width="70" height="130" fill="%s"/><rect x="1240" y="712" width="50" height="50" fill="%s" opacity=".35"/>' % (MASS3, VIOLET))
    # enseigne
    b.append('<rect x="900" y="500" width="360" height="92" rx="8" fill="#070A08" stroke="%s" stroke-width="3"/><path d="M960 592 V598 M1200 592 V598" stroke="%s" stroke-width="6"/>' % (TRIM, TRIM))
    b.append('<g class="neon"><text x="1080" y="562" text-anchor="middle" font-family="Arial Black,Helvetica,Arial,sans-serif" font-weight="900" font-size="54" fill="%s" letter-spacing="2">SNACK 24H</text>'
             '<rect x="916" y="576" width="328" height="4" rx="2" fill="%s"/></g>' % (VIOLET, PINK))
    # cheminée de la friteuse
    b.append('<rect x="1290" y="552" width="22" height="48" fill="%s"/>%s' % (MASS, plume(1301, 546, 15, 6, 26)))
    # lampadaires et file de voitures
    b.append("".join('<path d="M%d 830 V690 h26" stroke="%s" stroke-width="4" fill="none"/><rect x="%d" y="688" width="14" height="5" fill="%s" opacity=".8"/>' % (x, TRIM, x + 20, FLAME2) for x in (620, 1440)))
    cars = "".join('<rect x="%d" y="812" width="50" height="15" rx="4" fill="%s"/><rect x="%d" y="802" width="28" height="12" rx="4" fill="%s"/><circle cx="%d" cy="820" r="2.2" fill="%s"/>'
                   % (x, MASS3, x + 10, MASS3, x + 50, WHITE) for x in range(-380, 780, 78))
    b.append('<g class="lane-a">%s</g>' % cars)
    b.append(ground(830))
    return svg("Un snack ouvert 24 heures, enseigne au néon, file de voitures", css, "\n".join(b))


def thc_festival():
    css = """
.beam{animation:beam 7s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 0%}
@keyframes beam{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}
.bounce{animation:bounce .9s ease-in-out infinite alternate}
@keyframes bounce{from{transform:translateY(0)}to{transform:translateY(-7px)}}
"""
    b = [sky(105, moon=(300, 140)), cone_defs(), hills(716, 772)]
    # la scène : pont de lumières, enceintes empilées
    b.append('<rect x="760" y="470" width="14" height="330" fill="%s"/><rect x="1386" y="470" width="14" height="330" fill="%s"/>' % (MASS, MASS))
    b.append('<rect x="740" y="446" width="680" height="30" fill="none" stroke="%s" stroke-width="4"/>%s' % (MASS, "".join('<path d="M%d 446 L%d 476 L%d 446" stroke="%s" stroke-width="2.5" fill="none"/>' % (x, x + 20, x + 40, TRIM) for x in range(740, 1420, 40))))
    b.append('<rect x="790" y="520" width="580" height="250" fill="%s"/>' % HILL)
    for i, x in enumerate(range(800, 1380, 80)):
        b.append('<g transform="translate(%d 478)"><g class="beam" style="animation-delay:-%ss;animation-duration:%ss"><path d="M-7 0 H7 L70 330 H-70 Z" fill="url(#%s)"/></g>'
                 '<rect x="-9" y="-2" width="18" height="12" rx="3" fill="%s"/></g>' % (x, f(i * 1.3), 6 + i % 3, "lc" if i % 2 else "pc", EDGE))
    b.append('<rect x="720" y="770" width="720" height="60" fill="%s"/><rect x="720" y="770" width="720" height="6" fill="%s"/>' % (MASS2, EDGE))
    for x in (640, 1450):
        b.append("".join('<rect x="%d" y="%d" width="66" height="52" rx="3" fill="%s"/><circle cx="%d" cy="%d" r="15" fill="#0E1411" stroke="%s" stroke-width="3"/>'
                         % (x, y, MASS, x + 33, y + 26, TRIM) for y in range(610, 830, 55)))
    # fumée de scène
    b.append(plume(900, 770, 26, 5, 24) + plume(1240, 770, 24, 5, 28))
    b.append(ground(830))
    # la foule, bras levés
    rnd = random.Random(29)
    crowd = []
    for x in range(520, 1600, 30):
        y = 842 + rnd.randint(-6, 8)
        px = x + rnd.randint(-8, 8)
        g = '<circle cx="%d" cy="%d" r="11" fill="#040605"/><rect x="%d" y="%d" width="26" height="60" rx="10" fill="#040605"/>' % (px, y, px - 13, y + 8)
        if rnd.random() < .45:
            g += '<path d="M%d %d L%d %d" stroke="#040605" stroke-width="6" stroke-linecap="round"/>' % (px + 10, y + 14, px + 18 + rnd.randint(-4, 6), y - 26)
        crowd.append('<g class="bounce" style="animation-delay:-%ss">%s</g>' % (f(rnd.random()), g))
    b.append("".join(crowd))
    return svg("Un festival la nuit, faisceaux de lumière et foule bras levés", css, "\n".join(b))


def thc_canal():
    css = """
.neon{animation:neon 6s steps(1) infinite}
@keyframes neon{0%,100%{opacity:1}64%{opacity:.4}66%{opacity:1}}
.swell{animation:swell 9s ease-in-out infinite alternate}
@keyframes swell{from{transform:translateX(-24px)}to{transform:translateX(24px)}}
"""
    b = [sky(106, moon=(1360, 150))]
    # maisons à pignon le long du canal
    rnd = random.Random(37)
    x = 520
    shop = None
    k = 0
    while x < 1560:
        w, h = rnd.randint(86, 120), rnd.randint(200, 290)
        y = 770 - h
        col = [MASS2, MASS3, MASS][k % 3]
        gable = rnd.choice((0, 1, 2))
        top = ('M%d %d L%d %d L%d %d Z' % (x, y, x + w / 2, y - 46, x + w, y) if gable == 0 else
               'M%d %d V%d H%d V%d H%d V%d H%d V%d H%d V%d H%d V%d Z' % (x, y, y - 16, x + w * .25, y - 34, x + w * .4, y - 50, x + w * .6, y - 34, x + w * .75, y - 16, x + w, y) if gable == 1 else
               'M%d %d Q%d %d %d %d Z' % (x, y, x + w / 2, y - 70, x + w, y))
        b.append('<rect x="%d" y="%d" width="%d" height="%d" fill="%s"/><path d="%s" fill="%s"/>' % (x, y, w, h, col, top, col))
        if k == 3:
            shop = (x, w)
        else:
            b.append(windows(x + 14, y + 18, int((w - 16) / 28), int((h - 30) / 44), 28, 44, x, 14, 26, .5))
        x += w + 4
        k += 1
    sx, sw = shop
    # le coffee shop : vitrine de bocaux, croix verte
    b.append('<rect x="%d" y="640" width="%d" height="100" rx="3" fill="%s" opacity=".28"/>' % (sx + 10, sw - 20, VIOLET))
    b.append("".join('<rect x="%d" y="%d" width="12" height="18" rx="3" fill="%s" opacity=".85"/>' % (sx + 18 + c * 20, 656 + r * 34, FLAME2 if (c + r) % 3 == 0 else VIOLET)
                     for c in range(int((sw - 30) / 20)) for r in range(2)))
    b.append('<rect x="%d" y="740" width="%d" height="30" fill="%s"/>' % (sx, sw, MASS))
    cx = sx + sw / 2
    b.append('<g class="neon"><path d="M%s 560 h18 v18 h18 v18 h-18 v18 h-18 v-18 h-18 v-18 h18 Z" fill="%s"/><circle cx="%s" cy="596" r="60" fill="%s" opacity=".07"/></g>' % (f(cx - 9), VIOLET, f(cx), VIOLET))
    b.append(plume(sx + sw - 16, 760 - 300, 12, 5, 26))
    # quai, vélos, canal
    b.append('<rect x="0" y="770" width="1600" height="16" fill="%s"/><rect x="0" y="770" width="1600" height="3" fill="%s"/>' % (MASS, EDGE))
    for bx in (700, 760, 1180, 1420):
        b.append('<g transform="translate(%d 758)" fill="none" stroke="%s" stroke-width="2.5"><circle cx="0" cy="0" r="11"/><circle cx="34" cy="0" r="11"/><path d="M0 0 L12 -16 H28 L34 0 M12 -16 L20 0 H0 M28 -16 L30 -22 h6"/></g>' % (bx, EDGE))
    b.append("".join('<path d="M%d 770 V736 M%d 736 h-8 h16" stroke="%s" stroke-width="3"/><circle cx="%d" cy="734" r="4" fill="%s" opacity=".9"/>' % (x, x, TRIM, x, FLAME2) for x in (620, 1000, 1500)))
    b.append('<rect y="786" width="1600" height="214" fill="#080C0A"/>')
    b.append('<g class="swell">' + "".join('<rect x="%d" y="%d" width="%d" height="2" fill="%s" opacity="%s"/>'
             % (rnd.randint(500, 1500), 796 + i * 10, rnd.randint(30, 120), VIOLET if i % 3 else FLAME2, ".22" if i < 6 else ".1") for i in range(16)) + "</g>")
    return svg("Un canal bordé de maisons à pignon, un coffee shop à croix verte", css, "\n".join(b))


def thc_salon():
    css = """
.lava{animation:lava 9s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:50% 50%}
@keyframes lava{from{transform:translateY(0) scale(1)}to{transform:translateY(-46px) scale(.8,1.25)}}
.bub{animation:bub 2.2s ease-in infinite;opacity:0}
@keyframes bub{0%{opacity:0;transform:translateY(0)}20%{opacity:.8}100%{opacity:0;transform:translateY(-70px)}}
.ember{animation:ember 4s ease-in-out infinite}
@keyframes ember{0%,100%{opacity:.5}40%{opacity:1}}
.tv{animation:tv 3s steps(1) infinite}
@keyframes tv{0%{opacity:.5}33%{opacity:.7}66%{opacity:.4}}
"""
    b = ['<rect width="1600" height="1000" fill="%s"/>' % BG, cone_defs()]
    # le mur, la fenêtre sur la nuit, l'affiche de travers
    b.append('<rect y="0" width="1600" height="830" fill="%s"/>' % HILL)
    b.append('<rect x="640" y="250" width="250" height="300" rx="4" fill="%s" stroke="%s" stroke-width="8"/><path d="M765 250 V550 M640 400 H890" stroke="%s" stroke-width="6"/>'
             '<circle cx="820" cy="320" r="26" fill="#2B3A30"/><circle cx="830" cy="313" r="24" fill="%s"/>' % (BG, TRIM, TRIM, BG))
    b.append("".join('<circle class="tw" style="animation-delay:-%ss" cx="%d" cy="%d" r="1.6" fill="#7E9A86"/>' % (f(k * .9), x, y)
                     for k, (x, y) in enumerate(((670, 290), (720, 350), (700, 470), (850, 440), (790, 500), (740, 290)))))
    b.append('<g transform="rotate(-4 1420 380)"><rect x="1350" y="290" width="140" height="180" fill="%s" stroke="%s" stroke-width="4"/>%s</g>'
             % (MASS3, TRIM, weed(1420, 440, 1.5)))
    # lampe à lave
    b.append('<path d="M1220 700 L1232 560 Q1245 520 1258 560 L1270 700 Z" fill="%s" opacity=".28"/><path d="M1210 700 H1280 L1272 730 H1218 Z" fill="%s"/><rect x="1236" y="530" width="18" height="12" rx="3" fill="%s"/>'
             '<circle class="lava" cx="1245" cy="672" r="13" fill="%s"/><circle class="lava" style="animation-delay:-4s;animation-duration:7s" cx="1250" cy="640" r="8" fill="%s"/>'
             % (LAMP, MASS, MASS, PINK, LAMP))
    b.append('<circle cx="1245" cy="630" r="150" fill="%s" opacity=".05"/>' % LAMP)
    # meuble bas et télé qui tourne dans le vide
    b.append('<rect x="1180" y="730" width="330" height="100" rx="4" fill="%s"/><rect x="1180" y="730" width="330" height="6" fill="%s"/>' % (MASS2, EDGE))
    b.append('<rect x="1320" y="610" width="170" height="104" rx="6" fill="#070A08" stroke="%s" stroke-width="4"/><rect class="tv" x="1328" y="618" width="154" height="88" rx="3" fill="%s"/><rect x="1396" y="714" width="18" height="16" fill="%s"/>'
             % (TRIM, VIOLET, TRIM))
    # canapé
    b.append('<rect x="560" y="640" width="470" height="150" rx="26" fill="%s"/><rect x="530" y="690" width="70" height="130" rx="24" fill="%s"/><rect x="990" y="690" width="70" height="130" rx="24" fill="%s"/>'
             '<rect x="580" y="730" width="430" height="80" rx="18" fill="%s"/><rect x="620" y="660" width="170" height="80" rx="20" fill="%s"/><rect x="800" y="660" width="170" height="80" rx="20" fill="%s"/>'
             % (MASS, MASS2, MASS2, MASS3, MASS2, MASS2))
    # table basse : le bang, le cendrier, la boîte à pizza
    b.append('<rect x="700" y="806" width="420" height="14" rx="4" fill="%s"/><rect x="720" y="820" width="10" height="10" fill="%s"/><rect x="1090" y="820" width="10" height="10" fill="%s"/>' % (EDGE, TRIM, TRIM))
    b.append('<rect x="760" y="792" width="110" height="14" rx="2" fill="%s"/><rect x="760" y="792" width="110" height="3" fill="%s"/>' % (MASS2, EDGE))
    bx = 960
    b.append('<path d="M%d 806 Q%d 740 %d 730 V600 H%d V730 Q%d 740 %d 806 Z" fill="%s" opacity=".3" stroke="%s" stroke-width="3"/>'
             % (bx - 34, bx - 40, bx - 13, bx + 13, bx + 40, bx + 34, VIOLET, VIOLET))
    b.append('<rect x="%d" y="594" width="34" height="8" rx="4" fill="%s"/><path d="M%d 762 L%d 728" stroke="%s" stroke-width="7" stroke-linecap="round"/><path d="M%d 724 h18 l-4 10 h-10 Z" fill="%s"/>'
             '<circle class="ember" cx="%d" cy="724" r="5" fill="%s"/><path d="M%d 806 Q%d 772 %d 772 Q%d 772 %d 806 Z" fill="%s" opacity=".45"/>'
             % (bx - 17, VIOLET, bx + 26, bx + 62, EDGE, bx + 54, EDGE, bx + 63, FLAME, bx - 32, bx - 36, bx, bx + 36, bx + 32, VIOLET))
    b.append("".join('<circle class="bub" style="animation-delay:-%ss" cx="%d" cy="780" r="%s" fill="%s"/>' % (f(k * .5), bx - 14 + k * 9, "3" if k % 2 else "4", WHITE) for k in range(4)))
    b.append(plume(bx, 590, 14, 6, 24))
    b.append('<ellipse cx="1060" cy="804" rx="24" ry="5" fill="%s"/><path d="M1052 800 L1086 788" stroke="%s" stroke-width="5" stroke-linecap="round"/><circle class="ember" cx="1087" cy="787.5" r="4" fill="%s"/>%s'
             % (TRIM, WHITE, FLAME, plume(1090, 778, 8, 5, 20)))
    b.append(ground(830))
    return svg("Un salon la nuit : canapé, bang sur la table basse, lampe à lave", css, "\n".join(b))


THC_SCENES = {
    "thc-salon.svg": thc_salon,
    "thc-serre.svg": thc_serre,
    "thc-toit.svg": thc_toit,
    "thc-champ.svg": thc_champ,
    "thc-snack.svg": thc_snack,
    "thc-festival.svg": thc_festival,
    "thc-canal.svg": thc_canal,
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in SCENES.items():
        data = fn()
        (OUT / name).write_text(data, encoding="utf-8")
        print(f"{name:16} {len(data) / 1024:5.1f} Ko")
    globals().update(THC_PALETTE)
    for name, fn in THC_SCENES.items():
        data = fn()
        (OUT / name).write_text(data, encoding="utf-8")
        print(f"{name:16} {len(data) / 1024:5.1f} Ko")
