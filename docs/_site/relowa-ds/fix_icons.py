import os

base_path = '/Users/ozan/Desktop/Projects/relowa-poc/docs/_site/relowa-ds'

replacements = [
    {
        'file': 'ui_kits/recycler-web/index.html',
        'changes': [
            ('<i data-lucide="megaphone"></i>', '<i data-lucide="truck"></i>'),
            ('<span class="sidebar-icon"><i data-lucide="truck"></i></span>\n          Operasyon Takip', '<span class="sidebar-icon"><i data-lucide="activity"></i></span>\n          Operasyon Takip')
        ]
    },
    {
        'file': 'preview/components_sidebar.html',
        'changes': [
            ('<i data-lucide="megaphone"></i>', '<i data-lucide="truck"></i>'),
            ('<span class="nav-icon"><i data-lucide="truck"></i></span>\n        Operasyon Takip', '<span class="nav-icon"><i data-lucide="activity"></i></span>\n        Operasyon Takip')
        ]
    }
]

for item in replacements:
    filepath = os.path.join(base_path, item['file'])
    if not os.path.exists(filepath):
        continue
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for old, new in item['changes']:
        content = content.replace(old, new)
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

print("Icons fixed.")
