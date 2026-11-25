import { DEVICE_WIZARD_STYLES } from "./web-dashboard-device-wizard-styles.js";

export const EXPERIENCE_STYLES = `
/* ssh-mcp-pro · Dark Theme & Modern Control Plane UI.
   Focus: high contrast, zero-latency feedback, elegant dark card aesthetic. */
:root {
  --accent-blue:#3478f6;
  --surface-primary:#171b2a;
  --action-blue:#0084ff;
  --action-blue-hover:#0070d9;
  --accent-blue-hover:#1a90ff;
  --accent-cyan:#38bdf8;
  --surface-secondary:#0c0e12;
  --surface-raised:#171b24;
  --border-soft:#1e2430;
  --border-active:#2f384c;
  --text-strong:#ffffff;
  --text-secondary:#8e9bb0;
  --muted:#647083;
  --bg:#090a0d;
  --card-bg:var(--surface-primary);
  --card-border:var(--border-soft);
  --text-main:var(--text-strong);
  --text-muted:var(--text-secondary);
  --primary:var(--action-blue);
  --primary-hover:var(--action-blue-hover);
  --blue:#0084ff;
  --blue-bg:rgba(0,132,255,0.12);
  --red:#f43f5e;
  --green:#10b981;
}
html {color-scheme:dark}
body {
  background:#090a0d;
  color:var(--text-strong);
  font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
  letter-spacing:-.006em;
}
.public-header {
  background:#0c0e12;
  border-bottom:1px solid #1a202c;
  padding-block:18px;
}
.brand-mark{border-radius:10px;box-shadow:0 4px 20px rgba(0,132,255,0.2)}
.brand-title{font-size:17px;font-weight:780;letter-spacing:-.035em;color:#fff}
.brand-sub{color:#8e9bb0}
.logo-area:hover .brand-title,.sidebar-brand:hover strong{color:#40a2ff}
.btn{min-height:38px;border-radius:8px;font-weight:650;letter-spacing:-.01em}
.btn-primary {
  background:#0084ff;
  border:1px solid #1f8eff;
  box-shadow:0 2px 10px rgba(0,132,255,0.3);
  color:#fff;
}
.btn-primary:hover{background:#0070d9;color:#fff;border-color:#389cff;box-shadow:0 4px 16px rgba(0,132,255,0.4)}
.btn-primary:active{transform:translateY(1px);box-shadow:0 1px 4px rgba(0,132,255,0.3)}
.btn-soft{background:#152033;border-color:#243654;color:#7ebbff}
.btn-soft:hover{background:#1d2c47;border-color:#3b5685}
.btn-outline{background:#141720;border:1px solid #242c3d;color:#e2e8f0}
.btn-outline:hover{background:#1c212e;border-color:#384661;color:#fff}
.btn-danger{background:#38151f;border-color:#632332;color:#ff96aa}
.btn-danger:hover{background:#541c2a;border-color:#8a2f44;color:#fff}
.card{background:#12151c;border-color:#1e2430;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,0.3)}
.card:hover{border-color:#2a3344}
.card a,.site-footer a{color:#0084ff}
.card a:hover,.site-footer a:hover{color:#389cff}
.code-box{background:#080a0e;border-color:#1c2230;color:#cbd5e1}
.copy-btn{background:#1c2230;border-color:#2c364c;color:#f1f5f9}
.copy-btn:hover{background:#273044}
.eyebrow{color:#0084ff;letter-spacing:.13em}
.mini-spark{background:#0084ff;box-shadow:0 0 0 4px rgba(0,132,255,0.2)}
.live-indicator{background:#10b981;box-shadow:0 0 0 4px rgba(16,185,129,0.2)}
.landing-shell{background:radial-gradient(ellipse 50% 35% at 80% 12%,rgba(0,132,255,0.15),transparent 75%);padding-bottom:68px}
.landing-hero{grid-template-columns:minmax(0,1.13fr) minmax(340px,.87fr);gap:clamp(40px,6vw,92px);padding:clamp(64px,8vw,108px) 0 82px}
.landing-copy h1{font-size:clamp(41px,5.3vw,72px);letter-spacing:-.068em;max-width:740px;font-weight:820}
.landing-copy h1 em{
  background:linear-gradient(95deg,#ffffff 5%,#7ebbff 50%,#0084ff 90%);
  -webkit-background-clip:text;
  background-clip:text;
  color:transparent;
}
.landing-copy>p{color:#8e9bb0;line-height:1.75}
.landing-small-note{color:#647083!important}
.auth-btn{border-radius:10px;font-weight:700;transition:transform .18s ease,box-shadow .18s ease}
.auth-btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,0.5)}
.auth-btn-google{border:1px solid #222938;background:#f8fafc;color:#0f172a}
.auth-btn-github{border:1px solid #2d374a;background:#151821;color:#f8fafc}
.landing-specs{display:flex;flex-wrap:wrap;gap:8px;margin-top:20px}
.spec-pill{display:inline-flex;align-items:center;gap:7px;background:#11141b;border:1px solid #1e2532;border-radius:6px;padding:6px 11px;font-size:11px;font-weight:600;color:#94a3b8}
.spec-dot{width:6px;height:6px;border-radius:50%;background:#10b981;box-shadow:0 0 6px rgba(16,185,129,0.5)}
.landing-illustration{
  background:linear-gradient(154deg,#141924,#0c0e14 72%);
  border:1px solid #252e3f;
  border-radius:22px;
  box-shadow:0 30px 70px rgba(0,0,0,0.6);
}
.flow-card{background:#11141b;border:1px solid #202736}
.flow-card strong{color:#fff}
.flow-card small{color:#8e9bb0}
.flow-overline{color:#0084ff}
.flow-gateway{background:#131c2b;border-color:#25508a;box-shadow:0 0 25px rgba(0,132,255,0.15)}
.flow-line{color:#0084ff}
.flow-line span{background:#0084ff}
.flow-card strong span{color:#7ebbff}
.flow-computer-icon{background:#151b27;border-color:#2a364d;color:#94a3b8}
.flow-caption{color:#647083}
.onboarding-section{border-top:1px solid #1a202c}
.onboarding-steps article{background:#11141b;border:1px solid #1e2430;border-radius:14px}
.onboarding-steps article:hover{transform:translateY(-2px);border-color:#323e54}
.step-number{background:#152236;color:#7ebbff}
.onboarding-steps p{color:#8e9bb0}
.landing-local{background:#11141b;border:1px solid #1e2430}
.landing-local-symbol{background:#161d2b;color:#7ebbff}
.landing-local p{color:#8e9bb0}
.landing-local code{background:#080a0e;border-color:#1c2230;color:#cbd5e1}
.site-footer{border-top:1px solid #1a202c;color:#647083}

/* Workspace Layout: sleek deep dark theme */
.workspace-active{background:#090a0d}
.workspace-shell{grid-template-columns:240px minmax(0,1fr)}
.workspace-sidebar{
  background:#0c0e12;
  border-right:1px solid #1a202c;
  padding:24px 14px 20px;
}
.sidebar-brand{padding-bottom:30px}
.sidebar-brand strong{letter-spacing:-.04em;font-size:16px}
.sidebar-brand small{color:#647083}
.sidebar-label{color:#647083;letter-spacing:.15em;font-size:10px}
.workspace-nav{gap:3px}
.workspace-nav-item{
  border-radius:8px;
  min-height:40px;
  color:#8e9bb0;
  font-weight:600;
  padding:8px 12px;
  transition:all 0.15s ease;
}
.workspace-nav-item:hover{background:#131720;color:#ffffff}
.workspace-nav-item.active{
  color:#ffffff;
  background:#131c2a;
  border-color:#1e3250;
  box-shadow:none;
}
.workspace-nav-icon{background:transparent;color:#647083;border-radius:6px;font-size:18px}
.workspace-nav-item.active .workspace-nav-icon{background:transparent;color:#0084ff}

/* Sidebar Bottom: Usage Widget & Account */
.sidebar-bottom{margin-top:auto;padding-top:10px}
.sidebar-usage-widget{
  background:#11141b;
  border:1px solid #1c2230;
  border-radius:10px;
  padding:12px 14px;
  margin-bottom:12px;
}
.sidebar-usage-header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-size:11px;
  margin-bottom:6px;
}
.sidebar-usage-label{color:#8e9bb0;font-weight:500}
.sidebar-usage-pct{color:#ffffff;font-weight:700}
.sidebar-progress-track{
  height:4px;
  background:#1c2230;
  border-radius:2px;
  overflow:hidden;
  margin-bottom:8px;
}
.sidebar-progress-fill{
  height:100%;
  background:#0084ff;
  border-radius:2px;
  transition:width .3s ease;
}
.sidebar-usage-detail{font-size:11px;color:#8e9bb0;line-height:1.35}
.sidebar-usage-reset{font-size:11px;color:#647083;margin-top:2px}
.sidebar-upgrade-btn{
  width:100%;
  background:#0084ff;
  color:#ffffff;
  border:none;
  border-radius:6px;
  padding:7px 0;
  font-size:12px;
  font-weight:700;
  margin-top:10px;
  cursor:pointer;
  transition:background .15s ease;
  display:block;
  text-align:center;
  text-decoration:none;
}
.sidebar-upgrade-btn:hover{background:#0070d9}
.sidebar-account{display:flex;align-items:center;gap:10px;padding:12px 4px 10px}
.account-avatar{width:32px;height:32px;border-radius:50%;background:#192438;color:#0084ff;font-weight:700;font-size:13px}
.sidebar-account-text strong{font-size:12px;color:#fff}
.sidebar-account-text small{color:#647083}
.sidebar-signout{color:#647083;font-size:11px}
.sidebar-signout:hover{color:#fff}
.sidebar-links{display:flex;gap:12px;font-size:11px;padding:8px 4px 0}
.sidebar-links a{color:#647083;text-decoration:none}
.sidebar-links a:hover{color:#8e9bb0}

.workspace-main{max-width:1180px;padding-inline:clamp(20px,4vw,60px)}
.workspace-topbar{border-color:#1a202c;padding:18px 0}
.workspace-breadcrumb,.workspace-top-status{color:#647083;font-size:12px}
.workspace-page-heading{margin:36px 0 24px}
.workspace-page-heading h1{font-size:28px;letter-spacing:-.04em;font-weight:700;color:#fff}
.workspace-page-heading p:last-child{color:#8e9bb0;font-size:13px}

/* Devices Tab */
.connection-summary{
  background:#11141b;
  border:1px solid #1c2230;
  border-radius:12px;
}
.summary-pulse{background:#152236}
.summary-pulse:after{color:#0084ff}
.device-list-heading{border-color:#1a202c}
.device-entry{border-bottom-color:#1a202c}
.device-icon{background:#141a26;border-color:#202a3d;color:#7ebbff}
.status-pill.online{background:rgba(16,185,129,0.15);color:#10b981}
.status-pill.offline{background:rgba(244,63,94,0.12);color:#fb7185}
.status-pill.revoked{background:#34232d;color:#ffb5c1}
.status-pill.pending{background:#343123;color:#f7d78b}
.status-pill.revoked>span{background:#ffb5c1}
.status-pill.pending>span{background:#f7d78b}
.device-controls summary{background:#141720;border-color:#202738;color:#cbd5e1}
.device-control-panel{background:#0e1117;border-color:#1f2636}
.device-controls > summary.device-row{display:flex;position:static;min-height:64px;padding:18px 24px;border:0;border-radius:0;background:transparent;gap:14px;text-align:left;cursor:pointer}
.device-controls > summary.device-row:hover{background:#181d28}
.device-controls > summary.device-row:focus-visible{outline-offset:-3px}
.device-controls[open] > summary.device-row{background:#181d28}
.device-manage-label{display:inline-flex;gap:8px;align-items:center;color:#b7d4ff;font-size:13px;min-height:44px}
.device-controls[open] .device-manage-label > span{transform:rotate(180deg)}
.device-control-panel{position:static;width:auto;margin:0 24px 18px;padding:18px;border-radius:10px;box-shadow:none}
.device-control-panel select,.device-control-actions .btn{min-height:44px}
.device-control-actions{border-top:1px solid #293343;padding-top:14px}
.device-meta{display:block;font-family:inherit;font-size:13px;color:#b1bfd2}
.device-notice{padding:12px 16px;border:1px solid #39536c;background:#142235;color:#dcecff;border-radius:9px;margin-bottom:16px;overflow-wrap:anywhere}
.device-action-dialog{position:fixed;inset:0;margin:auto;max-width:min(440px,calc(100% - 32px));max-height:calc(100% - 32px);overflow:auto;padding:24px;border:1px solid #3a455c;border-radius:14px;background:#171b24;color:#f1f5f9;box-shadow:0 24px 70px #0009}
.device-action-dialog::backdrop{background:#000a}
.device-action-dialog h2{font-size:21px;margin-bottom:12px;overflow-wrap:anywhere}
.device-action-dialog p{font-size:14px;line-height:1.6;color:#c3cedf;overflow-wrap:anywhere}
#deviceActionFeedback{color:#ffb5c1;margin-top:12px}
.device-dialog-actions{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:10px;margin-top:20px}
.device-dialog-actions .btn{min-height:44px}


/* Usage Page (matching Desktop Commander Screenshot 1) */
.usage-banner {
  background:#12151c;
  border:1px solid #1e2430;
  border-radius:12px;
  padding:18px 24px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:16px;
  margin-bottom:16px;
}
.usage-banner h3 {
  font-size:14px;
  font-weight:650;
  color:#ffffff;
  margin-bottom:3px;
}
.usage-banner p {
  font-size:12px;
  color:#8e9bb0;
}
.usage-banner-btn {
  background:#161a22;
  border:1px solid #283244;
  color:#ffffff;
  border-radius:8px;
  padding:8px 16px;
  font-size:13px;
  font-weight:600;
  cursor:pointer;
  white-space:nowrap;
  transition:all .15s ease;
}
.usage-banner-btn:hover {
  background:#202734;
  border-color:#3f4f6b;
}
.usage-stat-grid {
  display:grid;
  grid-template-columns:1.4fr 1fr;
  gap:16px;
  margin-bottom:16px;
}
.usage-card {
  background:#12151c;
  border:1px solid #1e2430;
  border-radius:12px;
  padding:20px 24px;
}
.usage-card-label {
  font-size:12px;
  color:#8e9bb0;
  margin-bottom:12px;
  font-weight:500;
}
.usage-stat-val {
  display:flex;
  align-items:baseline;
  gap:6px;
}
.stat-number-big {
  font-size:30px;
  font-weight:700;
  color:#ffffff;
  letter-spacing:-0.03em;
}
.stat-number-limit {
  font-size:14px;
  color:#647083;
  font-weight:500;
}
.usage-progress-bar {
  height:6px;
  background:#1c2230;
  border-radius:3px;
  overflow:hidden;
  margin:14px 0 10px;
}
.usage-progress-fill {
  height:100%;
  background:#0084ff;
  border-radius:3px;
  transition:width 0.3s ease;
}
.usage-card-footer {
  font-size:12px;
  color:#647083;
}
.chart-card {
  background:#12151c;
  border:1px solid #1e2430;
  border-radius:12px;
  padding:22px 24px;
  margin-bottom:16px;
}
.chart-card h3 {
  font-size:15px;
  font-weight:600;
  color:#ffffff;
}
.chart-card p {
  font-size:12px;
  color:#647083;
  margin-top:3px;
  margin-bottom:24px;
}
.barchart-container {
  display:flex;
  height:190px;
  position:relative;
  padding-left:55px;
  padding-bottom:30px;
}
.barchart-y-axis {
  position:absolute;
  left:0;
  top:0;
  bottom:30px;
  width:45px;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  font-size:11px;
  color:#647083;
  text-align:right;
}
.barchart-grid-lines {
  position:absolute;
  left:55px;
  right:0;
  top:0;
  bottom:30px;
  display:flex;
  flex-direction:column;
  justify-content:space-between;
  pointer-events:none;
}
.barchart-grid-line {
  width:100%;
  height:1px;
  background:#1a202c;
}
.barchart-bars {
  display:flex;
  flex:1;
  justify-content:space-around;
  align-items:flex-end;
  height:100%;
  position:relative;
  z-index:1;
}
.barchart-col {
  display:flex;
  flex-direction:column;
  align-items:center;
  height:100%;
  justify-content:flex-end;
  width:50px;
}
.barchart-bar {
  width:48px;
  background:#0084ff;
  border-radius:4px 4px 0 0;
  min-height:4px;
  transition:height 0.3s ease,filter 0.2s ease;
}
.barchart-bar:hover {
  filter:brightness(1.15);
}
.barchart-label {
  position:absolute;
  bottom:-24px;
  font-size:11px;
  color:#8e9bb0;
}

${DEVICE_WIZARD_STYLES}/* Product stage & terminal preview */
.product-stage{
  position:relative;
  padding:30px 26px 26px;
  background:radial-gradient(ellipse 75% 45% at 50% 15%,rgba(0,132,255,0.15),transparent 88%),linear-gradient(145deg,#131822,#0a0c10);
  border:1px solid #1e2838;
  border-radius:24px;
  box-shadow:0 30px 80px rgba(0,0,0,0.6);
  overflow:hidden;
}
.stage-overline{font-size:10px;letter-spacing:.14em;font-weight:800;color:#0084ff;margin-bottom:17px}
.stage-clients{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;position:relative;z-index:1}
.assistant-chip{
  display:flex;flex-direction:column;gap:7px;align-items:center;justify-content:center;
  background:linear-gradient(#151922,#0f1218);border:1px solid #1f2736;border-radius:12px;
  min-height:92px;padding:12px 7px;color:#ffffff;font-size:12px;font-weight:700;white-space:nowrap;
  transition:transform .2s ease,border-color .2s ease;
}
.assistant-chip:hover{transform:translateY(-2px);border-color:#0084ff}
.chip-status{font-size:9px;font-weight:600;color:#647083}
.assistant-mark{width:28px;height:28px;display:grid;place-items:center;border-radius:8px;background:#1e2636;color:#7ebbff;font-size:20px}
.stage-connector{height:41px;display:flex;align-items:center;justify-content:center;position:relative}
.stage-connector span{height:1px;width:35%;max-width:140px;background:linear-gradient(90deg,transparent,#0084ff)}
.stage-connector span:last-child{background:linear-gradient(90deg,#0084ff,transparent)}
.stage-connector i{
  height:12px;width:12px;border:2px solid #0084ff;background:#0084ff;border-radius:50%;
  box-shadow:0 0 0 5px rgba(0,132,255,0.25);
}
.stage-connector.short{height:32px}
.stage-gateway{
  display:flex;align-items:center;gap:15px;position:relative;z-index:1;
  padding:14px;border:1px solid #24354f;border-radius:14px;
  background:#111722;box-shadow:0 0 32px rgba(0,132,255,0.15);
}
.stage-gateway img{height:60px;width:60px;object-fit:contain}
.stage-gateway div{min-width:0;flex:1}
.stage-gateway strong{display:block;font-size:16px;color:#fff}
.stage-gateway small{display:block;margin-top:4px;font-size:11px;color:#8e9bb0}
.stage-shield{font-size:14px;display:grid;place-items:center;height:28px;width:28px;border-radius:50%;background:rgba(16,185,129,0.15);color:#10b981}
.terminal-preview{
  position:relative;z-index:1;border:1px solid #1e2638;border-radius:14px;background:#090b10;
  overflow:hidden;
}
.terminal-titlebar{
  display:flex;align-items:center;justify-content:space-between;gap:10px;background:#10141d;
  border-bottom:1px solid #1a2230;padding:10px 14px;font-size:11px;color:#8e9bb0;
}
.terminal-host-badge{display:inline-flex;align-items:center;gap:8px;font-weight:700}
.terminal-host-badge i{width:8px;height:8px;border-radius:50%;background:#10b981}
.terminal-policy-badge{
  font-size:9px;font-weight:800;letter-spacing:.06em;color:#10b981;background:rgba(16,185,129,0.15);
  border:1px solid rgba(16,185,129,0.3);border-radius:6px;padding:2px 7px;
}
.terminal-sample{color:#647083;font-size:10px}
.terminal-content{padding:16px;font:500 12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:#cbd5e1}
.terminal-caller{color:#0084ff;font-weight:700;margin-right:5px}
.terminal-dollar{font-weight:800;font-size:16px;color:#0084ff;margin-right:6px}
.term-fn{color:#38bdf8;font-weight:600}
.term-arg{color:#fbbf24}
.terminal-result{color:#10b981;font-size:11px;margin-top:5px;display:flex;align-items:center;gap:6px}
.terminal-output{color:#94a3b8;font-size:11px;margin-top:4px;padding-left:14px;border-left:2px solid #1e293b}
.terminal-caption{border-top:1px solid #1a202c;margin-top:12px;padding-top:8px;color:#647083;font-size:10px}

@media(max-width:860px) {
  .workspace-sidebar{background:#0c0e12;border-bottom-color:#1a202c}
  .workspace-main{padding-inline:20px}
  .usage-stat-grid{grid-template-columns:1fr}
}
@media(max-width:640px) {
  .device-controls > summary.device-row{padding:16px}
  .device-control-panel{margin:0 16px 16px}
  .device-list-heading{flex-wrap:wrap}
  .device-row-status{gap:12px}
  .device-dialog-actions .btn{flex:1}
  .workspace-page-heading h1{font-size:24px}
  .wizard-stepper{gap:6px}
  .stepper-line{width:35px}
  .barchart-bar{width:32px}
  .product-stage{padding:18px 14px 14px}
}
`;
