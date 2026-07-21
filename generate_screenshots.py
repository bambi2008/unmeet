#!/usr/bin/env python3
"""Generate Chrome Web Store screenshots for UnMeet extension."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1280, 800
OUT = os.path.join(os.path.dirname(__file__), 'screenshots')
os.makedirs(OUT, exist_ok=True)

# Colors
BG      = (9, 10, 14)
SURFACE = (17, 19, 24)
BORDER  = (30, 32, 40)
TEXT    = (176, 179, 189)
TEXT_DIM = (92, 95, 107)
WHITE   = (255, 255, 255)
ACCENT  = (59, 130, 246)
GREEN   = (16, 185, 129)
RED     = (239, 68, 68)
AMBER   = (245, 158, 11)
MEET_BG = (32, 33, 36)

# Fonts
FONT_DIR = os.path.expandvars(r'C:\Windows\Fonts')
try:
    FONT_REG = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeui.ttf'), 13)
    FONT_BOLD = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeuib.ttf'), 13)
    FONT_H1 = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeuib.ttf'), 18)
    FONT_SMALL = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeui.ttf'), 11)
    FONT_HUGE = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeuib.ttf'), 28)
    FONT_STAT = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeuib.ttf'), 22)
except:
    FONT_REG = FONT_BOLD = FONT_H1 = FONT_SMALL = FONT_HUGE = FONT_STAT = ImageFont.load_default()


def draw_rounded_rect(draw, xy, radius, fill, outline=None):
    """Draw a rounded rectangle."""
    x1, y1, x2, y2 = xy
    draw.rounded_rectangle(xy, radius=radius, fill=fill, outline=outline, width=1 if outline else 0)


def screenshot_1_popup():
    """Screenshot 1: Popup showing live meeting + stats"""
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    # ── Background: Google Meet tab (simulated) ──
    d.rectangle([0, 0, W, 56], fill=MEET_BG)
    d.text((16, 16), "UnMeet — Google Meet call", fill=TEXT_DIM, font=FONT_REG)
    d.rectangle([0, 56, 240, H], fill=(24, 25, 28))
    d.text((20, 80), "Meeting · 7 participants", fill=TEXT_DIM, font=FONT_SMALL)

    # ── Popup (centered) ──
    px, py = (W - 360)//2, (H - 480)//2

    # Popup background
    draw_rounded_rect(d, [px, py, px+360, py+480], 16, SURFACE, BORDER)

    # Header
    d.text((px+16, py+16), "Un", fill=WHITE, font=FONT_H1)
    aw = d.textlength("Un", font=FONT_H1)
    d.text((px+16+aw, py+16), "Meet", fill=ACCENT, font=FONT_H1)

    # Live bar — active meeting
    bar_y = py + 48
    draw_rounded_rect(d, [px+12, bar_y, px+348, bar_y+60], 10,
                      fill=(16, 185, 129, 20), outline=(16, 185, 129, 50))

    # Live dot
    d.ellipse([px+24, bar_y+16, px+36, bar_y+28], fill=GREEN)

    d.text((px+44, bar_y+10), "IN MEETING", fill=GREEN, font=FONT_SMALL)
    d.text((px+44, bar_y+28), "Google Meet", fill=WHITE, font=FONT_BOLD)
    d.text((px+44, bar_y+42), "0h 24m", fill=TEXT_DIM, font=FONT_SMALL)
    d.text((px+280, bar_y+18), "$30.00", fill=RED, font=FONT_BOLD)

    # ── Stats grid ──
    gy = bar_y + 80
    gw = 156
    stats = [
        ("2.5h", "Today"),
        ("12.5h", "This Week"),
        ("8", "Meetings"),
        ("3.8/5", "Avg Rating"),
    ]
    for i, (val, label) in enumerate(stats):
        col = i % 2
        row = i // 2
        x = px + 16 + col * (gw + 8)
        y = gy + row * 72
        draw_rounded_rect(d, [x, y, x+gw, y+60], 8, SURFACE, BORDER)
        d.text((x+gw//2 - d.textlength(val, font=FONT_STAT)//2, y+8), val, fill=WHITE, font=FONT_STAT)
        d.text((x+gw//2 - d.textlength(label, font=FONT_SMALL)//2, y+36), label, fill=TEXT_DIM, font=FONT_SMALL)

    # ── Recent meetings ──
    ry = gy + 2*72 + 16
    d.text((px+16, ry), "RECENT MEETINGS", fill=TEXT_DIM, font=FONT_SMALL)
    ry += 22

    meetings = [
        ("Google Meet", "2:30 PM", "45m", "★★★★★"),
        ("Microsoft Teams", "11:00 AM", "1h 15m", "★★★☆☆"),
        ("Zoom", "9:00 AM", "30m", "★★★★☆"),
        ("Feishu", "Yesterday", "1h", "★★☆☆☆"),
    ]
    for plat, time, dur, stars in meetings:
        draw_rounded_rect(d, [px+12, ry, px+348, ry+48], 8, fill=None, outline=BORDER)
        d.text((px+22, ry+6), plat, fill=WHITE, font=FONT_BOLD)
        d.text((px+22, ry+24), time, fill=TEXT_DIM, font=FONT_SMALL)
        d.text((px+240, ry+8), dur, fill=TEXT, font=FONT_REG)
        # Stars color
        sc = GREEN if stars.count('★') >= 4 else AMBER if stars.count('★') >= 3 else RED
        d.text((px+240, ry+22), stars, fill=sc, font=FONT_SMALL)
        ry += 56

    # Footer
    d.text((px+16, py+456), "All data stored locally", fill=TEXT_DIM, font=FONT_SMALL)

    path = os.path.join(OUT, 'screenshot1-popup.png')
    img.save(path, 'PNG')
    print(f'✓ {path} ({W}x{H})')


def screenshot_2_dashboard():
    """Screenshot 2: Weekly dashboard mockup — dark, data-rich"""
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    # ── Sidebar ──
    d.rectangle([0, 0, 220, H], fill=(13, 14, 18))
    d.rectangle([219, 0, 220, H], fill=BORDER)
    d.text((20, 24), "UnMeet", fill=WHITE, font=FONT_H1)
    nav = ["Dashboard", "Meetings", "Teams", "Settings"]
    for i, item in enumerate(nav):
        y = 80 + i * 40
        color = WHITE if i == 0 else TEXT_DIM
        bg = (ACCENT + (25,)) if i == 0 else None
        if bg: draw_rounded_rect(d, [12, y-6, 208, y+28], 6, fill=bg)
        d.text((24, y), item, fill=color, font=FONT_REG)

    # ── Main content ──
    d.text((244, 24), "Weekly Report", fill=WHITE, font=FONT_H1)
    d.text((244, 48), "Jul 14 — Jul 20, 2026", fill=TEXT_DIM, font=FONT_SMALL)

    # Big stat cards
    cards = [
        ("17", "Meetings\nthis week", AMBER),
        ("12.5h", "Time in\nmeetings", RED),
        ("$937.50", "Estimated\ncost", RED),
        ("3.2/5", "Average\nrating", AMBER),
    ]
    for i, (val, label, color) in enumerate(cards):
        x = 244 + i * 200
        draw_rounded_rect(d, [x, 80, x+184, 160], 12, SURFACE, BORDER)
        d.text((x+16, 92), val, fill=color, font=FONT_HUGE)
        lines = label.split('\n')
        for j, line in enumerate(lines):
            d.text((x+16, 128+j*16), line, fill=TEXT_DIM, font=FONT_SMALL)

    # Daily breakdown bars
    d.text((244, 264), "Daily breakdown", fill=WHITE, font=FONT_BOLD)
    days = [
        ("Mon", 1.5, 3), ("Tue", 3.2, 5), ("Wed", 2.0, 4),
        ("Thu", 4.5, 7), ("Fri", 1.2, 2), ("Sat", 0, 0), ("Sun", 0, 0),
    ]
    chart_x, chart_y = 244, 290
    bar_w = 80
    max_h = 120
    for i, (day, hours, count) in enumerate(days):
        x = chart_x + i * 100
        bar_h = int((hours / 6) * max_h) if hours > 0 else 2
        # Bar
        color = RED if hours > 3 else AMBER if hours > 1 else GREEN
        draw_rounded_rect(d, [x+20, chart_y+max_h-bar_h+16, x+20+bar_w, chart_y+max_h+16], 6,
                          fill=color + (200,) if hours > 0 else BORDER)
        if count > 0:
            d.text((x+20+bar_w//2 - d.textlength(str(count), font=FONT_SMALL)//2,
                    chart_y+max_h-bar_h+2), str(count), fill=WHITE, font=FONT_SMALL)
        d.text((x+20+bar_w//2 - d.textlength(day, font=FONT_SMALL)//2,
                chart_y+max_h+24), day, fill=TEXT_DIM, font=FONT_SMALL)
        d.text((x+20+bar_w//2 - d.textlength(f"{hours}h", font=FONT_SMALL)//2,
                chart_y+max_h+40), f"{hours}h", fill=TEXT, font=FONT_SMALL)

    # Meeting list
    ly = chart_y + max_h + 70
    d.text((244, ly), "Recent meetings", fill=WHITE, font=FONT_BOLD)
    meetings = [
        ("Daily standup", "Mon 9:00 AM", "30m", "5", 8, GREEN),
        ("Product review", "Tue 2:00 PM", "1h 15m", "4", 12, GREEN),
        ("Client pitch", "Wed 11:00 AM", "45m", "5", 4, GREEN),
        ("All hands", "Thu 3:00 PM", "2h", "2", 45, RED),
        ("Budget planning", "Thu 1:00 PM", "1.5h", "3", 15, AMBER),
    ]
    for i, (title, time, dur, rating, ppl, color) in enumerate(meetings):
        y = ly + 32 + i * 40
        d.text((260, y), title, fill=WHITE, font=FONT_REG)
        d.text((520, y), time, fill=TEXT_DIM, font=FONT_SMALL)
        d.text((680, y), dur, fill=TEXT, font=FONT_SMALL)
        stars = "★" * int(rating) + "☆" * (5 - int(rating))
        d.text((760, y), stars, fill=color, font=FONT_SMALL)
        d.text((880, y), f"{ppl} people", fill=TEXT_DIM, font=FONT_SMALL)
        if i < len(meetings) - 1:
            d.line([260, y+22, 980, y+22], fill=BORDER, width=1)

    path = os.path.join(OUT, 'screenshot2-dashboard.png')
    img.save(path, 'PNG')
    print(f'✓ {path} ({W}x{H})')


def screenshot_3_cost():
    """Screenshot 3: Cost impact — the emotional hook"""
    img = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(img)

    # Center everything
    cx = W // 2

    # Title
    title = "Your meetings this month cost"
    tw = d.textlength(title, font=FONT_REG)
    d.text((cx - tw//2, 120), title, fill=TEXT, font=FONT_REG)

    cost = "$3,245.00"
    cw = d.textlength(cost, font=ImageFont.truetype(os.path.join(FONT_DIR, 'segoeuib.ttf'), 64) if os.path.exists(os.path.join(FONT_DIR, 'segoeuib.ttf')) else FONT_HUGE)
    try:
        fbig = ImageFont.truetype(os.path.join(FONT_DIR, 'segoeuib.ttf'), 64)
    except:
        fbig = FONT_HUGE
    d.text((cx - d.textlength(cost, font=fbig)//2, 160), cost, fill=RED, font=fbig)

    equiv = "Equivalent to 1.5 months of rent in San Francisco"
    ew = d.textlength(equiv, font=FONT_SMALL)
    d.text((cx - ew//2, 240), equiv, fill=TEXT_DIM, font=FONT_SMALL)

    # Three comparison cards
    cards = [
        ("17.5h", "unnecessary\nmeetings", "Could have been\nemails or async", RED),
        ("31%", "of meetings\nrated ≤ 2★", "Your team agrees\nthey were wasteful", AMBER),
        ("6.2h", "could be\nreclaimed / week", "With UnMeet Pro\nAI recommendations", GREEN),
    ]
    for i, (val, title_text, desc, color) in enumerate(cards):
        x = 80 + i * 390
        y = 320
        draw_rounded_rect(d, [x, y, x+350, y+200], 16, SURFACE, BORDER)
        vw = d.textlength(val, font=FONT_HUGE)
        d.text((x+175 - vw//2, y+20), val, fill=color, font=FONT_HUGE)
        d.text((x+175 - d.textlength(title_text.split('\n')[0], font=FONT_BOLD)//2,
                y+70), title_text, fill=WHITE, font=FONT_BOLD)
        d.text((x+175 - d.textlength(desc.split('\n')[0], font=FONT_SMALL)//2,
                y+120), desc, fill=TEXT_DIM, font=FONT_SMALL)

    # CTA
    cta_y = 580
    btn_w, btn_h = 240, 48
    draw_rounded_rect(d, [cx-btn_w//2, cta_y, cx+btn_w//2, cta_y+btn_h], 12, fill=ACCENT)
    btext = "Get UnMeet Pro — $8/month"
    d.text((cx - d.textlength(btext, font=FONT_BOLD)//2, cta_y+14), btext, fill=WHITE, font=FONT_BOLD)

    hint = "14-day free trial. Cancel anytime."
    hw = d.textlength(hint, font=FONT_SMALL)
    d.text((cx - hw//2, cta_y+58), hint, fill=TEXT_DIM, font=FONT_SMALL)

    path = os.path.join(OUT, 'screenshot3-cost.png')
    img.save(path, 'PNG')
    print(f'✓ {path} ({W}x{H})')


if __name__ == '__main__':
    screenshot_1_popup()
    screenshot_2_dashboard()
    screenshot_3_cost()
    print(f'\nDone! Screenshots saved to {OUT}/')
