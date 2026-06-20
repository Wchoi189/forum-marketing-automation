import re

file_path = "templates/ppompu-ad-design-system/ui_kits/ppompu-ad/redesign-v4v1.html"

with open(file_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Structural Tweaks (border-radius and shadows)
content = content.replace('border-radius: 12px;', 'border-radius: 16px;')
content = content.replace('border-radius: 10px;', 'border-radius: 14px;')

# Replace solid borders with soft shadows for standard cards
content = content.replace('border: 1px solid #cbd5e1;', 'border: 1px solid rgba(0,0,0,0.04); box-shadow: 0 4px 20px rgba(0,0,0,0.03);')
content = content.replace('border-bottom: 1px solid #cbd5e1;', 'border-bottom: 1px solid #E4E1DB;')

# Replace heavy colored borders with Ochre borders and elegant glow for premium cards
content = content.replace('border: 2px solid #4f46e5;', 'border: 2px solid #C87A53; box-shadow: 0 8px 24px rgba(200,122,83,0.12);')
content = content.replace('border-bottom: 2px solid #e2e8f0;', 'border-bottom: 1px solid rgba(0,0,0,0.06);')

# 2. Color Replacements (Premium Editorial Theme)
colors = {
    # Backgrounds
    r'#f8fafc': '#F9F8F6', # Ecru / Very Light Warm Gray
    r'#f1f5f9': '#F2F0EB', # Outer background / Slightly darker warm gray
    r'#eef2ff': '#FAF6F3', # Card header warm tint
    
    # Borders
    r'#e2e8f0': '#E4E1DB', # Soft Muted Sand
    r'#cbd5e1': '#E4E1DB',
    
    # Typography
    r'#1e293b': '#1E1E1E', # Deep Charcoal
    r'#0f172a': '#1E1E1E',
    r'#334155': '#3E3C38',
    r'#475569': '#5C5A56',
    r'#64748b': '#7A7771',
    r'#94a3b8': '#A3A09A',
    
    # Accents (Indigo -> Warm Ochre)
    r'#4f46e5': '#C87A53',
    r'#818cf8': '#DDA78A',
}

for old, new in colors.items():
    content = re.sub(old, new, content, flags=re.IGNORECASE)

# 3. Special handling for CTA Button to make it distinct (Deep Charcoal instead of Ochre for primary action)
# Current CTA is Ochre (#C87A53) because we just mapped #4f46e5 -> #C87A53
cta_pattern = r'background-color: #C87A53;(.*?)box-shadow: 0 4px 6px rgba\(79,70,229,0\.2\);(.*?)카카오톡채널로문의/신청하기'
cta_replacement = r'background-color: #1E1E1E;\1box-shadow: 0 8px 20px rgba(0,0,0,0.15);\2카카오톡채널로문의/신청하기'
content = re.sub(cta_pattern, cta_replacement, content, flags=re.DOTALL)

with open(file_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Editorial Theme Applied!")
