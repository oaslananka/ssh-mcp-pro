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

    /* Refined product visual system: calm hierarchy, responsive, low-noise. */
    :root{--bg:#0b1324;--card-bg:#132139;--card-border:#30435c;--text-main:#edf4fc;--text-muted:#b0c0d4;--primary:#5fd4bd;--primary-hover:#90efdc;--blue:#9bcfff;--blue-bg:rgba(96,162,222,.15);--red:#ff98a6}
    body{background:radial-gradient(ellipse 48% 30% at 6% 0%,#14364b,transparent 85%),radial-gradient(ellipse 40% 35% at 92% 10%,#262341,transparent 85%),var(--bg);min-height:100vh;padding-bottom:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
    header{padding:16px clamp(18px,4vw,54px);background:rgba(11,20,35,.86);border-bottom-color:rgba(150,189,225,.15);backdrop-filter:blur(22px)}
    .logo-icon{display:grid;place-items:center;width:42px;height:42px;font-size:22px;background:linear-gradient(140deg,#245d68,#162c49);border:1px solid #4fa5a2;border-radius:13px;box-shadow:0 8px 24px #0003}
    .brand-title{font-size:16px;letter-spacing:-.035em}
    .brand-sub{letter-spacing:.04em;font-size:11px}
    .container{max-width:1240px;margin:38px auto 60px;padding:0 clamp(18px,3vw,36px)}
    .hero{text-align:left;overflow:hidden;position:relative;border-radius:23px;border-color:#345a6c;background:radial-gradient(circle at 90% 12%,rgba(105,224,192,.2),transparent 40%),linear-gradient(125deg,#102c3d,#141e35 65%,#1b2742);padding:clamp(28px,5vw,64px);box-shadow:0 25px 75px #0003}
    .hero h1{font-size:clamp(32px,4.5vw,58px);line-height:1.14;letter-spacing:-.055em;max-width:720px;margin:14px 0 18px}
    .hero p{margin:0 0 25px;max-width:590px;color:#bfcddd;line-height:1.65}
    .hero .device-scope-note{text-align:left !important;margin:16px 0 0}
    .auth-buttons{justify-content:flex-start;gap:12px}
    .auth-btn{border-radius:12px;padding:13px 22px;min-height:46px}
    .card{border-radius:17px;padding:clamp(20px,2.4vw,28px);background:linear-gradient(150deg,#1b2b43,#111e33);box-shadow:inset 0 1px #ffffff0a,0 12px 30px #0001;transition:border-color .2s ease}
    .card:hover{border-color:#44627f}
    .container>.card:first-child{background:linear-gradient(112deg,#173746,#182741 90%) !important;border-color:#3a596a}
    .btn{border-radius:10px;min-height:40px;justify-content:center;font-size:13px}
    .btn-primary{color:#071f23;background:#69ddc4;border-color:#9df4e2}
    .btn-primary:hover{color:#051b1b;background:#93efd9}
    .btn-outline{background:rgba(255,255,255,.03);border-color:#41556f}
    .btn-outline:hover{background:rgba(255,255,255,.08);border-color:#7a98af}
    .badge-green{background:#145a4c;color:#c1fff0}
    .badge-blue{background:#183b56;color:#badfff}
    .tabs{border:0;gap:6px;margin:22px 0 26px}
    .tab-item{border:1px solid transparent;border-radius:10px;padding:10px 16px;min-height:44px;font-size:13px}
    .tab-item.active{color:#c3fff0;background:#23554970;border-color:#377a6c}
    .tab-item:hover:not(.active){background:#ffffff12;color:#fff}
    [hidden]{display:none !important}
    .device-icon{width:54px;height:54px;border-radius:13px;background:#243852;flex-shrink:0}
    .device-meta{font-size:12px;line-height:1.8}
    .code-box{background:#0b1525;border-color:#3c526d;border-radius:11px;color:#b4ffdf}
    .copy-btn{border-radius:7px}
    .eyebrow{color:#88e3ce;font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:.17em;margin-bottom:10px}
    .usage-head{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin:0 0 20px}
    .usage-head h2{font-size:clamp(24px,3vw,32px);letter-spacing:-.04em;line-height:1.2}
    .usage-head p{color:var(--text-muted);margin-top:8px}
    .usage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:22px}
    .usage-stat{background:linear-gradient(150deg,#20364f,#142840);border:1px solid #354e69;border-radius:16px;padding:23px 19px;min-width:0}
    .stat-label{color:#b8cbdf;font-size:12px;font-weight:650}
    .usage-stat strong{display:block;font-size:clamp(26px,3vw,36px);letter-spacing:-.045em;line-height:1.2;margin:12px 0 8px;font-variant-numeric:tabular-nums}
    .usage-stat small{color:#a1b7ce;font-size:11px;line-height:1.5;display:block}
    .usage-table-wrap{overflow:auto;margin-top:14px}
    .usage-table{border-collapse:collapse;width:100%;min-width:580px;text-align:left}
    .usage-table th{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#9fb8d2;border-bottom:1px solid #3c516c;padding:11px 12px}
    .usage-table td{padding:13px 12px;border-bottom:1px solid #2e4059}
    .site-footer{max-width:1240px;margin:50px auto 0;padding:28px clamp(18px,3vw,36px) 38px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid #2a3f58;color:#9bb3ca;font-size:12px}
    .site-footer a{color:#b5dde9;text-underline-offset:3px}
    :focus-visible{outline:2px solid #85efd5;outline-offset:3px}
    @media(max-width:850px){.usage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media(max-width:520px){.container{margin-top:20px;padding:0 14px}.usage-grid{gap:10px}.usage-stat{padding:18px 14px}.tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.tab-item{width:100%;padding:9px}.hero{padding:32px 22px}.auth-btn{width:100%;justify-content:center}.auth-buttons{align-items:stretch}.device-row{align-items:flex-start}header{padding:12px 16px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none !important;animation:none !important;scroll-behavior:auto !important}}
`;
