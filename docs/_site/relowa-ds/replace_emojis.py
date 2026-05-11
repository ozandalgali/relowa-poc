import os

base_path = '/Users/ozan/Desktop/Projects/relowa-poc/docs/_site/relowa-ds'

replacements = [
    {
        'file': 'ui_kits/recycler-web/index.html',
        'changes': [
            ('  <link rel="stylesheet" href="styles.css">', '  <link rel="stylesheet" href="styles.css">\n  <script src="https://unpkg.com/lucide@latest"></script>'),
            ('</body>', '  <script>lucide.createIcons();</script>\n</body>'),
            ('<span class="sidebar-icon">◉</span>', '<span class="sidebar-icon"><i data-lucide="layout-dashboard"></i></span>'),
            ('<span class="sidebar-icon">◎</span>', '<span class="sidebar-icon"><i data-lucide="store"></i></span>'),
            ('<span class="sidebar-icon">✚</span>', '<span class="sidebar-icon"><i data-lucide="plus-circle"></i></span>'),
            ('<span class="sidebar-icon">▶</span>', '<span class="sidebar-icon"><i data-lucide="activity"></i></span>'),
            ('<span class="sidebar-icon">▤</span>', '<span class="sidebar-icon"><i data-lucide="dollar-sign"></i></span>'),
            ('<span class="sidebar-icon">◷</span>', '<span class="sidebar-icon"><i data-lucide="history"></i></span>'),
            ('<span class="sidebar-icon">♻</span>', '<span class="sidebar-icon"><i data-lucide="leaf"></i></span>'),
            ('<span class="sidebar-icon">🚛</span>', '<span class="sidebar-icon"><i data-lucide="megaphone"></i></span>'),
            ('<span class="sidebar-icon">📋</span>', '<span class="sidebar-icon"><i data-lucide="truck"></i></span>'),
            ('<span class="sidebar-icon">💳</span>', '<span class="sidebar-icon"><i data-lucide="file-text"></i></span>'),
            ('<span class="sidebar-icon">⚙</span>', '<span class="sidebar-icon"><i data-lucide="settings"></i></span>'),
            ('<span class="sidebar-icon">❓</span>', '<span class="sidebar-icon"><i data-lucide="help-circle"></i></span>'),
            ('🔔', '<i data-lucide="bell"></i>')
        ]
    },
    {
        'file': 'ui_kits/carrier-web/index.html',
        'changes': [
            ('<link rel="stylesheet" href="../../colors_and_type.css">', '<link rel="stylesheet" href="../../colors_and_type.css">\n<script src="https://unpkg.com/lucide@latest"></script>'),
            ('</body>', '<script>lucide.createIcons();</script>\n</body>'),
            ('<div style="font-size:48px;margin-bottom:16px">🚛</div>', '<div style="font-size:48px;margin-bottom:16px;display:flex;justify-content:center;color:var(--accent)"><i data-lucide="truck" style="width:48px;height:48px"></i></div>')
        ]
    },
    {
        'file': 'preview/components_sidebar.html',
        'changes': [
            ('  <link rel="stylesheet" href="../colors_and_type.css">', '  <link rel="stylesheet" href="../colors_and_type.css">\n  <script src="https://unpkg.com/lucide@latest"></script>'),
            ('</body>', '  <script>lucide.createIcons();</script>\n</body>'),
            ('<span class="nav-icon">●</span>', '<span class="nav-icon"><i data-lucide="layout-dashboard"></i></span>'),
            ('<span class="nav-icon">◆</span>', '<span class="nav-icon"><i data-lucide="store"></i></span>'),
            ('<span class="nav-icon">⊕</span>', '<span class="nav-icon"><i data-lucide="plus-circle"></i></span>'),
            ('<span class="nav-icon">◇</span>', '<span class="nav-icon"><i data-lucide="activity"></i></span>'),
            ('<span class="nav-icon">$</span>', '<span class="nav-icon"><i data-lucide="dollar-sign"></i></span>'),
            ('<span class="nav-icon">⟳</span>', '<span class="nav-icon"><i data-lucide="history"></i></span>'),
            ('<span class="nav-icon">♧</span>', '<span class="nav-icon"><i data-lucide="leaf"></i></span>'),
            ('<span class="nav-icon">▲</span>', '<span class="nav-icon"><i data-lucide="megaphone"></i></span>'),
            ('<span class="nav-icon">▶</span>', '<span class="nav-icon"><i data-lucide="truck"></i></span>'),
            ('<span class="nav-icon">▣</span>', '<span class="nav-icon"><i data-lucide="file-text"></i></span>'),
            ('<span class="nav-icon">⚙</span>', '<span class="nav-icon"><i data-lucide="settings"></i></span>'),
            ('<span class="nav-icon">?</span>', '<span class="nav-icon"><i data-lucide="help-circle"></i></span>')
        ]
    },
    {
        'file': 'preview/components_cards.html',
        'changes': [
            ('  <link rel="stylesheet" href="../colors_and_type.css">', '  <link rel="stylesheet" href="../colors_and_type.css">\n  <script src="https://unpkg.com/lucide@latest"></script>'),
            ('</body>', '  <script>lucide.createIcons();</script>\n</body>'),
            ('<div class="ai-icon">🤖</div>', '<div class="ai-icon"><i data-lucide="bot"></i></div>'),
            ('<div class="role-icon">🏭</div>', '<div class="role-icon"><i data-lucide="factory"></i></div>'),
            ('<div class="role-icon">🚛</div>', '<div class="role-icon"><i data-lucide="truck"></i></div>')
        ]
    }
]

for item in replacements:
    filepath = os.path.join(base_path, item['file'])
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        continue
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    for old, new in item['changes']:
        content = content.replace(old, new)
        
    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

print("Done replacing emojis with lucide icons.")
