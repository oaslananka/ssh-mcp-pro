export const DASHBOARD_STYLES = `
    :root {
      --bg: #0d1117;
      --card-bg: #161b22;
      --card-border: #30363d;
      --text-main: #f0f6fc;
      --text-muted: #8b949e;
      --primary: #238636;
      --primary-hover: #2ea043;
      --blue: #58a6ff;
      --blue-bg: rgba(56, 139, 253, 0.15);
      --red: #f85149;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      line-height: 1.5;
      padding-bottom: 60px;
    }
    header {
      background: #161b22;
      border-bottom: 1px solid var(--card-border);
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
      position: sticky;
      top: 0;
      z-index: 100;
    }
    .logo-area { display: flex; align-items: center; gap: 12px; }
    .logo-icon { font-size: 24px; }
    .brand-title { font-size: 18px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
    .brand-sub { font-size: 12px; color: var(--text-muted); }
    .user-area { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-width: 0; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge-green { background: #238636; color: #fff; }
    .badge-gray { background: #30363d; color: #c9d1d9; }
    .badge-blue { background: var(--blue-bg); color: var(--blue); border: 1px solid rgba(56,139,253,0.3); }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      border: 1px solid transparent;
      transition: all 0.2s ease;
    }
    .btn-primary { background: var(--primary); color: #fff; border-color: rgba(240,246,252,0.1); }
    .btn-primary:hover { background: var(--primary-hover); }
    .btn-outline { background: transparent; color: var(--text-main); border-color: var(--card-border); }
    .btn-outline:hover { background: #21262d; border-color: #8b949e; }
    .btn-danger { background: rgba(248,81,73,0.1); color: var(--red); border-color: rgba(248,81,73,0.4); }
    .btn-danger:hover { background: var(--red); color: #fff; }
    .btn-sm { padding: 4px 10px; font-size: 12px; }

    .container { max-width: 1100px; margin: 32px auto; padding: 0 20px; }

    /* Hero banner */
    .hero {
      background: linear-gradient(180deg, #161b22 0%, #0d1117 100%);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 48px 32px;
      text-align: center;
      margin-bottom: 32px;
    }
    .hero h1 { font-size: 32px; font-weight: 800; margin-bottom: 12px; color: #fff; }
    .hero p { font-size: 16px; color: var(--text-muted); max-width: 650px; margin: 0 auto 28px; }
    .auth-buttons { display: flex; justify-content: center; gap: 16px; flex-wrap: wrap; }
    .auth-btn {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 24px;
      border-radius: 8px;
      font-weight: 600;
      font-size: 15px;
      text-decoration: none;
      border: 1px solid transparent;
      transition: transform 0.15s ease;
    }
    .auth-btn:hover { transform: translateY(-2px); }
    .auth-btn-google { background: #ffffff; color: #1f2937; border-color: #d1d5db; }
    .auth-btn-github { background: #24292f; color: #ffffff; border-color: #30363d; }

    /* Tab nav */
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; border-bottom: 1px solid var(--card-border); margin-bottom: 24px; }
    .tab-item {
      background: transparent;
      border: 0;
      font-family: inherit;
      text-align: left;
      padding: 12px 20px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
      color: var(--text-muted);
      border-bottom: 2px solid transparent;
      transition: color 0.15s ease;
    }
    .tab-item.active { color: var(--blue); border-bottom-color: var(--blue); }
    .tab-item:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }

    /* Device Cards */
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 16px;
    }
    .device-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 16px;
    }
    .device-info { display: flex; align-items: center; flex: 1 1 260px; min-width: 0; gap: 16px; }
    .device-info > div:last-child { min-width: 0; }
    .device-icon {
      font-size: 28px;
      width: 48px;
      height: 48px;
      background: #21262d;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .device-name { font-size: 16px; font-weight: 700; margin-bottom: 4px; display: flex; align-items: center; flex-wrap: wrap; overflow-wrap: anywhere; gap: 8px; }
    .device-meta { font-size: 13px; color: var(--text-muted); font-family: var(--font-mono); overflow-wrap: anywhere; }
    .device-scope-note { font-size: 13px; color: var(--text-muted); margin: 0 0 16px; line-height: 1.5; }
    .device-scope-note strong { color: var(--text); }
    .device-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }

    /* Code block */
    .code-box {
      background: #090d13;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 14px 18px;
      font-family: var(--font-mono);
      font-size: 13px;
      color: #7ee787;
      overflow-x: auto;
      margin: 12px 0;
      position: relative;
    }
    .code-box > span {
      display: block;
      padding-right: 52px;
      overflow-wrap: anywhere;
    }
    .card a { color: var(--blue); text-underline-offset: 2px; }
    .card a:hover { color: #b0d4ff; }
    .copy-btn {
      position: absolute;
      top: 8px;
      right: 8px;
      padding: 4px 8px;
      font-size: 11px;
      background: #21262d;
      color: #c9d1d9;
      border: 1px solid #30363d;
      border-radius: 4px;
      cursor: pointer;
    }
    .copy-btn:hover { background: #30363d; color: #fff; }
    .copy-btn:focus-visible { outline: 2px solid var(--blue); outline-offset: 2px; }

    /* Config guide cards */
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr)); gap: 20px; }
    @media (max-width: 480px) {
      .container { margin: 20px auto; padding: 0 12px; }
      .hero { padding: 28px 18px; }
      .hero h1 { font-size: 26px; }
      .device-actions { width: 100%; }
      .device-actions select { width: 100%; min-width: 0; }
    }

    /* Empty state */
    .empty-box {
      text-align: center;
      padding: 48px 16px;
      color: var(--text-muted);
    }
`;
