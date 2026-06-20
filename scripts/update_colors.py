import re

file_path = "templates/ppompu-ad-design-system/ui_kits/ppompu-ad/redesign-v4v1.html"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Background colors
bg_map = {
    # Extremely Light Backgrounds -> Slate 50 (#f8fafc)
    r'#fff1f2': '#f8fafc',
    r'#f8faff': '#f8fafc',
    r'#f0f9ff': '#f8fafc',
    r'#e6fafb': '#f8fafc',
    r'#fff5f5': '#f8fafc',
    r'#fff7ed': '#f8fafc',
    r'#fff0f4': '#f8fafc',
    r'#f0faf9': '#f8fafc',
    r'#fffbeb': '#f8fafc',
    r'#fffaf5': '#f8fafc',
    r'#fffafb': '#f8fafc',
    r'#f5f0ff': '#f8fafc',

    # Light Backgrounds -> Indigo 50 (#eef2ff)
    r'#ffe4e6': '#eef2ff',
    r'#eff6ff': '#eef2ff',
    r'#e0f2fe': '#eef2ff',
    r'#cffafe': '#eef2ff',
    r'#fee2e2': '#eef2ff',
    r'#ffedd5': '#eef2ff',
    r'#ccfaf6': '#eef2ff',
    r'#e8dff5': '#eef2ff',

    # Borders / Dividers -> Slate 200 (#e2e8f0)
    r'#fecdd3': '#e2e8f0',
    r'#dbeafe': '#e2e8f0',
    r'#bae6fd': '#e2e8f0',
    r'#a5f3fc': '#e2e8f0',
    r'#fed7aa': '#e2e8f0',
    r'#a5f3eb': '#e2e8f0',
    r'#fef3c7': '#e2e8f0',
    r'#d8b4fe': '#e2e8f0',
    r'#bfdbfe': '#e2e8f0',
}

# 2. Text and Accent colors
accent_map = {
    # Titles and Strong Elements -> Slate 800 (#1e293b)
    r'#9f1239': '#1e293b',
    r'#1e3a5f': '#1e293b',
    r'#1e40af': '#1e293b',
    r'#0369a1': '#1e293b',
    r'#00838a': '#1e293b',
    r'#E30000': '#1e293b',
    r'#c70000': '#1e293b',
    r'#c2410c': '#1e293b',
    r'#b91c4a': '#1e293b',
    r'#2a8a88': '#1e293b',
    r'#3b1f8c': '#1e293b',
    r'#b45309': '#1e293b',

    # Primary accents (Prices, main borders) -> Indigo 600 (#4f46e5)
    r'#1d4ed8': '#4f46e5',
    r'#0284c7': '#4f46e5',
    r'#0e7490': '#4f46e5',
    r'#f97316': '#4f46e5',
    r'#ea4b71': '#4f46e5',
    r'#4CC2C0': '#4f46e5',
    r'#3b82f6': '#4f46e5',
    r'#6e40c9': '#4f46e5',
    r'#00C4CC': '#4f46e5',

    # Muted badges -> Indigo 400 (#818cf8)
    r'#fca5a5': '#818cf8',
    r'#d97706': '#818cf8',
}

for old, new in bg_map.items():
    content = re.sub(old, new, content, flags=re.IGNORECASE)

for old, new in accent_map.items():
    content = re.sub(old, new, content, flags=re.IGNORECASE)

# 3. Fix the primary CTA Button (KakaoTalk) to stand out more.
# Currently it was #9f1239 which got mapped to #1e293b.
# Let's map the button specifically to Indigo 600 (#4f46e5) for better CTA visibility.
# The button has text "카카오톡채널로문의/신청하기"
cta_pattern = r'background-color: #1e293b;(.*?)box-shadow: 0 4px 6px rgba\(159,18,57,0\.15\);(.*?)카카오톡채널로문의/신청하기'
cta_replacement = r'background-color: #4f46e5;\1box-shadow: 0 4px 6px rgba(79,70,229,0.2);\2카카오톡채널로문의/신청하기'
content = re.sub(cta_pattern, cta_replacement, content, flags=re.DOTALL)

# 4. Clean up other hardcoded RGB/RGBA shadows or borders that got missed
# "rgba(159,18,57" (Rose 800) -> rgba(30,41,59 (Slate 800)
content = content.replace("rgba(159, 18, 57", "rgba(30, 41, 59")
content = content.replace("rgba(159,18,57", "rgba(30,41,59")

# 5. Fix the "필독 유의사항" box border
# border-color: #e2e8f0 rgb(226, 232, 240) rgb(226, 232, 240) rgb(159, 18, 57); -> change the last one to Indigo 600 or Slate 800
content = content.replace("rgb(159, 18, 57)", "rgb(30, 41, 59)")

# 6. Some text inside the warning box
# <strong style="color: #881337;">-서비스 보장:</strong> (Rose 900) -> #0f172a (Slate 900)
content = content.replace("#881337", "#0f172a")

# Ensure the body/global background is a bit more sophisticated
# Currently it's #e5e7eb (Gray 200). Let's change it to Slate 100 (#f1f5f9) or Slate 50 (#f8fafc)
content = content.replace('background-color: #e5e7eb;', 'background-color: #f1f5f9;')

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Color update complete!")
