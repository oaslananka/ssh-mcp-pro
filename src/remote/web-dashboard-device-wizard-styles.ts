export const DEVICE_WIZARD_STYLES = `/* Device Setup Stepper & Wizard (matching Screenshots 2-5) */
.device-wizard {
  background:#12151c;
  border:1px solid #1e2430;
  border-radius:16px;
  max-width:620px;
  margin:0 auto 30px;
  padding:30px 32px;
}
.wizard-stepper {
  display:flex;
  align-items:center;
  justify-content:center;
  gap:12px;
  margin-bottom:24px;
}
.stepper-item {
  display:flex;
  flex-direction:column;
  align-items:center;
  gap:6px;
  font-size:11px;
  color:#647083;
}
.stepper-item.active {
  color:#fff;
  font-weight:600;
}
.stepper-dot {
  width:10px;
  height:10px;
  border-radius:50%;
  background:#1e2535;
}
.stepper-item.active .stepper-dot {
  background:#0084ff;
  box-shadow:0 0 10px rgba(0,132,255,0.6);
}
.stepper-line {
  width:70px;
  height:1px;
  background:#1e2430;
  margin-bottom:18px;
}
.wizard-title {
  font-size:24px;
  font-weight:700;
  color:#ffffff;
  text-align:center;
  margin-bottom:8px;
}
.wizard-subtitle {
  font-size:13px;
  color:#8e9bb0;
  text-align:center;
  line-height:1.5;
  max-width:480px;
  margin:0 auto 24px;
}
.platform-segmented {
  display:flex;
  background:#090a0d;
  border:1px solid #1a202c;
  border-radius:9px;
  padding:3px;
  margin-bottom:16px;
}
.platform-tab-btn {
  flex:1;
  border:none;
  background:transparent;
  color:#8e9bb0;
  font-size:13px;
  font-weight:600;
  padding:9px 0;
  border-radius:7px;
  cursor:pointer;
  transition:all 0.15s ease;
}
.platform-tab-btn.active {
  background:#1a202c;
  color:#ffffff;
  box-shadow:0 2px 6px rgba(0,0,0,0.4);
}
.wizard-note {
  font-size:12px;
  color:#647083;
  margin-bottom:14px;
}
.wizard-method-card {
  background:#0e1117;
  border:1px solid #1a202c;
  border-radius:10px;
  padding:16px 18px;
  margin-bottom:12px;
  transition:border-color 0.15s ease;
}
.wizard-method-card:hover {
  border-color:#273244;
}
.wizard-method-header {
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:4px;
}
.wizard-method-title {
  font-size:14px;
  font-weight:600;
  color:#ffffff;
  display:flex;
  align-items:center;
  gap:8px;
}
.badge-recommended {
  background:rgba(16,185,129,0.15);
  color:#10b981;
  font-size:10px;
  font-weight:700;
  padding:2px 7px;
  border-radius:4px;
}
.wizard-method-desc {
  font-size:12px;
  color:#8e9bb0;
  margin-bottom:12px;
}
.wizard-codebox {
  background:#080a0e;
  border:1px solid #1c2230;
  border-radius:8px;
  padding:12px 14px;
  display:flex;
  justify-content:space-between;
  align-items:center;
  font-family:ui-monospace,SFMono-Regular,Consolas,monospace;
  font-size:12px;
  color:#e2e8f0;
  margin:10px 0;
}
.wizard-codebox code {
  overflow-x:auto;
  white-space:nowrap;
}
.wizard-copy-btn {
  background:#1a202c;
  border:1px solid #283244;
  color:#ffffff;
  border-radius:6px;
  padding:6px 14px;
  font-size:12px;
  font-weight:600;
  cursor:pointer;
  margin-left:12px;
  flex-shrink:0;
  transition:all 0.15s ease;
}
.wizard-copy-btn:hover {
  background:#242c3d;
}
.wizard-btn-primary {
  width:100%;
  background:#0084ff;
  color:#ffffff;
  border:none;
  border-radius:8px;
  padding:12px 0;
  font-size:14px;
  font-weight:600;
  cursor:pointer;
  margin:12px 0 10px;
  transition:background 0.15s ease;
}
.wizard-btn-primary:hover {
  background:#0070d9;
}
.wizard-footer-link {
  text-align:center;
  font-size:12px;
  color:#647083;
  margin-top:20px;
}
.wizard-footer-link a {
  color:#8e9bb0;
  text-decoration:none;
}
.wizard-footer-link a:hover {
  color:#0084ff;
}

`;
