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
"""
REDUCED = "@media (prefers-reduced-motion:reduce){*{animation:none!important}.smoke{opacity:.8}}"


def f(x):
    return ("%.1f" % x).rstrip("0").rstrip(".")


def svg(label, css, body):
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice" '
            'role="img" aria-label="' + label + '">\n<style>' + BASE_CSS + css + REDUCED + "</style>\n" + body + "</svg>\n")


def sky(seed, moon=(1330, 170), stars=90, top=560):
    rnd = random.Random(seed)
    out = ['<rect width="1600" height="1000" fill="%s"/>' % BG, '<g fill="#4A4266">']
    for _ in range(stars):
        out.append('<circle cx="%d" cy="%d" r="%s"/>' % (rnd.randint(0, 1600), rnd.randint(20, top), rnd.choice(["1", "1", "1.4", "1.8"])))
    out.append("</g>")
    if moon:
        x, y = moon
        out.append('<circle cx="%d" cy="%d" r="44" fill="#1A1624"/><circle cx="%d" cy="%d" r="40" fill="%s"/>' % (x, y, x + 16, y - 10, BG))
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
.heat{animation:heat 5s ease-in-out infinite;opacity:0}
@keyframes heat{0%{opacity:0;transform:translateY(0)}40%{opacity:.5}100%{opacity:0;transform:translateY(-70px)}}
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
        # ventilateurs sur le toit
        for k in range(int(w / 70)):
            cx, cy = x + 36 + k * 70, y - 16
            b.append('<rect x="%d" y="%d" width="56" height="16" fill="%s"/><circle cx="%d" cy="%d" r="15" fill="%s"/>'
                     '<g class="fan" style="animation-delay:-%ss"><path d="M%d %d l0 -12 l5 0 Z M%d %d l12 0 l0 5 Z M%d %d l0 12 l-5 0 Z M%d %d l-12 0 l0 -5 Z" fill="%s"/></g>'
                     % (cx - 28, cy, TRIM, cx, cy, "#1A1624", f(rnd.random()), cx, cy, cx, cy, cx, cy, cx, cy, EDGE))
            b.append('<path class="heat" style="animation-delay:-%ss" d="M%d %d c -8 -14 8 -22 0 -36 c -8 -14 8 -22 0 -36" stroke="%s" stroke-width="2" fill="none"/>'
                     % (f(rnd.random() * 5), cx, cy - 18, "#4A4266"))
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
JET = ('<path d="M0 0 L52 -3 C60 -3 66 -1 68 1 C66 3 60 4 52 4 L0 4 Z" fill="%s"/>'
       '<path d="M22 -2 L30 -14 L36 -14 L32 -2 Z M22 4 L30 14 L36 14 L32 4 Z M2 -1 L6 -9 L10 -9 L9 0 Z" fill="%s"/>')


def airport():
    css = """
.takeoff{animation:takeoff 16s cubic-bezier(.5,0,.9,.6) infinite}
@keyframes takeoff{0%{transform:translate(180px,800px) rotate(0deg) scale(1.3);opacity:1}35%{transform:translate(700px,796px) rotate(0deg) scale(1.3)}100%{transform:translate(1750px,300px) rotate(-16deg) scale(1.1);opacity:1}}
.rabbit{animation:rabbit 1.6s steps(1) infinite;opacity:.12}
@keyframes rabbit{0%{opacity:1}12%{opacity:.12}}
.sweep{animation:sweep 4s linear infinite;transform-box:fill-box;transform-origin:0 50%}
@keyframes sweep{0%{transform:rotate(-30deg);opacity:0}20%{opacity:.08}50%{transform:rotate(30deg);opacity:0}100%{opacity:0}}
"""
    b = [sky(33, moon=(1200, 130))]
    b.append(hills(700, 760))
    # tour de contrôle
    b.append('<rect x="1330" y="470" width="34" height="360" fill="%s"/><path d="M1300 430 L1394 430 L1384 470 L1310 470 Z" fill="%s"/>'
             '<rect x="1308" y="440" width="78" height="18" fill="%s" opacity=".45"/><rect x="1300" y="420" width="94" height="10" fill="%s"/>'
             '<path class="sweep" d="M1347 412 L1600 398 L1600 424 Z" fill="%s"/>%s'
             % (MASS, MASS2, VIOLET, TRIM, WHITE, beacon(1347, 404, 0)))
    # terminal
    b.append('<rect x="820" y="720" width="480" height="110" fill="%s"/><rect x="820" y="720" width="480" height="8" fill="%s"/>%s'
             % (MASS2, EDGE, windows(836, 740, 15, 3, 30, 24, 9, 18, 12, .65)))
    # jets garés, un chauffeur par jet
    for x in (380, 520, 660):
        b.append('<g transform="translate(%d 812) scale(1.4)">%s</g>%s' % (x, JET % (MASS, MASS), beacon(x + 6, 813, x / 300, 1.6)))
    # camion de kérosène
    b.append('<rect x="1440" y="800" width="70" height="24" rx="5" fill="%s"/><rect x="1510" y="806" width="26" height="18" fill="%s"/>'
             '<circle cx="1455" cy="826" r="5" fill="%s"/><circle cx="1522" cy="826" r="5" fill="%s"/>%s'
             % (MASS2, MASS, TRIM, TRIM, beacon(1523, 803, .3, 1.6, "#E2B55A")))
    b.append(ground(830))
    # piste : balisage qui court vers le seuil
    b.append('<rect y="836" width="1600" height="26" fill="#0D0B12"/>')
    b.append("".join('<rect x="%d" y="846" width="30" height="4" fill="%s" opacity=".35"/>' % (x, "#4A4266") for x in range(40, 1600, 80)))
    b.append("".join('<circle cx="%d" cy="866" r="2" fill="%s" class="rabbit" style="animation-delay:%ss"/>' % (x, WHITE, f(i * .1))
                     for i, x in enumerate(range(1560, 0, -100))))
    b.append("".join('<circle cx="%d" cy="834" r="1.6" fill="%s" opacity=".6"/>' % (x, VIOLET) for x in range(20, 1600, 60)))
    # le jet qui décolle (pour un fichier de 3 Mo)
    b.append('<g class="takeoff"><g transform="translate(0 -6)">%s%s</g></g>' % (JET % ("#3A3252", "#3A3252"), beacon(4, 1, 0, 1.6)))
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
    # panneau publicitaire : WeshTransfer, forcément
    b.append('<rect x="1180" y="480" width="8" height="220" fill="%s"/><rect x="1060" y="400" width="250" height="100" fill="%s"/>'
             '<g class="board"><rect x="1068" y="408" width="234" height="84" fill="#1D1830"/>'
             '<g transform="translate(1110 422) scale(.56)"><path d="M135.733 84.8 125.733 84.933 146.8 0H183.2L155.067 100H110.8L84.933 18.8H98.267L72.4 100H28.133L0 0H36.533L57.6 84.8L47.6 84.667L73.6 0H109.6Z" fill="%s"/>'
             '<path d="M200.048 14.8H234.448V100H200.048ZM164.048 0H258V30.667H164.048ZM256 -15L292 15.333L256 45.667Z" fill="%s"/></g></g>'
             % (MASS, MASS, VIOLET, WHITE))
    # viaduc
    b.append('<rect y="742" width="1600" height="30" fill="%s"/><rect y="742" width="1600" height="4" fill="%s"/>' % (MASS, EDGE))
    b.append("".join('<rect x="%d" y="772" width="30" height="60" fill="%s"/>' % (x, MASS2) for x in range(80, 1600, 260)))
    # lampadaires
    b.append("".join('<path d="M%d 742 V660 h24" stroke="%s" stroke-width="3" fill="none"/><rect x="%d" y="658" width="12" height="4" fill="%s" opacity=".7"/>'
                     % (x, TRIM, x + 18, "#E2B55A") for x in range(40, 1600, 200)))
    # bouchon : phares d'un côté, feux arrière de l'autre
    a = "".join('<rect x="%d" y="728" width="44" height="14" rx="4" fill="%s"/><circle cx="%d" cy="735" r="2.2" fill="%s"/><circle cx="%d" cy="735" r="2.2" fill="%s"/>'
                % (x, MASS3, x + 44, WHITE, x + 44, WHITE) for x in range(-380, 1980, 70))
    bb = "".join('<rect x="%d" y="716" width="44" height="14" rx="4" fill="%s"/><circle cx="%d" cy="723" r="2" fill="%s"/>'
                 % (x, MASS2, x, RED) for x in range(-380, 1980, 64))
    b.append('<g class="lane-b">%s</g><g class="lane-a">%s</g>' % (bb, a))
    b.append(ground(830))
    return svg("Une autoroute de SUV embouteillée, la nuit", css, "\n".join(b))


SCENES = {
    "plateforme.svg": oil_rig,
    "serveurs.svg": datacenter,
    "aeroport.svg": airport,
    "ski.svg": ski,
    "autoroute.svg": highway,
}

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, fn in SCENES.items():
        data = fn()
        (OUT / name).write_text(data, encoding="utf-8")
        print(f"{name:16} {len(data) / 1024:5.1f} Ko")
