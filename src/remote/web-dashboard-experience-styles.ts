export const EXPERIENCE_STYLES = `
/* SSH MCP Pro · Luminous ink. Art direction: confident / approachable / precise.
   Focus: legibility, obvious actions and stable desktop/mobile layouts. */
:root {
  --accent-blue:#3478f6;
  --action-blue:#326be5;
  --action-blue-hover:#2362d9;
  --accent-blue-hover:#5295ff;
  --accent-cyan:#50d7e7;
  --surface-primary:#171b2a;
  --surface-secondary:#111525;
  --surface-raised:#1e2437;
  --border-soft:#303851;
  --text-strong:#f8faff;
  --text-secondary:#b5bfd4;
  --muted:#8998b3;
  --bg:#0f111e;
  --card-bg:var(--surface-primary);
  --card-border:var(--border-soft);
  --text-main:var(--text-strong);
  --text-muted:var(--text-secondary);
  --primary:var(--action-blue);
  --primary-hover:var(--accent-blue-hover);
  --blue:#94bcff;
  --blue-bg:#223761;
  --red:#ff9b9b;
}
html {color-scheme:dark}
body {
  background:#0f111e;
  color:var(--text-strong);
  font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;
  letter-spacing:-.006em;
}
.public-header {
  background:#10111e;
  border-bottom:1px solid #252b40;
  padding-block:20px;
}
.brand-mark{border-radius:11px;box-shadow:0 5px 24px #1761ed29}
.brand-title{font-size:18px;font-weight:800;letter-spacing:-.045em}
.brand-sub{color:#9eabc4}
.logo-area:hover .brand-title,.sidebar-brand:hover strong{color:#b3d6ff}
.btn{min-height:44px;border-radius:11px;font-weight:700;letter-spacing:-.01em}
.btn-primary {
  background:var(--action-blue);
  border:1px solid #4e93ff;
  box-shadow:inset 0 1px 0 #ffffff30,0 6px 18px #2d65e52d;
  color:#fff;
}
.btn-primary:hover{background:var(--action-blue-hover);color:#fff;border-color:#85b6ff;box-shadow:0 9px 25px #3478f644}
.btn-primary:active{transform:translateY(1px);box-shadow:0 2px 8px #3478f633}
.btn-soft{background:#1e3054;border-color:#33558a;color:#d3e5ff}
.btn-soft:hover{background:#2c4d83;border-color:#5085d3}
.btn-outline{background:#1f2639;border:1px solid #3a4867;color:#e6edff}
.btn-outline:hover{background:#273755;border-color:#6485c5;color:#fff}
.btn-danger{background:#442935;border-color:#774559;color:#ffc3cb}
.btn-danger:hover{background:#713a4e;border-color:#bf637e;color:#fff}
.card{background:#191d2b;border-color:#303953;border-radius:15px;box-shadow:0 5px 28px #04071720}
.card:hover{border-color:#42547a}
.card a,.site-footer a{color:#8cbfff}
.card a:hover,.site-footer a:hover{color:#c6e4ff}
.code-box{background:#111828;border-color:#3b5277;color:#c8dcff}
.copy-btn{background:#24467d;border-color:#386aaf;color:#f4f8ff}
.copy-btn:hover{background:#3466b1}
.eyebrow{color:#8caeff;letter-spacing:.13em}
.mini-spark{background:#5f9eff;box-shadow:0 0 0 4px #387bf52d}
.live-indicator{background:#4bd0a4;box-shadow:0 0 0 4px #4bd0a42b}
/* Public onboarding: luminous editorial hero and tangible integration preview. */
.landing-shell{background:radial-gradient(ellipse 54% 38% at 78% 15%,#14316d80,transparent 75%);padding-bottom:68px}
.landing-hero{grid-template-columns:minmax(0,1.13fr) minmax(340px,.87fr);gap:clamp(40px,6vw,92px);padding:clamp(64px,8vw,108px) 0 82px}
.landing-copy h1{font-size:clamp(41px,5.3vw,72px);letter-spacing:-.068em;max-width:740px;font-weight:820}
.landing-copy h1 em{
  background:linear-gradient(95deg,#c8e0ff 5%,#81b8ff 42%,#4f8eff 80%);
  -webkit-background-clip:text;
  background-clip:text;
  color:transparent;
}
.landing-copy>p{color:#b7c4da;line-height:1.75}
.landing-small-note{color:#9eaec7!important}
.auth-btn{border-radius:12px;font-weight:750}
.auth-btn-google{border:1px solid #e6edfa;background:#f6f9ff;color:#14243a}
.auth-btn-github{border:1px solid #526487;background:#22293c;color:#f3f7ff}
.auth-btn:hover{filter:brightness(1.08)}
.landing-illustration{
  background:radial-gradient(ellipse 70% 55% at 52% 20%,#245ed26b,transparent 84%),linear-gradient(154deg,#1b2545,#10182e 72%);
  border:1px solid #355291;
  border-radius:26px;
  box-shadow:0 30px 70px #0208178c,0 0 62px #336bdd26,inset 0 1px 0 #8fbaff36;
}
.flow-card{background:#151e35;border:1px solid #3b5485;box-shadow:inset 0 1px 0 #ffffff0d}
.flow-card strong{color:#f7f9ff}
.flow-card small{color:#aab9d4}
.flow-overline{color:#9bbfff}
.flow-gateway{background:#1a3460;border-color:#4785df;box-shadow:0 0 25px #377aeb2a}
.flow-gateway img{border-radius:10px;filter:drop-shadow(0 3px 8px #1341a16b)}
.flow-line{color:#77aaff}
.flow-line span{background:#659aff}
.flow-card strong span{color:#a2c7ff}
.flow-computer-icon{background:#243a60;border-color:#4a6eaf;color:#b8d7ff}
.flow-caption{color:#9eadd1}
.onboarding-section{border-top:1px solid #2b3554}
.onboarding-section-head h2{font-weight:790}
.onboarding-section-head>p:last-child{color:#b1bfd3}
.onboarding-steps article{background:#191e30;border:1px solid #303d62;border-radius:16px;transition:transform .18s ease,border-color .18s ease}
.onboarding-steps article:hover{transform:translateY(-3px);border-color:#5179ba}
.step-number{background:#243d71;color:#b9d6ff}
.onboarding-steps p{color:#b3c0d5}
.landing-local{background:#191f33;border:1px solid #33466c}
.landing-local-symbol{background:#21396d;color:#d6e7ff}
.landing-local p{color:#b4bfd2}
.landing-local code{background:#11192c;border-color:#3a5482;color:#cadcff}
.site-footer{border-top:1px solid #2b3652;color:#9baac2}
/* Workspace: restrained dark ink with actionable blue, not cyan/green blocks. */
.workspace-active{background:#0f111e}
.workspace-shell{grid-template-columns:242px minmax(0,1fr)}
.workspace-sidebar{
  background:#121522;
  border-right:1px solid #292f43;
  padding:29px 17px 24px;
}
.sidebar-brand{padding-bottom:40px}
.sidebar-brand strong{letter-spacing:-.045em;font-size:16px}
.sidebar-brand small{color:#9da9c2}
.sidebar-label{color:#8392ad;letter-spacing:.15em}
.workspace-nav{gap:5px}
.workspace-nav-item{
  border-radius:10px;
  min-height:44px;
  color:#b7c3d9;
  font-weight:650;
  padding:10px 12px;
}
.workspace-nav-item:hover{background:#1e2946;color:#f8faff}
.workspace-nav-item.active{
  color:#e8f0ff;
  background:linear-gradient(90deg,#253b69 0%,#203053 100%);
  border-color:#4269aa;
  box-shadow:inset 3px 0 #5496ff;
}
.workspace-nav-icon{background:transparent;color:#93aed6;border-radius:6px;font-size:19px}
.workspace-nav-item.active .workspace-nav-icon{background:#28569f;color:#dceaff}
.sidebar-help{color:#a7b7cf;border-color:#2f3a56}
.account-avatar{background:#244a87;color:#d4e6ff}
.sidebar-account-text small,.sidebar-links a{color:#9eabc4}
.sidebar-signout{color:#afc9ec}
.workspace-main{max-width:1170px;padding-inline:clamp(20px,4.4vw,68px)}
.workspace-topbar{border-color:#2b344b}
.workspace-breadcrumb,.workspace-top-status{color:#91a2bf}
.workspace-page-heading{margin:48px 0 30px}
.workspace-page-heading h1{font-size:clamp(34px,3.5vw,45px);letter-spacing:-.06em}
.workspace-page-heading p:last-child{color:#aebbd1}
.connection-summary{
  background:linear-gradient(100deg,#1a2950,#17233a 86%);
  border:1px solid #344f86;
  box-shadow:inset 0 1px 0 #88b1ff20;
  border-radius:14px;
}
.summary-pulse{background:#254984}
.summary-pulse:after{color:#94beff}
.connection-summary-primary span:last-child{color:#b3c2e0}
.device-scope-note{color:#8798b2;font-size:12px}
.device-list-heading{border-color:#2c3750}
.device-list-heading h2{font-weight:760}
.device-list-heading p{color:#8f9db8}
.device-entry{border-bottom-color:#303a53}
.device-row{padding:22px 25px}
.device-icon{background:#243654;border:1px solid #3f5f92;color:#b5d0fd}
.device-meta{color:#9aabc7}
.status-pill.online{background:#173c34;color:#a9f3d2}
.status-pill.offline{background:#3a2f37;color:#e7c5b5}
.device-controls summary{background:#222a3f;border-color:#405271;color:#e6efff}
.device-controls summary:hover{background:#2c3a59;border-color:#6884be}
.device-control-panel{background:#1a2132;border-color:#425777}
.device-control-panel p{color:#b4c1d5}
.device-offline-tip{background:#24242c;border-color:#423f4c;color:#eacbbc}
.device-loading{color:#b5c4df}
.onboarding-empty h2{color:#f7faff}
.onboarding-empty p{color:#aebbd2}
.empty-art{background:#213b70;border-color:#5277b5;color:#d0e1ff}
.empty-plus{background:#3478f6;border-color:#191d2b;color:#fff}
.empty-next-step{color:#91a5c1}
.usage-stat{background:#1b263d;border-color:#344a71}
.usage-stat small{color:#a1b1ce}
.stat-label{color:#a6c4f6}
.usage-table th{color:#a4b8d8;border-color:#394761}
.usage-table td{border-color:#2c3951}
.setup-intro,.integration-feature{background:linear-gradient(110deg,#1b315f,#18243d);border-color:#3c5e9a}
.setup-intro>p:not(.eyebrow),.integration-feature>p:not(.eyebrow){color:#b7c7e3}
.setup-steps span{background:#22375d;border-color:#4567a3;color:#dce9ff}
.setup-steps strong{background:#315c9b;color:#eaf2ff}
.setup-main-card{background:#191e2f}
.setup-main-card input,.setup-main-card select{border-color:#445780!important;background:#101a2e!important}
.os-chooser>span{color:#dfeaff}
.os-choice{background:#202c47;border-color:#42557c;color:#d0dcf1}
.os-choice:hover{border-color:#688be1}
.os-choice.active,.os-choice[aria-pressed="true"]{background:#254d94;border-color:#5c9bf9;color:#fff}
.platform-card{background:#191e2f;border-color:#303d5b;border-radius:16px}
.platform-card p{color:#b5c0d3}
.platform-card small{color:#8d9cb8}
.platform-symbol.chatgpt{background:#1c4e4e;color:#bcffe9}
.platform-symbol.claude{background:#573d42;color:#ffd8c7}
.platform-symbol.gemini{background:#353d6a;color:#cbd6ff}
.integration-next{background:#172942;border-color:#345784}
.integration-next p{color:#c2d2e8}
.advanced-integrations{background:#1b2030;border-color:#303e5d}
.advanced-integrations[open]>summary{border-color:#3e4d70}
.feedback-error{background:#291c2b;border-color:#7d4459}
.feedback-error p{color:#f0c7d3}
:focus-visible{outline:2px solid #9ec4ff!important;outline-offset:3px}
@media(max-width:860px) {
  .workspace-sidebar{background:#121522;border-bottom-color:#303b58}
  .workspace-main{padding-inline:24px}
  .workspace-nav-item{padding-inline:11px}
}
@media(max-width:640px) {
  .workspace-main{padding-inline:16px}
  .workspace-page-heading{margin-top:30px}
  .landing-hero{gap:39px}
  .onboarding-steps article:hover{transform:none}
}
@media(prefers-reduced-motion:reduce) {.onboarding-steps article{transition:none}}


/* A compact product story instead of generic stacked explanation cards. */
.product-stage{
  position:relative;
  padding:30px 26px 26px;
  background:radial-gradient(ellipse 75% 45% at 50% 15%,#2855b665,transparent 88%),linear-gradient(145deg,#182342,#10172c);
  border:1px solid #3a5593;
  border-radius:24px;
  box-shadow:0 30px 80px #0006,inset 0 1px 0 #96b8ff30;
  overflow:hidden;
}
.product-stage:before{content:"";position:absolute;inset:10px;border:1px solid #ffffff0c;border-radius:18px;pointer-events:none}
.product-stage:after{content:"";position:absolute;inset:auto -25% -52% 15%;height:320px;background:#245ad82d;filter:blur(80px);pointer-events:none}
.stage-overline{font-size:10px;letter-spacing:.14em;font-weight:800;color:#9bbcff;margin-bottom:17px}
.stage-clients{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;position:relative;z-index:1}
.assistant-chip{
  display:flex;flex-direction:column;gap:9px;align-items:center;justify-content:center;
  background:linear-gradient(#202a44,#151d35);border:1px solid #44567b;border-radius:13px;
  min-height:87px;padding:12px 7px;color:#f1f5ff;font-size:12px;font-weight:760;white-space:nowrap
}
.assistant-mark{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:#d4dce9;color:#193f5d;font-size:21px}
.claude-mark{background:#e7c3b1;color:#ab5b42}
.gemini-mark{background:#cdd3ff;color:#384baa}
.stage-connector{height:41px;display:flex;align-items:center;justify-content:center;position:relative}
.stage-connector span{height:1px;width:35%;max-width:140px;background:linear-gradient(90deg,transparent,#5488e1)}
.stage-connector span:last-child{background:linear-gradient(90deg,#5488e1,transparent)}
.stage-connector i{height:12px;width:12px;border:2px solid #6ba7ff;background:#244a91;border-radius:50%;box-shadow:0 0 0 5px #357be62a}
.stage-connector.short{height:32px}
.stage-gateway{
  display:flex;align-items:center;gap:15px;position:relative;z-index:1;
  padding:14px;border:1px solid #5488d8;border-radius:14px;
  background:linear-gradient(100deg,#21457e,#1a2d50);box-shadow:0 0 32px #367ce42b
}
.stage-gateway img{height:62px;width:62px;object-fit:contain;filter:drop-shadow(0 2px 13px #255ad98c)}
.stage-gateway div{min-width:0;flex:1}
.stage-gateway strong{display:block;font-size:17px;letter-spacing:-.028em}
.stage-gateway small{display:block;margin-top:4px;font-size:11px;color:#bacced}
.stage-shield{font-size:14px;display:grid;place-items:center;height:30px;width:30px;border-radius:50%;background:#19493f;color:#91f3d0}
.terminal-preview{position:relative;z-index:1;border:1px solid #344866;border-radius:14px;background:#101729;overflow:hidden}
.terminal-titlebar{display:flex;align-items:center;justify-content:space-between;gap:12px;background:#1a2336;border-bottom:1px solid #303e5d;padding:11px 14px;font-size:11px;color:#b9c9e8}
.terminal-titlebar>span:first-child{display:inline-flex;align-items:center;gap:8px;font-weight:740}
.terminal-titlebar i{width:8px;height:8px;border-radius:50%;background:#42d6a2;box-shadow:0 0 0 3px #3bd7a11d}
.terminal-sample{color:#8598b4;font-size:10px}
.terminal-content{padding:17px 17px 18px;font:500 12px/1.7 ui-monospace,SFMono-Regular,Consolas,monospace;color:#cddcfe}
.terminal-dollar{font-weight:800;font-size:19px;color:#6fa3ff;vertical-align:-1px;margin-right:6px}
.terminal-result{color:#8fe4b7;font-size:11px;margin-top:5px}
.terminal-result .mini-spark{width:6px;height:6px;background:#65e6ae;box-shadow:none}
.terminal-caption{border-top:1px solid #2b3752;margin-top:12px;padding-top:9px;color:#98a8c5;font-size:10px}
.landing-copy{max-width:700px}
.landing-copy h1{font-size:clamp(42px,5.1vw,69px);line-height:1.07;max-width:660px}
.landing-copy>p{max-width:555px}
.assistant-next-step{
  display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:25px;
  margin-top:22px;padding:26px 29px;background:linear-gradient(115deg,#18233e,#171d2d);
  border:1px solid #314a75;border-radius:16px
}
.assistant-next-copy{max-width:580px}
.assistant-next-copy .eyebrow{margin-bottom:6px;font-size:10px}
.assistant-next-copy h2{font-size:20px;letter-spacing:-.035em;line-height:1.3}
.assistant-next-copy p{font-size:12px;color:#aebdd5;margin-top:7px;line-height:1.65}
.assistant-next-badges{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}
.assistant-next-badges span{border:1px solid #3c557d;background:#1d3151;color:#cfddf4;font-size:11px;font-weight:750;padding:5px 10px;border-radius:8px}
.assistant-next-step>.btn{flex-shrink:0}
@media(max-width:1100px){
  .landing-hero{display:grid;grid-template-columns:minmax(0,1fr);max-width:850px;margin:0 auto;gap:42px}
  .landing-copy{width:100%;max-width:none;min-width:0}
  .landing-copy h1{max-width:790px}
  .product-stage{max-width:630px;width:100%;margin:0 auto}
}
@media(max-width:640px){
  .product-stage{padding:19px 14px 15px;border-radius:19px}
  .stage-overline{text-align:center;font-size:9px}
  .assistant-chip{min-height:76px;font-size:11px}
  .stage-gateway img{height:54px;width:54px}
  .terminal-content{font-size:11px}
  .terminal-sample{font-size:9px}
  .assistant-next-step{padding:21px 18px}
  .assistant-next-step>.btn{width:100%}
}
`;
