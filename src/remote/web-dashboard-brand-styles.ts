export const BRAND_STYLES = `
:root{--bg:#090a0d;--card-bg:#12151b;--card-border:#1f2532;--text-main:#ffffff;--text-muted:#8e9bb0;--primary:#0084ff;--primary-hover:#0070d9;--blue:#0084ff;--blue-bg:#132035;--red:#f43f5e}
html{scroll-behavior:smooth}
body{background:#090a0d;color:var(--text-main);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:14px;line-height:1.6;padding-bottom:0;-webkit-font-smoothing:antialiased}
.public-header{position:relative;top:auto;padding:17px clamp(20px,5vw,72px);background:#0d0f14;border-bottom:1px solid #1a202c}
.logo-area{display:flex;align-items:center;gap:13px;text-decoration:none;color:inherit}
.brand-mark{width:46px;height:46px;object-fit:contain;flex-shrink:0;border-radius:9px;box-shadow:0 4px 15px #0006}
.brand-title{display:block;color:#ffffff;font-weight:790;letter-spacing:-.035em;font-size:17px;line-height:1.2}
.brand-sub{display:block;margin-top:4px;color:#8e9bb0;font-size:11px}
.container{max-width:1280px;margin:0 auto;padding:0 clamp(18px,3vw,36px)}
.btn{border-radius:8px;font-size:13px;min-height:40px;padding:9px 16px;justify-content:center;transition:background .16s ease,border-color .16s ease,transform .16s ease}
.btn:hover{transform:translateY(-1px)}
.btn-primary{background:#0084ff;color:#ffffff;border:1px solid #2694ff;font-weight:680}
.btn-primary:hover{background:#0070d9;color:#ffffff}
.btn-outline{background:#161a22;border:1px solid #283244;color:#e2e8f0}
.btn-outline:hover{background:#202634;border-color:#3f4f6b}
.btn-danger{background:#38161f;color:#ff859b;border:1px solid #6b2636}
.btn-danger:hover{background:#541e2c;color:#fff}
.btn-soft{background:#172235;border-color:#2a3d5e;color:#8ac0ff}
.btn-soft:hover{background:#20314d}
.btn-sm{min-height:34px;padding:6px 12px;border-radius:6px}
.card{background:#12151b;border:1px solid #1f2532;border-radius:14px;box-shadow:0 10px 30px #0004;padding:clamp(20px,2.6vw,30px)}
.card:hover{border-color:#2f3a4e}
.card a{color:#389bff}
.code-box{border:1px solid #232b3b;border-radius:8px;background:#090b10;color:#cbd5e1}
.copy-btn{border-radius:6px;background:#1e2636;border-color:#313f57;color:#f1f5f9}
.eyebrow{display:block;font-size:10px;letter-spacing:.14em;font-weight:800;color:#389bff;text-transform:uppercase;margin-bottom:12px}
.mini-spark,.live-indicator{display:inline-block;height:8px;width:8px;border-radius:50%;background:#10b981;box-shadow:0 0 0 4px #10b98126;flex-shrink:0}
.mini-spark{margin-right:8px}
/* Landing: explain actual user tasks; the diagram is illustrative, not fake live data. */
.landing-shell{padding:0 0 76px}
.landing-hero{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(330px,.9fr);align-items:center;gap:clamp(35px,5vw,74px);padding:clamp(48px,7vw,92px) 0 68px}
.landing-copy h1{font-size:clamp(38px,5.1vw,66px);line-height:1.09;letter-spacing:-.057em;font-weight:820;max-width:750px;margin-bottom:25px}
.landing-copy h1 em{color:#7bd9d4;font-style:normal}
.landing-copy>p{color:#baccce;font-size:clamp(15px,1.6vw,17px);line-height:1.77;margin-bottom:26px;max-width:615px}
.landing-copy .landing-small-note{font-size:12px;color:#a3babb;margin-top:18px}
.auth-buttons{display:flex;gap:11px;justify-content:flex-start;flex-wrap:wrap}
.auth-btn{border-radius:10px;display:inline-flex;align-items:center;gap:10px;padding:13px 19px;min-height:52px;font-size:14px}
.auth-btn-google{background:#f4fbf9;color:#182d32;border-color:#f4fbf9}
.auth-btn-github{background:#2b3a40;border-color:#63868b;color:#f4fbf9}
.google-icon{font-weight:900;font-size:18px;color:#4587ed}
.github-icon{font-size:20px}
.landing-illustration{position:relative;isolation:isolate;border:1px solid #568182;border-radius:24px;padding:clamp(24px,4vw,42px);background:radial-gradient(circle at 40% 0%,#306468,transparent 62%),linear-gradient(160deg,#20373d,#142528);box-shadow:0 26px 60px #0004}
.landing-illustration:before{content:"";position:absolute;inset:10px;border:1px solid #ffffff0d;border-radius:18px;pointer-events:none}
.flow-card{position:relative;border:1px solid #537379;background:#1a2d31;border-radius:14px;padding:19px 22px;display:flex;flex-direction:column;gap:4px}
.flow-card strong{font-size:16px;letter-spacing:-.025em}
.flow-card strong span{color:#87dbd8}
.flow-card small{font-size:12px;color:#b4cbcd}
.flow-overline{font-size:10px;letter-spacing:.15em;color:#91e2dc;font-weight:780}
.flow-gateway,.flow-computer{flex-direction:row;align-items:center;gap:17px}
.flow-gateway{background:#295154;border-color:#74c9c3}
.flow-gateway img{border-radius:9px}
.flow-gateway>div strong,.flow-gateway>div small,.flow-computer>div strong,.flow-computer>div small{display:block;line-height:1.4}
.flow-line{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;height:50px;color:#a0f0e3}
.flow-line span{width:1px;height:9px;background:#76b9bb}
.flow-flow-icon{line-height:1}
.flow-computer-icon{display:grid;place-items:center;border:1px solid #668e94;border-radius:11px;background:#304c52;color:#c6e8fa;font-size:25px;width:45px;height:45px;flex:0 0 auto}
.flow-caption{font-size:10px;text-align:center;color:#b2dbd9;margin-top:23px;letter-spacing:.12em;font-weight:760}
.onboarding-section{border-top:1px solid #314a4e;padding:46px 0 40px}
.onboarding-section-head h2{font-size:clamp(28px,3vw,38px);letter-spacing:-.045em}
.onboarding-section-head>p:last-child{color:#b8caca;margin-top:8px}
.onboarding-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:28px}
.onboarding-steps article{background:#1c282b;border:1px solid #365359;border-radius:15px;padding:26px}
.step-number{display:grid;place-items:center;width:43px;height:43px;border-radius:12px;background:#315e62;color:#bcfff4;font-size:14px;font-weight:800;margin-bottom:18px}
.onboarding-steps h3{font-size:19px;letter-spacing:-.02em;margin-bottom:8px}
.onboarding-steps p{color:#b9cdce;font-size:13px}
.landing-local{display:flex;justify-content:space-between;align-items:center;gap:20px;border:1px solid #3c6064;background:#213439;border-radius:16px;padding:26px}
.landing-local>div{display:flex;align-items:center;gap:17px}
.landing-local-symbol{display:grid;place-items:center;width:48px;height:48px;border-radius:12px;background:#356367;color:#dbfaf4;font-size:26px;flex-shrink:0}
.landing-local h2{font-size:16px}
.landing-local p{font-size:13px;color:#b1c8c9;margin-top:4px}
.landing-local code{white-space:nowrap;background:#15272b;border:1px solid #537a7e;color:#bdf7ed;padding:12px 16px;border-radius:10px}
.site-footer{max-width:1280px;margin:auto;padding:29px clamp(18px,3vw,36px) 40px;border-top:1px solid #30474a;display:flex;justify-content:space-between;gap:15px;flex-wrap:wrap;font-size:12px;color:#a3babc}
.site-footer a{color:#acdddd}
/* Signed in: permanent navigation, progress and a working device list. */
.workspace-active .public-header,.workspace-active .site-footer{display:none}
.workspace-active .container{max-width:none;margin:0;padding:0}
.workspace-shell{display:grid;grid-template-columns:252px minmax(0,1fr);min-height:100vh}
.workspace-sidebar{position:sticky;top:0;height:100vh;min-height:550px;padding:28px 18px 20px;background:#151f23;border-right:1px solid #31484b;display:flex;flex-direction:column;gap:4px;z-index:25}
.sidebar-brand{padding:1px 7px 36px;display:flex;align-items:center;gap:12px;color:#fff;text-decoration:none}
.sidebar-brand strong{display:block;font-size:16px;letter-spacing:-.04em;white-space:nowrap}
.sidebar-brand small{display:block;color:#a7c0c1;margin-top:4px;font-size:11px}
.sidebar-label{padding:0 12px;margin-bottom:10px;color:#94aeb2;font-size:10px;letter-spacing:.14em;font-weight:800}
.workspace-nav{display:flex;flex-direction:column;gap:4px}
.workspace-nav-item{display:flex;align-items:center;gap:12px;border:1px solid transparent;border-radius:11px;background:transparent;color:#c0d3d3;min-height:46px;padding:11px 12px;width:100%;text-align:left;font-size:13px;font-weight:680;cursor:pointer}
.workspace-nav-item:hover{background:#263b40;color:#f5ffff}
.workspace-nav-item.active{background:#2e5153;border-color:#518482;color:#e5fffd}
.workspace-nav-icon{display:grid;place-items:center;border-radius:7px;width:26px;height:26px;background:#2b4b4f;color:#a2e9e6;flex-shrink:0;font-size:17px}
.workspace-nav-item.active .workspace-nav-icon{background:#498688;color:#fff}
.sidebar-bottom{margin-top:auto;padding:0 3px}
.sidebar-help{display:flex;align-items:center;gap:9px;padding:14px 8px;color:#b8d3cf;border-bottom:1px solid #375053;font-size:12px}
.sidebar-account{display:flex;align-items:center;gap:10px;padding:18px 3px 15px}
.account-avatar{width:37px;height:37px;border-radius:11px;background:#396e70;color:#e4fff8;display:grid;place-items:center;font-weight:800;font-size:15px;flex-shrink:0}
.sidebar-account-text{flex:1;min-width:0}
.sidebar-account-text strong{display:block;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sidebar-account-text small{display:block;color:#a5bdc0;font-size:11px}
.sidebar-signout{font-size:11px;font-weight:700;color:#b5d2d0;text-decoration:none;padding:6px 4px;white-space:nowrap}
.sidebar-links{display:flex;gap:17px;font-size:11px;padding:12px 6px}
.sidebar-links a{color:#a2bcbc;text-decoration:none}
.workspace-main{margin:0 auto;width:100%;max-width:1530px;min-width:0;padding:0 clamp(20px,4vw,74px) 70px}
.workspace-topbar{border-bottom:1px solid #33474b;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:13px;padding:24px 0}
.workspace-breadcrumb,.workspace-top-status{font-size:12px;color:#a9c1c0}
.workspace-breadcrumb span{color:#749194;padding:0 8px}
.workspace-top-status{display:flex;align-items:center;gap:10px}
.workspace-page-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;flex-wrap:wrap;margin:42px 0 30px}
.workspace-page-heading .eyebrow{font-size:10px;margin-bottom:7px}
.workspace-page-heading h1{font-size:clamp(30px,3.3vw,43px);letter-spacing:-.052em;line-height:1.16}
.workspace-page-heading p:last-child{color:#b7cacc;font-size:14px;max-width:650px;margin-top:8px}
.connection-summary{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:19px;border:1px solid #547b7c;border-radius:16px;background:linear-gradient(110deg,#2a5255,#21363a);padding:19px 22px;margin-bottom:22px}
.connection-summary-primary{display:flex;align-items:center;gap:15px}
.summary-pulse{display:grid;place-items:center;background:#397174;border-radius:13px;width:46px;height:46px;flex-shrink:0}
.summary-pulse:after{content:"●";color:#a2ffed;font-size:18px}
.connection-summary strong{display:block;font-weight:760;font-size:15px}
.connection-summary-primary span:last-child{display:block;color:#b9d0d1;font-size:12px;margin-top:4px}
.device-scope-note{color:#afc4c4;font-size:12px;margin:13px 0 18px}
.device-list-card{padding:0;overflow:visible}
.device-list-heading{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:22px 25px;border-bottom:1px solid #365154}
.device-list-heading h2{font-size:17px;letter-spacing:-.028em}
.device-list-tools{display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.device-list-heading p{font-size:12px;color:#acc5c4;margin-top:4px}
.device-entry{border-bottom:1px solid #365154;position:relative}
.device-entry:last-child{border-bottom:0}
.device-row{padding:22px 25px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.device-info{display:flex;align-items:center;gap:16px;min-width:0}
.device-icon{display:grid;place-items:center;width:48px;height:48px;border:1px solid #5a8087;border-radius:12px;background:#2f5358;color:#b6f1ef;font-size:24px;flex-shrink:0}
.device-ident{min-width:0}
.device-name{font-size:15px;font-weight:760;letter-spacing:-.02em;overflow-wrap:anywhere}
.device-meta{font-size:11px;color:#b5c8c8;line-height:1.6;margin-top:5px;overflow-wrap:anywhere}
.device-row-status{display:flex;gap:19px;align-items:center;margin-left:auto}
.status-pill{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:8px;background:#504239;color:#eed3b8;font-size:11px;font-weight:760;white-space:nowrap}
.status-pill>span{height:7px;width:7px;border-radius:50%;background:#dfbd9c}
.status-pill.online{background:#255744;color:#b6f7d5}
.status-pill.online>span{background:#6aeab1}
.device-controls{position:relative}
.device-controls summary{list-style:none;display:inline-flex;align-items:center;gap:9px;border:1px solid #58777d;border-radius:9px;background:#2c3d42;color:#f1fafa;padding:8px 13px;min-height:38px;cursor:pointer;font-size:12px;font-weight:720}
.device-controls summary::-webkit-details-marker{display:none}
.device-control-panel{position:absolute;top:calc(100% + 10px);right:0;z-index:50;width:min(350px,90vw);padding:22px;border:1px solid #639199;border-radius:14px;background:#213338;box-shadow:0 18px 54px #0009}
.device-control-panel h3{font-size:15px;margin-bottom:7px}
.device-control-panel p{font-size:12px;color:#bbd0d0;margin-bottom:15px}
.device-control-panel label{display:block;font-size:12px;font-weight:730;margin-bottom:9px}
.device-control-panel select{display:block;width:100%;margin-bottom:14px}
.device-control-actions{display:flex;gap:9px;flex-wrap:wrap}
.device-offline-tip{padding:12px 25px;background:#343432;color:#e0d3bd;border-top:1px solid #465454;font-size:12px}
.device-offline-tip a{color:#a2e7ee}
.feedback-error{padding:33px;border-color:#99616b;background:linear-gradient(115deg,#32262d,#222b30)}
.feedback-error h2{font-size:21px;letter-spacing:-.03em;margin-bottom:8px}
.feedback-error p{color:#ebcfd0;font-size:13px;margin-bottom:20px;max-width:650px}
.device-loading{min-height:123px;display:grid;place-items:center;color:#bbd3d2}
.onboarding-empty{padding:55px 20px;text-align:center}
.onboarding-empty h2{font-size:25px;letter-spacing:-.03em;margin-bottom:12px}
.onboarding-empty p{color:#b3c8c8;max-width:480px;margin:0 auto 26px;font-size:14px}
.empty-art{position:relative;width:78px;height:75px;display:grid;place-items:center;font-size:36px;border-radius:20px;background:#315d60;border:1px solid #649a9e;color:#b8f7ef;margin:0 auto 25px}
.empty-plus{position:absolute;right:-10px;bottom:-9px;width:32px;height:32px;border:3px solid #1c2529;border-radius:10px;background:#8ce8e0;color:#153f40;font-size:20px;font-weight:900}
.empty-next-step{color:#a4bdbd;font-size:12px;margin-top:21px}
.usage-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:21px}
.usage-stat{background:#21363a;border:1px solid #4b7073;border-radius:15px;padding:22px 18px}
.usage-stat strong{font-size:clamp(26px,3vw,36px);margin:10px 0 7px;display:block;letter-spacing:-.05em}
.stat-label{color:#b8dddd}
.usage-stat small{color:#b0c9cb}
.usage-table th{color:#a2cacb;border-bottom-color:#4b6063}
.usage-table td{border-bottom-color:#364b4f}
.grid-2{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:17px}
input,select{color-scheme:dark}
:focus-visible{outline:2px solid #a3f5e9 !important;outline-offset:3px}
[hidden]{display:none !important}
@media(max-width:1080px){.landing-hero{grid-template-columns:1fr;max-width:910px;margin:auto}.landing-illustration{max-width:620px;width:100%;margin:auto}.usage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width: 860px){.workspace-shell{display:block}.workspace-sidebar{position:relative;height:auto;min-height:0;padding:15px 20px;border-right:0;border-bottom:1px solid #3b5357;display:block}.sidebar-brand{padding:0 0 15px}.sidebar-label,.sidebar-bottom{display:none}.workspace-nav{flex-direction:row;overflow-x:auto;gap:5px;scrollbar-width:thin}.workspace-nav-item{min-width:max-content;width:auto;padding:9px 12px;min-height:44px;white-space:nowrap}.workspace-main{padding:0 22px 55px}.workspace-topbar{padding:17px 0}.workspace-page-heading{margin-top:30px}}
@media(max-width:640px){.public-header{padding:14px 17px}.brand-sub{display:none}.landing-hero{padding:40px 0;gap:30px}.landing-copy h1{font-size:clamp(35px,9vw,47px)}.landing-illustration{padding:23px 19px}.auth-buttons{flex-direction:column;align-items:stretch}.auth-btn{justify-content:center}.onboarding-steps{grid-template-columns:1fr}.landing-local{flex-direction:column;align-items:stretch}.landing-local code{text-align:center;white-space:normal;overflow-wrap:anywhere}.workspace-main{padding:0 16px 46px}.workspace-page-heading{flex-direction:column;align-items:stretch}.workspace-page-heading>.btn{width:100%}.connection-summary{flex-direction:column;align-items:stretch;padding:18px}.connection-summary>.btn{width:100%}.device-row{padding:19px 16px}.device-row-status{width:100%;justify-content:space-between;margin:4px 0 0}.device-list-heading{padding:18px 16px}.usage-grid{gap:10px}.usage-stat{padding:15px 12px}.site-footer{padding-inline:18px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{transition:none !important;animation:none !important}}

/* Device setup: steps stay in view while details remain progressive. */

.os-chooser{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:13px;margin-bottom:23px}
.os-chooser>span{font-size:13px;color:#d9eaea;font-weight:730}
.os-chooser-options{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.os-choice{min-height:42px;padding:9px 14px;border-radius:10px;border:1px solid #4b696d;background:#263a3d;color:#c6d8d7;font-size:12px;font-weight:730;cursor:pointer}
.os-choice.active,.os-choice[aria-pressed="true"]{border-color:#81d9d5;background:#345d60;color:#d9fffa}
.os-choice:hover{border-color:#89bbb8}
.setup-intro{padding:26px 28px;margin-bottom:20px;background:linear-gradient(115deg,#254549,#1b2b30);border-radius:17px;border:1px solid #4c777c}
.setup-intro h2{font-size:22px;letter-spacing:-.038em;line-height:1.25}
.setup-intro>p:not(.eyebrow){color:#bbd3d1;font-size:13px;margin-top:8px;max-width:640px}
.setup-steps{display:flex;flex-wrap:wrap;gap:10px;margin-top:24px}
.setup-steps span{display:inline-flex;align-items:center;gap:8px;padding:9px 13px;border-radius:10px;border:1px solid #52797a;background:#254247;color:#d6eeec;font-size:12px}
.setup-steps strong{display:grid;place-items:center;background:#3a6f70;border-radius:7px;width:27px;height:27px;color:#d3faf6;font-size:11px}
.setup-main-card{background:#1e2b2e}
.setup-main-card h2{letter-spacing:-.025em}
.setup-main-card input,.setup-main-card select{min-height:45px;border-radius:10px!important;border:1px solid #56777b!important;background:#142326!important;color:#eafaf8!important;padding:12px!important}
.setup-main-card .code-box{border-color:#49676b}
.setup-main-card #enrollOutput{padding-top:25px;border-top:1px solid #3a5558}
/* AI connections: one shared endpoint first, platform-specific examples second. */
.integration-feature{padding:28px 30px;background:linear-gradient(110deg,#285255,#22373d);border:1px solid #568487;border-radius:17px;margin-bottom:18px}
.integration-feature h2{font-size:23px;letter-spacing:-.038em;line-height:1.25}
.integration-feature>p:not(.eyebrow){font-size:13px;color:#c0d8d7;max-width:650px;margin:10px 0 20px}
.connection-url{max-width:900px;font-size:14px;overflow-wrap:anywhere;padding:18px 108px 18px 18px}
.platform-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:15px;margin:0 0 18px}
.platform-card{padding:25px 23px;border:1px solid #3f575b;border-radius:16px;background:#1d2a2e;min-height:230px}
.platform-card h3{font-size:18px;margin:14px 0 9px;letter-spacing:-.02em}
.platform-card p{font-size:13px;color:#bdcdcf;line-height:1.72}
.platform-card small{display:block;margin-top:17px;color:#93b4b5;font-size:11px}
.platform-symbol{display:grid;place-items:center;width:42px;height:42px;border-radius:11px;font-size:23px;background:#345451;color:#aaf7df}
.platform-symbol.claude{background:#6b4b42;color:#ffe1c4}
.platform-symbol.gemini{background:#3c4e70;color:#d6daff}
.integration-next{display:flex;align-items:flex-start;gap:13px;background:#20383a;border:1px solid #3f5d60;border-radius:12px;padding:15px 18px;margin:0 0 21px}
.integration-next .live-indicator{margin-top:6px}
.integration-next p{font-size:12px;color:#c4d7d6}
.advanced-integrations{background:#1c282b;border:1px solid #385255;border-radius:15px;overflow:hidden}
.advanced-integrations>summary{list-style:none;cursor:pointer;font-weight:720;font-size:13px;padding:19px 23px;display:flex;align-items:center;justify-content:space-between;gap:14px}
.advanced-integrations>summary::-webkit-details-marker{display:none}
.advanced-integrations[open]>summary{border-bottom:1px solid #3e5b5d}
.advanced-integrations>.grid-2{padding:19px;gap:15px}
.device-list-tools{display:flex;gap:9px;flex-wrap:wrap}
@media(max-width:930px){.platform-grid{grid-template-columns:1fr}.platform-card{min-height:0}}
@media(max-width:640px){.setup-intro,.integration-feature{padding:21px 17px}.connection-url{font-size:12px;padding-right:98px}.advanced-integrations>.grid-2{padding:12px}}
`;
