# Prints the two polygons of the ARTEL mark in a 64x64 box: the charcoal one, then the red one.
# icon.svg and tray.svg place them; render each to PNG at 1024 and 64 px with transparent corners.
# Usage: python3 logo.py [gap]
# Regular pointy-top hexagon band of width W. Cut straight through the middle of the corners at B and LR
# (the line from the centre through each vertex). Red is the B-LR edge, charcoal the other five edges.
import math, sys
cx, cy, R, W = 32.0, 32.0, 24.0, 9.0
gap = float(sys.argv[1]) if len(sys.argv) > 1 else 3.0
hw = W / 2
c30 = math.cos(math.radians(30))
V = {'T': (cx, cy-R), 'UR': (cx+R*c30, cy-R/2), 'LR': (cx+R*c30, cy+R/2),
     'B': (cx, cy+R), 'LL': (cx-R*c30, cy+R/2), 'UL': (cx-R*c30, cy-R/2)}

def offset_line(a, b, d):
    ax, ay = V[a]; bx, by = V[b]; dx, dy = bx-ax, by-ay; L = math.hypot(dx, dy)
    nx, ny = dy/L, -dx/L
    mx, my = (ax+bx)/2, (ay+by)/2
    if (mx+nx-cx)**2+(my+ny-cy)**2 < (mx-cx)**2+(my-cy)**2: nx, ny = -nx, -ny
    return (ax+nx*d, ay+ny*d), (dx/L, dy/L)

def meet(l1, l2):
    (p, d), (q, e) = l1, l2
    den = d[0]*e[1]-d[1]*e[0]
    t = ((q[0]-p[0])*e[1]-(q[1]-p[1])*e[0]) / den
    return (p[0]+t*d[0], p[1]+t*d[1])

def corner(a, v, b, d):
    return meet(offset_line(a, v, d), offset_line(v, b, d))

def shift(p, line, dist):
    # move p along the edge direction of `line`
    (_, (ux, uy)) = line
    return (p[0]+ux*dist, p[1]+uy*dist)

h = gap / 2
# red: edge B -> LR, both ends on the corner's centre line, pulled in by half the gap along the edge
eo, ei = offset_line('B', 'LR', hw), offset_line('B', 'LR', -hw)
red = [shift(corner('LL', 'B', 'LR', -hw), ei, h), shift(corner('LL', 'B', 'LR', hw), eo, h),
       shift(corner('B', 'LR', 'UR', hw), eo, -h), shift(corner('B', 'LR', 'UR', -hw), ei, -h)]

# charcoal: LR -> UR -> T -> UL -> LL -> B
ro, ri = offset_line('LR', 'UR', hw), offset_line('LR', 'UR', -hw)
lo, li = offset_line('LL', 'B', hw), offset_line('LL', 'B', -hw)
outer = [shift(corner('B', 'LR', 'UR', hw), ro, h)] + [corner(a, v, b, hw) for a, v, b in
         [('LR','UR','T'), ('UR','T','UL'), ('T','UL','LL'), ('UL','LL','B')]] + [shift(corner('LL', 'B', 'LR', hw), lo, -h)]
inner = [shift(corner('LL', 'B', 'LR', -hw), li, -h)] + [corner(a, v, b, -hw) for a, v, b in
         [('UL','LL','B'), ('T','UL','LL'), ('UR','T','UL'), ('LR','UR','T')]] + [shift(corner('B', 'LR', 'UR', -hw), ri, h)]

fmt = lambda pts: ' '.join(f'{x:.2f},{y:.2f}' for x, y in pts)
print(fmt(outer + inner)); print(fmt(red))
